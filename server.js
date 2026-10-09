/**
 * server.js — Pendakian AI Backend
 * Express.js server integrating WhatsApp Webhook & Langflow REST API
 * Run: node server.js
 */

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CORS ────────────────────────────────────────────────────────────────────
// Izinkan akses dari semua origin (termasuk Live Server :5500, :5173, dll.)
// agar frontend dapat tetap dikembangkan via dev-server sebelum deploy.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Langflow Config ────────────────────────────────────────────────────────
const LANGFLOW_BASE_URL = process.env.LANGFLOW_URL  || 'http://127.0.0.1:7860';
const LANGFLOW_FLOW_ID  = process.env.LANGFLOW_FLOW  || 'b3de60c2-f1c4-4739-aea2-09182f0169ed';
const LANGFLOW_API_KEY  = process.env.LANGFLOW_KEY   || 'sk-NAsWteSELxEoJ2Oid-viRfO6MTOaiVw-rrj_pbydP5A';
const LANGFLOW_API_URL  = `${LANGFLOW_BASE_URL}/api/v1/run/${LANGFLOW_FLOW_ID}`;

// ─── In-memory Message History ──────────────────────────────────────────────
// [ { id, source: 'whatsapp'|'web', sender, message, reply, timestamp } ]
const messageHistory = [];
let   messageCounter = 0;

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helper: Call Langflow REST API ─────────────────────────────────────────
async function queryLangflow(userMessage, sessionId = 'default') {
  const body = {
    input_value:         userMessage,
    output_type:         'chat',
    input_type:          'chat',
    session_id:          sessionId,
    tweaks:              {}
  };

  const response = await fetch(LANGFLOW_API_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    LANGFLOW_API_KEY
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Langflow error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  // Extract the text reply from Langflow response structure
  const outputs = data?.outputs?.[0]?.outputs?.[0];
  const reply   =
    outputs?.results?.message?.text       ||
    outputs?.artifacts?.message           ||
    outputs?.messages?.[0]?.message       ||
    data?.outputs?.[0]?.outputs?.[0]?.results?.message?.data?.text ||
    'Maaf, tidak ada respons dari AI.';

  return reply;
}

// ─── Helper: Push to history ─────────────────────────────────────────────────
function pushHistory({ source, sender, message, reply }) {
  messageCounter++;
  const entry = {
    id:        messageCounter,
    source,
    sender,
    message,
    reply,
    timestamp: new Date().toISOString()
  };
  messageHistory.unshift(entry); // newest first
  // Keep max 200 entries in memory
  if (messageHistory.length > 200) messageHistory.pop();
  return entry;
}

// ────────────────────────────────────────────────────────────────────────────
// ENDPOINT 1 — POST /webhook/whatsapp
// Receives payload from WhatsApp Gateway: { sender, message }
// ────────────────────────────────────────────────────────────────────────────
app.post('/webhook/whatsapp', async (req, res) => {
  const { sender, message } = req.body;

  if (!sender || !message) {
    return res.status(400).json({ error: 'Field "sender" dan "message" wajib diisi.' });
  }

  try {
    // Use sender phone number as session id so conversation context is per-user
    const reply = await queryLangflow(message, `wa-${sender}`);
    const entry = pushHistory({ source: 'whatsapp', sender, message, reply });

    console.log(`[WhatsApp] ${sender}: ${message} → ${reply.slice(0, 80)}...`);
    return res.json({ reply, id: entry.id });
  } catch (err) {
    console.error('[WhatsApp Webhook Error]', err.message);
    return res.status(502).json({ error: 'Gagal menghubungi Langflow AI.', detail: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// ENDPOINT 2 — POST /api/chat
// Receives message from Web Chatbot Frontend: { message }
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Field "message" tidak boleh kosong.' });
  }

  try {
    const reply = await queryLangflow(message.trim(), 'web-session');
    pushHistory({ source: 'web', sender: 'Web User', message: message.trim(), reply });

    console.log(`[Web Chat] Q: ${message.trim().slice(0, 60)} → A: ${reply.slice(0, 60)}...`);
    return res.json({ reply });
  } catch (err) {
    console.error('[Web Chat Error]', err.message);
    return res.status(502).json({ error: 'Gagal menghubungi Langflow AI.', detail: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// ENDPOINT 3 — GET /api/logs
// Returns full interaction history (WhatsApp + Web) for the dashboard
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const source = req.query.source; // optional filter: 'whatsapp' | 'web'

  const filtered = source
    ? messageHistory.filter(e => e.source === source)
    : messageHistory;

  return res.json({
    total:   filtered.length,
    entries: filtered.slice(0, limit)
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Catch-all: serve index.html for SPA routing
// ────────────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌿 Pendakian AI Server running at http://localhost:${PORT}`);
  console.log(`   Langflow API : ${LANGFLOW_API_URL}`);
  console.log(`   Static files : ${path.join(__dirname, 'public')}\n`);
});
