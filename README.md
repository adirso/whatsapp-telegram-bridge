# whatsapp-to-telegram

Bridges incoming WhatsApp messages to a Telegram supergroup with topics. Each WhatsApp contact (identified by phone number) or WhatsApp group gets its own dedicated Telegram topic, created automatically on the first message.

## How it works

```
WhatsApp message received
        │
        ▼
  Is there already a Telegram topic for this chat?
        │
   No ──┴── Yes
   │              │
   ▼              ▼
Create topic   Reuse topic
(phone number  (looked up
 or group name) from topics.json)
        │
        ▼
Forward message to that topic
(text, image, video, audio,
 document, sticker, location)
```

- **Direct messages** → topic named after the sender's phone number (e.g. `+1234567890`)
- **Group messages** → topic named after the WhatsApp group name
- Inside group topics, each message is prefixed with the sender's display name
- Topic mappings are persisted in `data/topics.json` so restarts reuse the same topics

## Requirements

- Node.js 18+
- A phone number with an active WhatsApp account
- A Telegram bot token
- A Telegram supergroup with **Topics enabled** where the bot is an admin

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Telegram bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 3. Set up the Telegram supergroup

1. Create a Telegram group (or use an existing one)
2. Go to **Group Settings → Topics** and enable it
3. Add your bot to the group and promote it to **admin**
4. Grant the admin permission **Manage Topics**
5. Get the group's chat ID — forward any message from the group to [@userinfobot](https://t.me/userinfobot) and copy the `Chat ID` (it will be a negative number like `-1001234567890`)

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-your-token-here
TELEGRAM_GROUP_ID=-1001234567890
```

Optional settings:

```env
# Only forward messages from specific numbers (comma-separated, without +)
# Leave empty to forward from everyone
WHATSAPP_ALLOWED_NUMBERS=1234567890,9876543210

# Where WhatsApp session data is stored (default: ./.wwebjs_auth)
WHATSAPP_SESSION_DIR=./.wwebjs_auth
```

### 5. Run

```bash
npm start
```

On first run, a QR code will be printed in the terminal. Open WhatsApp on your phone → **Linked Devices → Link a Device** and scan it. The session is saved locally so subsequent runs skip the QR step.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run with `tsx` (no build step required) |
| `npm run dev` | Run with auto-restart on file changes |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run build:run` | Compile and run from `dist/` |

## Project structure

```
src/
├── index.ts          # Entry point — wires WhatsApp and Telegram together
├── types.ts          # Shared TypeScript interfaces
├── whatsapp.ts       # WhatsApp client — QR auth, message normalisation
├── telegram.ts       # Telegram bot — topic management, message forwarding
└── topicManager.ts   # Persists WhatsApp chat ID → Telegram topic ID mappings

data/
└── topics.json       # Auto-created — stores chat-to-topic mappings

.wwebjs_auth/         # Auto-created — WhatsApp session (do not delete)
```

## Supported message types

| WhatsApp type | Forwarded as |
|---|---|
| Text | Text message |
| Image | Photo |
| Video | Video |
| Audio / Voice note | Audio |
| Document | Document (original filename preserved) |
| Sticker | Sticker |
| Location | Map pin |
| Other | Fallback text label |

## Notes

- This project uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), an unofficial library that runs WhatsApp Web in a headless browser. It is not affiliated with or endorsed by WhatsApp/Meta.
- Running the bridge may violate WhatsApp's Terms of Service. Use at your own risk.
- The bot must remain an admin with "Manage Topics" permission for topic creation to work.
- The `data/topics.json` and `.wwebjs_auth/` directory should not be committed to version control (both are in `.gitignore`).
