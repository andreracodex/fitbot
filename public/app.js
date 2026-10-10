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
   * Membuat bubble pesan bot baru yang siap diperbarui secara streaming.
   */
  function createStreamingBotMessage() {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper bot';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = '<img src="fifi.webp" alt="Fifi" class="avatar-photo-sm">';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'bubble bot-bubble';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = formatCurrentTime();

    contentDiv.appendChild(bubble);
    contentDiv.appendChild(timeSpan);
    wrapper.appendChild(avatar);
    wrapper.appendChild(contentDiv);

    messagesArea.insertBefore(wrapper, typingIndicator);

    return {
      update: (text) => {
        bubble.innerHTML = renderFormattedMarkdown(text);
        scrollToBottom();
      },
      setError: (err) => {
        bubble.textContent = `[Info] ${err}`;
        scrollToBottom();
      }
    };
  }

  /**
   * Mengirim pesan ke endpoint backend streaming /api/chat/stream.
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
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          message: text
        })
      });

      hideTypingIndicator();

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        appendMessage('bot', errorData.error || 'Gagal menghubungi server chatbot.');
        return;
      }

      const streamHandle = createStreamingBotMessage();
      let accumulatedText = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.substring(6));
              if (data.chunk) {
                accumulatedText += data.chunk;
                streamHandle.update(accumulatedText);
              }
              if (data.error) {
                streamHandle.setError(data.error);
              }
            } catch (e) {
              // Abaikan parsing line fragment
            }
          }
        }
      }

      if (!accumulatedText.trim()) {
        streamHandle.update('Tidak ada balasan yang diterima dari model AI.');
      }
    } catch (err) {
      hideTypingIndicator();
      console.error('Streaming fetch error:', err);
      appendMessage(
        'bot',
        'Tidak dapat terhubung ke server FitBot. Pastikan server backend sedang aktif dan coba kembali.'
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
    if (sender === 'bot') {
      avatar.innerHTML = '<img src="fifi.webp" alt="Fifi" class="avatar-photo-sm">';
    } else {
      avatar.innerHTML = '<svg style="width: 16px; height: 16px; color: #f59e0b;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>';
    }

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
   * Parser Markdown untuk teks balasan AI:
   * Mengubah **bold**, *italic*, list (unordered & ordered), header, code, dan baris baru.
   */
  function renderFormattedMarkdown(text) {
    if (!text) return '';

    if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
      try {
        window.marked.setOptions({ breaks: true, gfm: true });
        return window.marked.parse(text);
      } catch (e) {
        console.warn('Marked parse error, fallback to regex parser:', e);
      }
    }

    // Sanitasi teks dasar untuk mencegah XSS
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Format Bold + Italic: ***teks*** atau ___teks___
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');

    // Format Bold: **teks** atau __teks__
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

    // Format Italic: *teks* atau _teks_
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');

    // Format Code Inline: `code`
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    // Format baris baru dan struktur paragraf/list
    const lines = html.split('\n');
    let result = '';
    let inUl = false;
    let inOl = false;

    lines.forEach((line) => {
      const trimmed = line.trim();
      const isUl = /^[*\-]\s+/.test(trimmed);
      const isOl = /^\d+\.\s+/.test(trimmed);

      if (isUl) {
        if (inOl) { result += '</ol>'; inOl = false; }
        if (!inUl) { result += '<ul>'; inUl = true; }
        result += `<li>${trimmed.replace(/^[*\-]\s+/, '')}</li>`;
      } else if (isOl) {
        if (inUl) { result += '</ul>'; inUl = false; }
        if (!inOl) { result += '<ol>'; inOl = true; }
        result += `<li>${trimmed.replace(/^\d+\.\s+/, '')}</li>`;
      } else {
        if (inUl) { result += '</ul>'; inUl = false; }
        if (inOl) { result += '</ol>'; inOl = false; }
        if (trimmed.length > 0) {
          result += `<p>${trimmed}</p>`;
        }
      }
    });

    if (inUl) result += '</ul>';
    if (inOl) result += '</ol>';

    return result || `<p>${html}</p>`;
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
