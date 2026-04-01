import { EventEmitter } from 'events';
import { Client, LocalAuth, MessageTypes, MessageMedia, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import type { NormalisedMessage, MessageType } from './types.js';

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'ready';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClient(): Client {
  return new Client({
    authStrategy: new LocalAuth({
      dataPath: process.env.WHATSAPP_SESSION_DIR ?? './.wwebjs_auth',
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });
}

function phoneFromJid(jid: string): string {
  return '+' + jid.split('@')[0];
}

function isChannel(msg: Message): boolean {
  return msg.from.endsWith('@newsletter');
}

function isAllowed(msg: Message): boolean {
  const allowed = process.env.WHATSAPP_ALLOWED_NUMBERS
    ? process.env.WHATSAPP_ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
    : [];
  if (allowed.length === 0) return true;
  const number = msg.from.split('@')[0];
  return allowed.some(n => number.endsWith(n));
}

async function normaliseMessage(msg: Message): Promise<NormalisedMessage> {
  const chat = await msg.getChat();
  const contact = await msg.getContact();

  const whatsappChatId = chat.id._serialized;
  const topicName = chat.isGroup
    ? chat.name
    : phoneFromJid(chat.id._serialized);

  const senderName: string | null = chat.isGroup
    ? (contact.pushname || contact.name || phoneFromJid(msg.author ?? msg.from))
    : null;

  const base: NormalisedMessage = {
    whatsappChatId, topicName, senderName,
    type: 'text', body: msg.body, caption: null, media: null, filename: null, location: null,
  };

  if (msg.type === MessageTypes.LOCATION) {
    const loc = msg.location;
    return {
      ...base,
      type: 'location',
      location: { latitude: Number(loc.latitude), longitude: Number(loc.longitude) },
    };
  }

  if (!msg.hasMedia) return base;

  try {
    const mediaData = await msg.downloadMedia();
    const buffer = Buffer.from(mediaData.data, 'base64');
    const typeMap: Partial<Record<string, MessageType>> = {
      [MessageTypes.IMAGE]: 'image',
      [MessageTypes.VIDEO]: 'video',
      [MessageTypes.AUDIO]: 'audio',
      [MessageTypes.VOICE]: 'ptt',
      [MessageTypes.DOCUMENT]: 'document',
      [MessageTypes.STICKER]: 'sticker',
    };
    return {
      ...base,
      type: typeMap[msg.type] ?? 'document',
      caption: msg.body || null,
      media: buffer,
      filename: mediaData.filename ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[WhatsApp] Failed to download media:', message);
    return { ...base, body: `[${msg.type} — download failed]` };
  }
}

// ---------------------------------------------------------------------------
// Bridge (singleton EventEmitter)
// Events emitted:
//   'status'  (status: WhatsAppStatus)
//   'qr'      (qr: string)            — raw QR string
// ---------------------------------------------------------------------------

class WhatsAppBridge extends EventEmitter {
  public status: WhatsAppStatus = 'disconnected';
  private client: Client | null = null;
  private messageHandler: ((msg: NormalisedMessage) => Promise<void>) | null = null;

  setMessageHandler(handler: (msg: NormalisedMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  getClient(): Client | null {
    return this.client;
  }

  connect(): void {
    if (this.client) return; // already running

    this.status = 'connecting';
    this.emit('status', this.status);

    const client = createClient();
    this.client = client;

    client.on('qr', (qr: string) => {
      qrcode.generate(qr, { small: true });
      this.emit('qr', qr);
    });

    client.on('authenticated', () => console.log('[WhatsApp] Authenticated'));

    client.on('ready', () => {
      this.status = 'ready';
      this.emit('status', this.status);
      console.log('[WhatsApp] Client ready — listening for messages');
    });

    client.on('auth_failure', (msg: string) => {
      console.error('[WhatsApp] Auth failure:', msg);
      this.client = null;
      this.status = 'disconnected';
      this.emit('status', this.status);
    });

    client.on('disconnected', (reason: string) => {
      console.warn('[WhatsApp] Disconnected:', reason);
      this.client = null;
      this.status = 'disconnected';
      this.emit('status', this.status);
    });

    client.on('message', async (msg: Message) => {
      if (msg.fromMe) return;
      if (isChannel(msg)) return;
      if (!isAllowed(msg)) return;
      try {
        const normalised = await normaliseMessage(msg);
        if (this.messageHandler) await this.messageHandler(normalised);
      } catch (err) {
        console.error('[WhatsApp] Error handling message:', err);
      }
    });

    client.initialize();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }

    // Delete the persisted session so the next connect shows a fresh QR
    const sessionDir = path.resolve(process.env.WHATSAPP_SESSION_DIR ?? './.wwebjs_auth');
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log('[WhatsApp] Session deleted:', sessionDir);
    }

    this.status = 'disconnected';
    this.emit('status', this.status);
  }
}

export const whatsAppBridge = new WhatsAppBridge();

// ---------------------------------------------------------------------------
// Outbound helpers (Telegram → WhatsApp)
// ---------------------------------------------------------------------------

export async function sendTextToChat(client: Client, whatsappChatId: string, text: string): Promise<void> {
  const chat = await client.getChatById(whatsappChatId);
  await chat.sendMessage(text);
}

export async function sendMediaToChat(
  client: Client,
  whatsappChatId: string,
  buffer: Buffer,
  mimetype: string,
  filename: string,
  caption?: string,
): Promise<void> {
  const chat = await client.getChatById(whatsappChatId);
  const media = new MessageMedia(mimetype, buffer.toString('base64'), filename);
  await chat.sendMessage(media, { caption });
}
