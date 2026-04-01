import 'dotenv/config';
import { whatsAppBridge, sendTextToChat, sendMediaToChat } from './whatsapp.js';
import { forwardMessage, startBot } from './telegram.js';
import { startServer } from './server.js';

function validateEnv(): void {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_GROUP_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[Error] Missing required environment variables:', missing.join(', '));
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

function main(): void {
  validateEnv();

  startServer();

  whatsAppBridge.setMessageHandler(async message => {
    console.log(`[Bridge] WhatsApp → Telegram: ${message.topicName} [${message.type}]`);
    try {
      await forwardMessage(message);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[Bridge] Failed to forward to Telegram:', detail);
    }
  });

  whatsAppBridge.connect();

  startBot(async reply => {
    console.log(`[Bridge] Telegram → WhatsApp: ${reply.whatsappChatId}`);
    const client = whatsAppBridge.getClient();
    if (!client) {
      console.warn('[Bridge] WhatsApp not connected — cannot send reply');
      return;
    }
    try {
      if (reply.media) {
        await sendMediaToChat(
          client,
          reply.whatsappChatId,
          reply.media.buffer,
          reply.media.mimetype,
          reply.media.filename,
          reply.caption,
        );
      } else if (reply.text) {
        await sendTextToChat(client, reply.whatsappChatId, reply.text);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[Bridge] Failed to send to WhatsApp:', detail);
    }
  });
}

main();
