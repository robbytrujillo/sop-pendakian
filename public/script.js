/**
 * script.js — Pendakian AI Frontend Logic
 * Vanilla JS: async/await fetch, DOM manipulation, dark mode, logs dashboard
 */

'use strict';

// ─── Backend Base URL ────────────────────────────────────────────────────────
// Selalu arahkan ke Express di port 3000, terlepas dari port dev-server yang
// membuka file ini (Live Server :5500, Vite :5173, dsb.).
const API_BASE = 'http://localhost:3000';

// ─── DOM References ─────────────────────────────────────────────────────────
const chatMessages    = document.getElementById('chat-messages');
const typingIndicator = document.getElementById('typing-indicator');
const chatForm        = document.getElementById('chat-form');
const chatInput       = document.getElementById('chat-input');
const sendBtn         = document.getElementById('send-btn');
const errorToast      = document.getElementById('error-toast');
const errorText       = document.getElementById('error-text');
const statusDot       = document.getElementById('status-dot');
const statusTxt       = document.getElementById('status-text');

const btnLogs         = document.getElementById('btn-logs');
const btnRefreshLogs  = document.getElementById('btn-refresh-logs');
const logsList        = document.getElementById('logs-list');
const mobileLogsList  = document.getElementById('mobile-logs-list');
const mobileDrawer    = document.getElementById('mobile-drawer');
const drawerOverlay   = document.getElementById('mobile-drawer-overlay');
const btnCloseDrawer  = document.getElementById('btn-close-drawer');

const btnTheme            = document.getElementById('btn-theme');
const iconSun             = document.getElementById('icon-sun');
const iconMoon            = document.getElementById('icon-moon');

// Toggle logs panel — tombol di app header (desktop)
const btnToggleChat   = document.getElementById('btn-toggle-chat');
const toggleChatIcon  = document.getElementById('toggle-chat-icon');
const toggleChatLabel = document.getElementById('toggle-chat-label');

// Logs aside panel (yang akan disembunyikan/ditampilkan)
const logsAside       = document.getElementById('logs-panel');

// ─── State ───────────────────────────────────────────────────────────────────
let currentLogFilter  = 'all';
let isWaitingResponse = false;
let logsVisible       = true; // tracks logs panel visibility

// ═══════════════════════════════════════════════════════════════════
// 1. DARK / LIGHT MODE
// ═══════════════════════════════════════════════════════════════════

/** Apply theme: 'dark' | 'light' */
function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
    iconSun.classList.remove('hidden');
    iconMoon.classList.add('hidden');
  } else {
    html.classList.remove('dark');
    iconSun.classList.add('hidden');
    iconMoon.classList.remove('hidden');
  }
  localStorage.setItem('pendakian-theme', theme);
}

// Restore saved theme on load
(function initTheme() {
  const saved = localStorage.getItem('pendakian-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
})();

btnTheme.addEventListener('click', () => {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(isDark ? 'light' : 'dark');
});

// ═══════════════════════════════════════════════════════════════════
// 2. TEXTAREA AUTO-RESIZE
// ═══════════════════════════════════════════════════════════════════

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 128) + 'px';
});

// ═══════════════════════════════════════════════════════════════════
// 3. CHAT SUBMIT — Enter key or Send button
// ═══════════════════════════════════════════════════════════════════

chatInput.addEventListener('keydown', (e) => {
  // Enter without Shift → submit; Shift+Enter → newline
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message || isWaitingResponse) return;

  sendMessage(message);
});

// ═══════════════════════════════════════════════════════════════════
// 4. CORE SEND / RECEIVE FLOW
// ═══════════════════════════════════════════════════════════════════

/**
 * Appends a chat bubble and requests AI reply from /api/chat
 * @param {string} message - User's input text
 */
