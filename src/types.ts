export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'ptt'
  | 'document'
  | 'sticker'
  | 'location'
  | 'unknown';

export interface NormalisedMessage {
  /** WhatsApp chat ID (e.g. "1234567890@c.us" or "12345-67890@g.us") */
  whatsappChatId: string;
  /** Topic name — phone number for DMs, group name for groups */
  topicName: string;
  /** Sender display name (only set inside group chats) */
  senderName: string | null;
  type: MessageType;
  body: string;
  caption: string | null;
  media: Buffer | null;
  filename: string | null;
  location: { latitude: number; longitude: number } | null;
}
