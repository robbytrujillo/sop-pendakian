/**
 * wa-gateway.js — WhatsApp Bot Gateway
 * Menghubungkan WhatsApp ke Express backend (server.js) via HTTP.
 *
 * Cara kerja:
 *   1. Scan QR code dengan WhatsApp di HP (sekali saja, sesi tersimpan)
 *   2. Setiap pesan masuk → diteruskan ke POST /webhook/whatsapp di server.js
 *   3. Balasan AI dikembalikan langsung ke pengirim WhatsApp
 *
 * Jalankan (terminal terpisah dari server.js):
 *   node wa-gateway.js
 */

'use strict';

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode    = require('qrcode-terminal');
const QRCode    = require('qrcode');

// ─── Konfigurasi ─────────────────────────────────────────────────────────────
const BACKEND_URL    = process.env.BACKEND_URL   || 'http://localhost:3000';
const WEBHOOK_PATH   = '/webhook/whatsapp';
const RECONNECT_DELAY = 5000; // ms — jeda sebelum reconnect saat disconnect

// Pesan penolakan untuk grup (bot hanya melayani chat personal)
const MSG_GROUP_IGNORE = null; // set ke string jika ingin balas di grup

// Pesan error saat backend tidak merespons
const MSG_ERROR =
  '⚠️ Maaf, sistem sedang mengalami gangguan teknis.\n' +
  'Silakan coba beberapa saat lagi atau hubungi petugas posko UPT setempat.';

