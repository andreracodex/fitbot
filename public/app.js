/**
 * FitBot AI — Frontend Client Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const messagesArea = document.getElementById('messagesArea');
  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const btnSend = document.getElementById('btnSend');
  const btnReset = document.getElementById('btnReset');
  const typingIndicator = document.getElementById('typingIndicator');
  const statusDot = document.getElementById('statusDot');
  const charCounter = document.getElementById('charCounter');
  const initialTime = document.getElementById('initialTime');
  const quickSuggestions = document.getElementById('quickSuggestions');

  // State
  let sessionId = getOrCreateSessionId();
  let isSending = false;

  // Inisialisasi waktu pembuka
  if (initialTime) {
    initialTime.textContent = formatCurrentTime();
  }

  // Periksa status server saat pertama kali dibuka
  checkServerHealth();

  // Event Listeners
  chatForm.addEventListener('submit', handleFormSubmit);
  messageInput.addEventListener('keydown', handleInputKeyDown);
  messageInput.addEventListener('input', handleInputChange);
  btnReset.addEventListener('click', handleResetChat);

  // Quick suggestion chips handler
  document.querySelectorAll('.chip-btn').forEach((chip) => {
    chip.addEventListener('click', () => {
      const text = chip.getAttribute('data-text');
      if (text && !isSending) {
        messageInput.value = text;
        handleInputChange();
        sendMessage(text);
      }
    });
  });

  /**
   * Mengambil sessionId dari sessionStorage atau membuat yang baru.
   */
  function getOrCreateSessionId() {
    let id = sessionStorage.getItem('fitbot_session_id');
    if (!id) {
      id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'sess_' + Math.random().toString(36).substring(2, 15);
      sessionStorage.setItem('fitbot_session_id', id);
    }
    return id;
  }

  /**
   * Format jam dan menit saat ini (HH:mm WIB).
   */
  function formatCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Memeriksa kesehatan server backend.
   */
  async function checkServerHealth() {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        statusDot.classList.add('online');
        statusDot.classList.remove('offline');
        statusDot.title = data.apiKeyConfigured
          ? 'FitBot AI Siap (Gemini API Terhubung)'
          : 'FitBot Server Aktif (API Key belum disetel)';
      } else {
        throw new Error('Server not ready');
      }
    } catch {
      statusDot.classList.add('offline');
      statusDot.classList.remove('online');
      statusDot.title = 'Server offline atau tidak terjangkau';
    }
  }

  /**
   * Menangani pengiriman formulir pesan.
   */
  function handleFormSubmit(e) {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || isSending) return;
    sendMessage(text);
  }

  /**
   * Auto-resize textarea dan kirim via Enter (tanpa Shift).
   */
  function handleInputKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFormSubmit(e);
    }
  }

  /**
   * Perbarui jumlah karakter dan sesuaikan tinggi textarea.
   */
  function handleInputChange() {
    const len = messageInput.value.length;
    charCounter.textContent = len;

    // Auto resize height
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + 'px';
  }

  /**
   * Mengirim pesan ke endpoint backend /api/chat.
   */
  async function sendMessage(text) {
    if (isSending) return;
    isSending = true;

    // Reset input
    messageInput.value = '';
    handleInputChange();
    btnSend.disabled = true;

    // Tampilkan pesan pengguna di layar
    appendMessage('user', text);

    // Sembunyikan saran cepat setelah interaksi pertama
    if (quickSuggestions) {
      quickSuggestions.style.display = 'none';
    }

    // Tampilkan indikator mengetik
    showTypingIndicator();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          message: text
        })
      });

      const data = await response.json();
      hideTypingIndicator();

      if (response.ok && data.reply) {
        appendMessage('bot', data.reply);
      } else {
        const errorMsg = data.error || data.reply || 'Terjadi gangguan saat memproses pesan.';
        appendMessage('bot', `⚠️ ${errorMsg}`);
      }
    } catch (err) {
      hideTypingIndicator();
      console.error('Fetch error:', err);
      appendMessage(
        'bot',
        '⚠️ Tidak dapat terhubung ke server FitBot. Pastikan server backend sedang aktif dan coba kembali.'
      );
    } finally {
      isSending = false;
      btnSend.disabled = false;
      messageInput.focus();
    }
  }

  /**
   * Menambahkan pesan ke tampilan chat.
   */
  function appendMessage(sender, rawText) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${sender}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = sender === 'user' ? '👤' : '🤖';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = `bubble ${sender}-bubble`;

    if (sender === 'bot') {
      bubble.innerHTML = renderFormattedMarkdown(rawText);
    } else {
      bubble.textContent = rawText;
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = formatCurrentTime();

    contentDiv.appendChild(bubble);
    contentDiv.appendChild(timeSpan);

    wrapper.appendChild(avatar);
    wrapper.appendChild(contentDiv);

    // Sisipkan sebelum typing indicator
    messagesArea.insertBefore(wrapper, typingIndicator);
    scrollToBottom();
  }

  /**
   * Parser Markdown sederhana untuk teks balasan AI:
   * Mengubah **bold**, - list items, dan baris baru dengan aman.
   */
  function renderFormattedMarkdown(text) {
    if (!text) return '';

    // Sanitasi teks dasar untuk mencegah XSS
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Format bold: **teks**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Format baris baru dan paragraf
    const lines = escaped.split('\n');
    let html = '';
    let inList = false;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${trimmed.substring(2)}</li>`;
      } else {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (trimmed.length > 0) {
          html += `<p>${trimmed}</p>`;
        }
      }
    });

    if (inList) {
      html += '</ul>';
    }

    return html || `<p>${escaped}</p>`;
  }

  function showTypingIndicator() {
    typingIndicator.style.display = 'flex';
    scrollToBottom();
  }

  function hideTypingIndicator() {
    typingIndicator.style.display = 'none';
  }

  function scrollToBottom() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }

  /**
   * Menghapus riwayat percakapan sesi dan mengulang chat (TC-10).
   */
  async function handleResetChat() {
    if (!confirm('Apakah Anda yakin ingin memulai percakapan baru dan menghapus riwayat sesi ini?')) {
      return;
    }

    try {
      await fetch('/api/chat/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId })
      });
    } catch (err) {
      console.warn('Gagal memanggil endpoint reset:', err);
    }

    // Buat sesi baru
    sessionStorage.removeItem('fitbot_session_id');
    sessionId = getOrCreateSessionId();

    // Hapus semua pesan kecuali pesan sambutan awal dan typing indicator
    const wrappers = messagesArea.querySelectorAll('.message-wrapper:not(:first-child):not(#typingIndicator)');
    wrappers.forEach((w) => w.remove());

    // Munculkan kembali tombol saran cepat
    if (quickSuggestions) {
      quickSuggestions.style.display = 'flex';
    }

    messageInput.value = '';
    handleInputChange();
    messageInput.focus();
  }
});
