import { Telegraf } from 'telegraf';
import { sendMessage } from '../services/gemini.js';

let botInstance = null;

/**
 * Menjalankan bot Telegram jika diaktifkan di .env
 */
export async function startTelegramBot() {
  const isEnabled = process.env.ENABLE_TELEGRAM === 'true';
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!isEnabled) {
    console.log('ℹ️  Telegram Bot: Dinonaktifkan (ENABLE_TELEGRAM=false)');
    return null;
  }

  if (!token || token.trim() === '' || token === 'your_telegram_bot_token_here') {
    console.warn('⚠️  Telegram Bot: Diaktifkan tetapi TELEGRAM_BOT_TOKEN belum disetel.');
    return null;
  }

  try {
    const bot = new Telegraf(token.trim());

    // Command /start
    bot.start(async (ctx) => {
      const name = ctx.from.first_name || 'Kak';
      await ctx.reply(
        `Halo ${name}, saya Fifi, personal wellness assistant di FitLife Arena Gym.\n\n` +
        `Bagaimana saya dapat membantu rencana kebugaran Anda hari ini? Anda dapat menanyakan tentang fasilitas, jam operasional cabang, atau opsi membership resmi.`
      );
    });

    // Handle Pesan Teks
    bot.on('text', async (ctx) => {
      const sessionId = `tg_${ctx.chat.id}`;
      const userText = ctx.message.text;
      const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Pengguna Telegram';
      const userContact = ctx.from.username ? `@${ctx.from.username}` : `ID: ${ctx.from.id}`;

      try {
        await ctx.sendChatAction('typing');
        const reply = await sendMessage(sessionId, userText, {
          channel: 'telegram',
          userName,
          userContact
        });

        await ctx.reply(reply);
      } catch (err) {
        console.error('[Telegram Error]:', err.message);
        await ctx.reply('Maaf Kak, Fifi sedang mengalami kendala jaringan. Silakan coba lagi ya!');
      }
    });

    bot.catch((err, ctx) => {
      console.error(`[Telegram Handler Error for ${ctx.updateType}]:`, err.message);
    });

    bot.launch();
    botInstance = bot;
    console.log('🤖 Telegram Bot Fifi aktif dan mendengarkan pesan...');

    // Graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    return bot;
  } catch (err) {
    console.error('❌ Gagal menginisialisasi Telegram Bot:', err.message);
    return null;
  }
}

export function stopTelegramBot() {
  if (botInstance) {
    botInstance.stop('STOP');
    botInstance = null;
  }
}