async function sendMessage(message) {
  // 1. Clear input & reset height
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // 2. Render user bubble
  appendBubble('user', message);

  // 3. Show typing indicator
  setTyping(true);
  hideError();
  isWaitingResponse = true;
  sendBtn.disabled  = true;

  try {
    // 4. POST to backend
    const response = await fetch(`${API_BASE}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    // 5. Render AI reply bubble
    appendBubble('ai', data.reply || 'Maaf, tidak ada respons.');
    setStatus(true);
  } catch (err) {
    // 6. Show error toast
    showError(
      err.message.includes('Failed to fetch')
        ? 'Server tidak merespons. Pastikan `node server.js` sedang berjalan.'
        : `Error: ${err.message}`
    );
    setStatus(false);
    console.error('[sendMessage]', err);
  } finally {
    setTyping(false);
    isWaitingResponse = false;
    sendBtn.disabled  = false;
    chatInput.focus();
    // Reload logs panel silently after each message
    loadLogs();
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5. BUBBLE RENDERING
// ═══════════════════════════════════════════════════════════════════

/**
 * Creates and appends a message bubble to #chat-messages
 * @param {'user'|'ai'} role
 * @param {string}      text
 */
function appendBubble(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = `flex items-end gap-2 bubble-in ${role === 'user' ? 'flex-row-reverse' : ''}`;

  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  if (role === 'ai') {
    // AI avatar
    wrapper.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-forest flex-shrink-0 flex items-center justify-center">
        <svg class="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
        </svg>
      </div>
      <div class="max-w-[80%] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-2xl rounded-bl-none px-4 py-3 text-sm shadow-sm">
        <div class="prose-chat whitespace-pre-wrap leading-relaxed">${escapeHtml(text)}</div>
        <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 text-right">${now}</p>
      </div>`;
  } else {
    // User bubble (right-aligned, green)
    wrapper.innerHTML = `
      <div class="max-w-[80%] bg-forest text-white rounded-2xl rounded-br-none px-4 py-3 text-sm shadow-sm">
        <div class="whitespace-pre-wrap leading-relaxed">${escapeHtml(text)}</div>
        <p class="text-[10px] text-green-200 mt-1.5 text-right">${now}</p>
      </div>`;
  }

  chatMessages.appendChild(wrapper);
  scrollToBottom();
}

/** Scroll chat area to the latest message */
function scrollToBottom() {
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

/** Escape HTML special characters to prevent XSS */
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, c => map[c]);
}

// ═══════════════════════════════════════════════════════════════════
// 6. UI STATE HELPERS
// ═══════════════════════════════════════════════════════════════════

function setTyping(show) {
  typingIndicator.classList.toggle('hidden', !show);
  if (show) scrollToBottom();
}

function showError(msg) {
  errorText.textContent = msg;
  errorToast.classList.remove('hidden');
}

function hideError() {
  errorToast.classList.add('hidden');
}

function setStatus(online) {
  if (online) {
    statusDot.classList.remove('offline');
    statusDot.style.backgroundColor = '#16a34a';
    statusTxt.textContent = 'Online';
  } else {
    statusDot.classList.add('offline');
    statusDot.style.backgroundColor = '#f59e0b';
    statusTxt.textContent = 'Offline';
  }
}

// ═══════════════════════════════════════════════════════════════════
// 7. LOGS DASHBOARD
// ═══════════════════════════════════════════════════════════════════

/**
 * Fetches /api/logs and renders entries into both panels
 */
