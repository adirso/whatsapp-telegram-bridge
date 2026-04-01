import { Bot, InputFile } from 'grammy';
import type { Message } from '@grammyjs/types';
import { getTopicId, saveTopicId, getChatIdByTopicId } from './topicManager.js';
import type { NormalisedMessage } from './types.js';

export interface TelegramReply {
  whatsappChatId: string;
  text?: string;
  media?: { buffer: Buffer; mimetype: string; filename: string };
  caption?: string;
}

type ReplyHandler = (reply: TelegramReply) => Promise<void>;

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const GROUP_ID = Number(process.env.TELEGRAM_GROUP_ID);

async function getOrCreateTopic(whatsappChatId: string, topicName: string): Promise<number> {
  const existing = getTopicId(whatsappChatId);
  if (existing !== null) return existing;

  const result = await bot.api.createForumTopic(GROUP_ID, topicName.slice(0, 128));
  const topicId = result.message_thread_id;
  saveTopicId(whatsappChatId, topicId);
  console.log(`[Telegram] Created topic "${topicName}" (thread ${topicId})`);
  return topicId;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

export async function forwardMessage(message: NormalisedMessage): Promise<void> {
  const threadId = await getOrCreateTopic(message.whatsappChatId, message.topicName);
  const base = { chat_id: GROUP_ID, message_thread_id: threadId } as const;

  const senderPrefix = message.senderName
    ? `*${escapeMarkdown(message.senderName)}*\n`
    : '';

  switch (message.type) {
    case 'text':
      await bot.api.sendMessage(GROUP_ID, senderPrefix + escapeMarkdown(message.body), {
        message_thread_id: threadId,
        parse_mode: 'MarkdownV2',
      });
      break;

    case 'image':
      await bot.api.sendPhoto(GROUP_ID, new InputFile(message.media!, 'photo.jpg'), {
        ...base,
        caption: senderPrefix + (message.caption ? escapeMarkdown(message.caption) : ''),
        parse_mode: 'MarkdownV2',
      });
      break;

    case 'video':
      await bot.api.sendVideo(GROUP_ID, new InputFile(message.media!, 'video.mp4'), {
        ...base,
        caption: senderPrefix + (message.caption ? escapeMarkdown(message.caption) : ''),
        parse_mode: 'MarkdownV2',
      });
      break;

    case 'audio':
    case 'ptt':
      await bot.api.sendAudio(GROUP_ID, new InputFile(message.media!, 'audio.ogg'), {
        ...base,
        caption: senderPrefix || undefined,
        parse_mode: 'MarkdownV2',
      });
      break;

    case 'document':
      await bot.api.sendDocument(
        GROUP_ID,
        new InputFile(message.media!, message.filename ?? 'file'),
        {
          ...base,
          caption: senderPrefix + (message.caption ? escapeMarkdown(message.caption) : ''),
          parse_mode: 'MarkdownV2',
        },
      );
      break;

    case 'sticker':
      await bot.api.sendSticker(GROUP_ID, new InputFile(message.media!, 'sticker.webp'), base);
      break;

    case 'location':
      await bot.api.sendLocation(
        GROUP_ID,
        message.location!.latitude,
        message.location!.longitude,
        base,
      );
      break;

    default:
      await bot.api.sendMessage(
        GROUP_ID,
        senderPrefix + escapeMarkdown(`[${message.type}]`),
        { message_thread_id: threadId, parse_mode: 'MarkdownV2' },
      );
  }
}

async function downloadFile(fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  return Buffer.from(await res.arrayBuffer());
}

function extToMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
    pdf: 'application/pdf', zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function buildReply(whatsappChatId: string, msg: Message): Promise<TelegramReply | null> {
  if (msg.text) {
    return { whatsappChatId, text: msg.text };
  }

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1]; // largest size
    const buffer = await downloadFile(photo.file_id);
    return {
      whatsappChatId,
      media: { buffer, mimetype: 'image/jpeg', filename: 'photo.jpg' },
      caption: msg.caption,
    };
  }

  if (msg.video) {
    const buffer = await downloadFile(msg.video.file_id);
    const filename = msg.video.file_name ?? 'video.mp4';
    return {
      whatsappChatId,
      media: { buffer, mimetype: msg.video.mime_type ?? 'video/mp4', filename },
      caption: msg.caption,
    };
  }

  if (msg.audio) {
    const buffer = await downloadFile(msg.audio.file_id);
    const filename = msg.audio.file_name ?? 'audio.mp3';
    return {
      whatsappChatId,
      media: { buffer, mimetype: msg.audio.mime_type ?? 'audio/mpeg', filename },
      caption: msg.caption,
    };
  }

  if (msg.voice) {
    const buffer = await downloadFile(msg.voice.file_id);
    return {
      whatsappChatId,
      media: { buffer, mimetype: 'audio/ogg', filename: 'voice.ogg' },
    };
  }

  if (msg.document) {
    const buffer = await downloadFile(msg.document.file_id);
    const filename = msg.document.file_name ?? 'file';
    return {
      whatsappChatId,
      media: { buffer, mimetype: msg.document.mime_type ?? extToMime(filename), filename },
      caption: msg.caption,
    };
  }

  if (msg.sticker) {
    const buffer = await downloadFile(msg.sticker.file_id);
    return {
      whatsappChatId,
      media: { buffer, mimetype: 'image/webp', filename: 'sticker.webp' },
    };
  }

  return null; // unsupported type
}

export function startBot(onReply: ReplyHandler): void {
  bot.on('message', async ctx => {
    const msg = ctx.message;

    // Only handle messages in our group's topics, sent by humans
    if (msg.chat.id !== GROUP_ID) return;
    if (!msg.message_thread_id) return;
    if (ctx.from?.is_bot) return;

    const whatsappChatId = getChatIdByTopicId(msg.message_thread_id);
    if (!whatsappChatId) return;

    try {
      const reply = await buildReply(whatsappChatId, msg);
      if (reply) {
        console.log(`[Telegram] Reply in topic ${msg.message_thread_id} → WhatsApp ${whatsappChatId}`);
        await onReply(reply);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[Telegram] Failed to process reply:', detail);
    }
  });

  bot.start({ onStart: () => console.log('[Telegram] Bot polling started') });
}
