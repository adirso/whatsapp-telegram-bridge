import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { whatsAppBridge } from './whatsapp.js';

const ENV_PATH = path.join(__dirname, '..', '.env');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------------------------------------------------------------------------
// .env helpers
// ---------------------------------------------------------------------------

function parseEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

function writeEnv(updates: Record<string, string>): void {
  // Read existing file to preserve comments and ordering
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const updatedKeys = new Set<string>();

  let content = existing
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return line;
      const key = trimmed.slice(0, eqIdx).trim();
      if (key in updates) {
        updatedKeys.add(key);
        return `${key}=${updates[key]}`;
      }
      return line;
    })
    .join('\n');

  // Append any brand-new keys
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      content += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get('/api/status', (_req, res) => {
  res.json({ status: whatsAppBridge.status });
});

app.post('/api/connect', (_req, res) => {
  whatsAppBridge.connect();
  res.json({ ok: true });
});

app.post('/api/disconnect', async (_req, res) => {
  await whatsAppBridge.disconnect();
  res.json({ ok: true });
});

app.get('/api/settings', (_req, res) => {
  res.json(parseEnv());
});

app.post('/api/settings', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string') updates[k] = v;
  }
  writeEnv(updates);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// WebSocket — pushes { type: 'status' | 'qr', data: string } to all clients
// ---------------------------------------------------------------------------

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const sockets = new Set<WebSocket>();

function broadcast(msg: { type: string; data: string }): void {
  const payload = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

wss.on('connection', ws => {
  sockets.add(ws);
  // Send current status immediately on connect
  ws.send(JSON.stringify({ type: 'status', data: whatsAppBridge.status }));
  ws.on('close', () => sockets.delete(ws));
});

whatsAppBridge.on('status', (status: string) => {
  broadcast({ type: 'status', data: status });
});

whatsAppBridge.on('qr', async (rawQr: string) => {
  const dataUrl = await QRCode.toDataURL(rawQr, { margin: 2, width: 280 });
  broadcast({ type: 'qr', data: dataUrl });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export function startServer(): void {
  const port = Number(process.env.PORT ?? 3000);
  httpServer.listen(port, () => {
    console.log(`[Server] UI available at http://localhost:${port}`);
  });
}