// ─── Inisialisasi WhatsApp Client ─────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({
    // Sesi disimpan di folder .wwebjs_auth/ — tidak perlu scan QR ulang
    clientId: 'pendakian-ai'
  }),
  puppeteer: {
    // Jalankan browser tanpa GUI (headless)
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

// ─── Event: QR Code ──────────────────────────────────────────────────────────
client.on('qr', async (qr) => {
  console.log('\n📱 Scan QR code berikut dengan WhatsApp:\n');

  // Render QR sekecil mungkin di terminal (1 blok = 1 modul)
  qrcode.generate(qr, { small: true });

  // Alternatif: simpan sebagai file PNG agar bisa dibuka di browser/explorer
  try {
    await QRCode.toFile('wa-qr.png', qr, { width: 256, margin: 2 });
    console.log('\n💡 QR terlalu besar di terminal? Buka file: wa-qr.png');
    console.log('   (ada di folder proyek, ukuran 256×256 px)\n');
  } catch (_) { /* abaikan jika tidak bisa tulis file */ }

  console.log('Buka WhatsApp → Perangkat Tertaut → Tautkan Perangkat\n');
});

// ─── Event: Loading Screen ───────────────────────────────────────────────────
client.on('loading_screen', (percent, message) => {
  process.stdout.write(`\r⏳ Memuat WhatsApp... ${percent}% — ${message}   `);
});

// ─── Event: Authenticated ────────────────────────────────────────────────────
client.on('authenticated', () => {
  console.log('\n✅ Autentikasi berhasil — sesi tersimpan.');
});

// ─── Event: Auth Failure ─────────────────────────────────────────────────────
client.on('auth_failure', (msg) => {
  console.error('\n❌ Autentikasi gagal:', msg);
  console.error('   Hapus folder .wwebjs_auth/ lalu jalankan ulang untuk scan QR baru.');
  process.exit(1);
});

// ─── Event: Ready ────────────────────────────────────────────────────────────
client.on('ready', () => {
  console.log('\n🌿 WhatsApp Gateway siap!');
  console.log(`   Nomor aktif : ${client.info?.wid?.user ?? 'tidak diketahui'}`);
  console.log(`   Backend URL : ${BACKEND_URL}${WEBHOOK_PATH}`);
  console.log('   Menunggu pesan masuk...\n');
});

// ─── Event: Disconnected ─────────────────────────────────────────────────────
client.on('disconnected', (reason) => {
  console.warn(`\n⚡ WhatsApp terputus: ${reason}`);
  console.log(`   Mencoba reconnect dalam ${RECONNECT_DELAY / 1000} detik...`);
  setTimeout(() => client.initialize(), RECONNECT_DELAY);
});

// ─── Helper: Kirim pesan ke backend, terima balasan AI ───────────────────────
/**
 * @param {string} sender  — nomor WA pengirim, format "628xxx@c.us"
 * @param {string} message — teks pesan dari pengirim
 * @returns {Promise<string>} teks balasan dari AI
 */
async function getAIReply(sender, message) {
  // Normalisasi sender: ambil nomor saja (hapus "@c.us")
  const phone = sender.replace('@c.us', '').replace('@s.whatsapp.net', '');

  const response = await fetch(`${BACKEND_URL}${WEBHOOK_PATH}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sender: phone, message })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.reply || 'Maaf, tidak ada respons dari AI.';
}

// ─── Helper: Format markdown WhatsApp ────────────────────────────────────────
// Langflow sudah menjawab dalam format WA-friendly (*bold*, bullet)
// Fungsi ini memastikan tidak ada karakter yang merusak format WA
function formatForWhatsApp(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '*$1*')  // **bold** → *bold* (WA style)
    .replace(/#{1,6}\s/g, '*')          // Heading markdown → bold WA
    .trim();
}

// ─── Event: Message ──────────────────────────────────────────────────────────
client.on('message', async (msg) => {
  try {
    // ── 1. Filter: abaikan pesan sistem, status, media tanpa caption ─────────
    if (msg.type === 'sticker' || msg.type === 'audio' || msg.type === 'voice') return;
    if (msg.isStatus) return;

    // ── 2. Ambil teks pesan (bisa dari body atau caption media) ──────────────
    const text = (msg.body || msg.caption || '').trim();
    if (!text) return;

    // ── 3. Filter grup ────────────────────────────────────────────────────────
    if (msg.isGroupMsg || msg.from.includes('@g.us')) {
      if (MSG_GROUP_IGNORE) await msg.reply(MSG_GROUP_IGNORE);
      return;
    }

    // ── 4. Normalisasi sender ID ──────────────────────────────────────────────
    // WhatsApp baru menggunakan format @lid (Linked Device ID) selain @c.us
    // Normalkan ke nomor saja agar session_id di Langflow konsisten
    const rawSender = msg.from || '';
    const sender    = rawSender
      .replace('@c.us', '')
      .replace('@s.whatsapp.net', '')
      .replace('@lid', '')
      .split(':')[0]; // handle format "number:device@lid"

    console.log(`[WA IN]  ${sender} : ${text.slice(0, 80)}`);

    // ── 5. Kirim pesan "sedang memproses" agar user tidak menunggu bingung ────
    try {
      await msg.reply(
        '⏳ Mohon tunggu, sedang mencari informasi dari SOP resmi...'
      );
    } catch (_) { /* lanjutkan meski gagal */ }

    // ── 6. Typing indicator — opsional, jangan crash jika gagal ──────────────
    let chat = null;
    try {
      chat = await msg.getChat();
      await chat.sendStateTyping();
    } catch (chatErr) {
      console.warn(`[WA WARN] Typing indicator gagal (${chatErr.message}) — dilanjutkan`);
    }

    // ── 7. Minta balasan AI dari backend ──────────────────────────────────────
    const reply     = await getAIReply(sender, text);
    const formatted = formatForWhatsApp(reply);

    // ── 8. Balas ke pengirim ──────────────────────────────────────────────────
    await msg.reply(formatted);
    console.log(`[WA OUT] ${sender} : ${formatted.slice(0, 80)}...`);

  } catch (err) {
    // ── Tangkap semua error agar proses tidak crash ───────────────────────────
    console.error(`[WA ERR] ${err.message}`);
    try { await msg.reply(MSG_ERROR); } catch (_) { /* abaikan jika reply juga gagal */ }
  }
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n🛑 ${signal} diterima — menutup koneksi WhatsApp...`);
  try {
    await client.destroy();
    console.log('   WhatsApp Gateway berhenti dengan bersih.');
  } catch (_) { /* abaikan error saat shutdown */ }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── Start ────────────────────────────────────────────────────────────────────
console.log('🚀 Memulai WhatsApp Gateway...');
console.log('   Ctrl+C untuk berhenti\n');
client.initialize();