async function loadLogs() {
  try {
    const url      = `${API_BASE}/api/logs?limit=50${currentLogFilter !== 'all' ? '&source=' + currentLogFilter : ''}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data    = await response.json();
    const entries = data.entries || [];

    renderLogsTo(logsList,       entries);
    renderLogsTo(mobileLogsList, entries);
  } catch (err) {
    console.warn('[loadLogs]', err.message);
  }
}

/**
 * Renders log entries into a container element
 * @param {HTMLElement} container
 * @param {Array}       entries
 */
function renderLogsTo(container, entries) {
  if (!entries.length) {
    container.innerHTML = `
      <div class="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-600">
        Belum ada interaksi tersimpan.
      </div>`;
    return;
  }

  container.innerHTML = entries.map(entry => {
    const badgeClass = entry.source === 'whatsapp' ? 'badge-wa' : 'badge-web';
    const badgeLabel = entry.source === 'whatsapp' ? 'WhatsApp' : 'Web';
    const time = new Date(entry.timestamp).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    return `
      <div class="log-entry px-4 py-3 cursor-default">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] font-medium ${badgeClass} px-2 py-0.5 rounded-full">${badgeLabel}</span>
          <span class="text-[10px] text-slate-400 dark:text-slate-500">${time}</span>
        </div>
        <p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
          <span class="font-medium text-slate-700 dark:text-slate-200">Q:</span> ${escapeHtml(entry.message)}
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
          <span class="font-medium text-forest">A:</span> ${escapeHtml(entry.reply)}
        </p>
      </div>`;
  }).join('');
}

// Log filter buttons
document.querySelectorAll('.log-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentLogFilter = btn.dataset.filter;

    // Update active style
    document.querySelectorAll('.log-filter-btn').forEach(b => {
      b.classList.remove('active', 'bg-forest', 'text-white');
      b.classList.add('bg-slate-200', 'dark:bg-slate-700', 'text-slate-600', 'dark:text-slate-300');
    });
    btn.classList.add('active', 'bg-forest', 'text-white');
    btn.classList.remove('bg-slate-200', 'dark:bg-slate-700', 'text-slate-600', 'dark:text-slate-300');

    loadLogs();
  });
});

btnRefreshLogs.addEventListener('click', loadLogs);

// ═══════════════════════════════════════════════════════════════════
// 8. MOBILE DRAWER (Logs panel on mobile)
// ═══════════════════════════════════════════════════════════════════

function openDrawer() {
  mobileDrawer.classList.add('open');
  drawerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  loadLogs();
}

function closeDrawer() {
  mobileDrawer.classList.remove('open');
  drawerOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

btnLogs.addEventListener('click', () => {
  // On lg+ screens the aside panel is already visible; open drawer only on mobile
  const isLgScreen = window.matchMedia('(min-width: 1024px)').matches;
  if (isLgScreen) {
    loadLogs(); // just refresh the sidebar
  } else {
    openDrawer();
  }
});

btnCloseDrawer.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click',  closeDrawer);

// ═══════════════════════════════════════════════════════════════════
// 9. SERVER HEALTH CHECK
// Ping /api/logs on startup to determine online/offline status
// ═══════════════════════════════════════════════════════════════════

async function checkServerHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/logs?limit=1`);
    setStatus(res.ok);
  } catch {
    setStatus(false);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 10. TOGGLE LOGS PANEL VISIBILITY
// Tombol "Sembunyikan/Tampilkan" di header Riwayat Interaksi
// → menyembunyikan panel logs itu sendiri, bukan chat
// ═══════════════════════════════════════════════════════════════════

/** SVG path: mata terbuka (panel terlihat → akan disembunyikan) */
const EYE_OPEN_PATH  = 'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z';
/** SVG path: mata dicoret (panel tersembunyi → akan ditampilkan) */
const EYE_SLASH_PATH = 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21';

/** Sinkronkan label & ikon tombol toggle di header */
function syncToggleBtns() {
  // logsVisible = true  → panel tampil → ikon eye-slash, label "Sembunyikan"
  // logsVisible = false → tersembunyi  → ikon eye-open,  label "Tampilkan"
  const path  = logsVisible ? EYE_SLASH_PATH : EYE_OPEN_PATH;
  const label = logsVisible ? 'Sembunyikan Riwayat' : 'Tampilkan Riwayat';

  if (toggleChatIcon)  toggleChatIcon.querySelector('path').setAttribute('d', path);
  if (toggleChatLabel) toggleChatLabel.textContent = label;
}

/** Toggle: sembunyikan / tampilkan aside Riwayat Interaksi */
function toggleLogs() {
  logsVisible = !logsVisible;

  if (logsAside) {
    if (logsVisible) {
      logsAside.classList.remove('logs-hidden');
      logsAside.classList.add('logs-visible');
    } else {
      logsAside.classList.remove('logs-visible');
      logsAside.classList.add('logs-hidden');
    }
  }

  syncToggleBtns();
}

if (btnToggleChat) btnToggleChat.addEventListener('click', toggleLogs);

// ═══════════════════════════════════════════════════════════════════
// 11. FOOTER — isi tahun otomatis
// ═══════════════════════════════════════════════════════════════════

const footerYear = document.getElementById('footer-year');
if (footerYear) footerYear.textContent = new Date().getFullYear();

// ═══════════════════════════════════════════════════════════════════
// 12. INIT
// ═══════════════════════════════════════════════════════════════════

(async function init() {
  await checkServerHealth();
  await loadLogs();
  syncToggleBtns(); // ikon & label awal sesuai logsVisible = true
  chatInput.focus();
})();
