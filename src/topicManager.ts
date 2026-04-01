import fs from 'fs';
import path from 'path';

const STORE_PATH = path.join(__dirname, '..', 'data', 'topics.json');

type TopicStore = Record<string, number>;

function loadStore(): TopicStore {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as TopicStore;
  } catch {
    return {};
  }
}

function saveStore(store: TopicStore): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export function getTopicId(whatsappChatId: string): number | null {
  const store = loadStore();
  return store[whatsappChatId] ?? null;
}

export function saveTopicId(whatsappChatId: string, telegramTopicId: number): void {
  const store = loadStore();
  store[whatsappChatId] = telegramTopicId;
  saveStore(store);
}

/** Reverse lookup: Telegram topic ID → WhatsApp chat ID */
export function getChatIdByTopicId(telegramTopicId: number): string | null {
  const store = loadStore();
  const entry = Object.entries(store).find(([, topicId]) => topicId === telegramTopicId);
  return entry ? entry[0] : null;
}
