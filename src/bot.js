const { Telegraf } = require('telegraf');
const { parseReminder, formatDate } = require('./parser');
const { queries } = require('./db');
const { sendReminder } = require('./email');
const path = require('path');
const fs = require('fs');
const speech = require('@google-cloud/speech');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

let bot = null;
let defaultEmail = process.env.REMINDER_EMAIL;

// Simpan email per user (chat_id → email)
const userEmails = new Map();

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// ==================== Voice Processing ====================

async function transcribeAudio(audioFilePath) {
  try {
    const client = new speech.SpeechClient();
    const audioBytes = fs.readFileSync(audioFilePath).toString('base64');

    const request = {
      audio: { content: audioBytes },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'id-ID',
        alternativeLanguageCodes: ['en-US'],
      },
    };

    const [response] = await client.recognize(request);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join('\n');

    return transcription || null;
  } catch (error) {
    console.error('❌ Error transcribing audio:', error.message);
    return null;
  }
}

function convertOggToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

async function downloadTelegramFile(fileId, destPath) {
  try {
    const fileLink = await bot.telegram.getFileLink(fileId);
    const url = fileLink.href;

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? require('https') : require('http');
      const file = fs.createWriteStream(destPath);

      protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          downloadTelegramFile(fileId, destPath).then(resolve).catch(reject);
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(destPath);
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
  } catch (error) {
    console.error('❌ Error downloading file:', error);
    throw error;
  }
}

function cleanupFile(filePath) {
  setTimeout(() => {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== 'ENOENT') console.error('Error deleting temp file:', err);
    });
  }, 5000);
}

// ==================== Save Todo Helper ====================

function saveTodo(ctx, task, deadline, reminderTime) {
  const email = userEmails.get(ctx.chat.id) || defaultEmail;

  if (!email) {
    ctx.reply(
      `📧 Email belum di-set!\n\nSet dulu: /setemail email@kamu.com`
    );
    return false;
  }

  queries.addTodo.run({
    chatId: ctx.chat.id,
    task: task,
    deadline: deadline.toISOString(),
    reminderTime: reminderTime.toISOString(),
    email: email,
  });

  const deadlineStr = formatDate(deadline);
  const reminderStr = formatDate(reminderTime);

  ctx.reply(
    `✅ *Reminder disimpan!*\n\n` +
    `📋 *Task:* ${task}\n` +
    `📅 *Deadline:* ${deadlineStr}\n` +
    `⏰ *Reminder:* ${reminderStr}\n` +
    `📧 *Email:* ${email}`,
    { parse_mode: 'Markdown' }
  );

  return true;
}

// ==================== Bot Initialization ====================

function initBot() {
  bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  // Pastiin folder temp ada
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Middleware: log setiap pesan
  bot.use((ctx, next) => {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text || ctx.message?.voice ? '[voice]' : '';
    console.log(`💬 [${chatId}] ${text}`);
    return next();
  });

  // ==================== Commands ====================

  // /start
  bot.start((ctx) => {
    const name = ctx.from.first_name || 'User';
    ctx.reply(
      `👋 Halo ${name}! Gw Todo Reminder Bot!\n\n` +
      `Cara pakai:\n` +
      `• /remind <task> <waktu>\n` +
      `• Kirim voice note (ucapkan tugas + waktu)\n` +
      `• /setemail <email>\n` +
      `• /list\n` +
      `• /done <nomor>\n` +
      `• /delete <nomor>\n` +
      `• /help\n\n` +
      `Contoh:\n` +
      `/remind tugas A hari rabu\n` +
      `/remind beli susu besok pagi\n` +
      `/remind meeting client senin depan jam 2 siang\n\n` +
      `🎤 Atau kirim voice note:\n` +
      `"Belajar Node.js besok jam 3 sore"`
    );
  });

  // /help
  bot.help((ctx) => {
    ctx.reply(
      `📖 *Command List*\n\n` +
      `/remind <task> <waktu> — Tambah reminder baru\n` +
      `/setemail <email> — Set email untuk reminder\n` +
      `/list — Lihat semua todo\n` +
      `/done <nomor> — Tandai selesai\n` +
      `/delete <nomor> — Hapus todo\n` +
      `/help — Bantuan\n\n` +
      `*🎤 Voice Note:*\n` +
      `Kirim voice note dengan tugas dan waktu,\n` +
      `contoh: "Belajar besok jam 3 sore"\n\n` +
      `*Format Waktu:*\n` +
      `• hari senin/selasa/rabu/...\n` +
      `• besok / lusa\n` +
      `• 3 hari lagi / 2 minggu lagi\n` +
      `• jam 14:00 / jam 2 siang\n\n` +
      `*Contoh:*\n` +
      `/remind presentasi hari kamis jam 10 pagi\n` +
      `/remind bayar tagihan 3 hari lagi`,
      { parse_mode: 'Markdown' }
    );
  });

  // /setemail
  bot.command('setemail', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const email = args[0];

    if (!email || !email.includes('@')) {
      return ctx.reply('❌ Format: /setemail email@kamu.com');
    }

    userEmails.set(ctx.chat.id, email);
    ctx.reply(`✅ Email di-set ke: ${email}\nSemua reminder akan dikirim ke email ini.`);
  });

  // /remind
  bot.command('remind', (ctx) => {
    const text = ctx.message.text;
    const taskText = text.replace(/^\/remind\s*/i, '').trim();

    if (!taskText) {
      return ctx.reply('❌ Format: /remind <task> <waktu>\nContoh: /remind tugas A hari rabu');
    }

    const result = parseReminder(taskText);

    if (!result.deadline) {
      return ctx.reply(
        `❌ Gw gak ngerti waktu-nya 😅\n\n` +
        `Coba pakai format:\n` +
        `• /remind tugas A hari rabu\n` +
        `• /remind beli susu besok pagi\n` +
        `• /remind meeting 3 hari lagi`
      );
    }

    saveTodo(ctx, result.task, result.deadline, result.reminderTime);
  });

  // /list
  bot.command('list', (ctx) => {
    const todos = queries.getTodosByChat.all(ctx.chat.id);

    if (todos.length === 0) {
      return ctx.reply('📭 Tidak ada todo! Tambah dengan /remind atau kirim voice note.');
    }

    let msg = `📋 *Daftar Todo (${todos.length}):*\n\n`;
    todos.forEach((todo, i) => {
      const deadline = formatDate(new Date(todo.deadline));
      const status = todo.status === 'done' ? '✅' : (todo.reminded ? '🔔' : '⏳');
      msg += `${i + 1}. ${status} *${todo.task}*\n`;
      msg += `   📅 ${deadline}\n`;
      msg += `   🆔 ID: \`${todo.id}\`\n\n`;
    });

    msg += `\n/done <nomor> — Tandai selesai\n/delete <nomor> — Hapus`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /done
  bot.command('done', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const index = parseInt(args[0]) - 1;

    if (isNaN(index)) {
      return ctx.reply('❌ Format: /done <nomor>\nCek nomor dengan /list');
    }

    const todos = queries.getTodosByChat.all(ctx.chat.id);
    if (index < 0 || index >= todos.length) {
      return ctx.reply(`❌ Nomor tidak valid. Pilih 1-${todos.length}`);
    }

    const todo = todos[index];
    queries.markDone.run(todo.id, ctx.chat.id);

    ctx.reply(`✅ *"${todo.task}"* ditandai selesai! 🎉`, { parse_mode: 'Markdown' });
  });

  // /delete
  bot.command('delete', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const index = parseInt(args[0]) - 1;

    if (isNaN(index)) {
      return ctx.reply('❌ Format: /delete <nomor>\nCek nomor dengan /list');
    }

    const todos = queries.getTodosByChat.all(ctx.chat.id);
    if (index < 0 || index >= todos.length) {
      return ctx.reply(`❌ Nomor tidak valid. Pilih 1-${todos.length}`);
    }

    const todo = todos[index];
    queries.deleteTodo.run(todo.id, ctx.chat.id);

    ctx.reply(`🗑️ *"${todo.task}"* dihapus!`, { parse_mode: 'Markdown' });
  });

  // ==================== Voice Note Handler ====================

  bot.on('voice', async (ctx) => {
    try {
      const voice = ctx.message.voice;
      const chatId = ctx.chat.id;
      const timestamp = Date.now();

      const oggPath = path.join(TEMP_DIR, `voice_${chatId}_${timestamp}.ogg`);
      const wavPath = path.join(TEMP_DIR, `voice_${chatId}_${timestamp}.wav`);

      await ctx.reply('🎤 Processing voice note...');
      await downloadTelegramFile(voice.file_id, oggPath);

      await ctx.reply('🔄 Converting audio...');
      await convertOggToWav(oggPath, wavPath);

      await ctx.reply('📝 Transcribing...');
      const transcription = await transcribeAudio(wavPath);

      // Cleanup temp files
      cleanupFile(oggPath);
      cleanupFile(wavPath);

      if (!transcription) {
        return ctx.reply('❌ Gagal transcribe voice note. Coba lagi ya.');
      }

      // Parse todo dari text
      const result = parseReminder(transcription);

      if (!result.deadline) {
        return ctx.reply(
          `📝 *Hasil Transcribe:*\n"${transcription}"\n\n` +
          `❌ Waktu tidak dikenali. Coba sebut waktu yang jelas.\n` +
          `Contoh: "Belajar besok jam 3 sore"`,
          { parse_mode: 'Markdown' }
        );
      }

      const saved = saveTodo(ctx, result.task, result.deadline, result.reminderTime);

      if (saved) {
        // Tambahkan info transcribe
        ctx.reply(
          `📝 *Voice Note:* "${transcription}"`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      console.error('❌ Error handling voice:', error);
      ctx.reply('❌ Error processing voice note. Coba lagi ya.');
    }
  });

  // ==================== Auto-parse Text Messages ====================

  bot.on('text', (ctx) => {
    const text = ctx.message.text;

    // Skip commands
    if (text.startsWith('/')) return;

    // Coba parse sebagai reminder
    const result = parseReminder(text);

    if (result.deadline) {
      saveTodo(ctx, result.task, result.deadline, result.reminderTime);
    } else {
      ctx.reply(
        `🤔 Gw gak ngerti. Coba:\n\n` +
        `/remind tugas A hari rabu\n` +
        `Atau kirim voice note!\n` +
        `/help — lihat semua command`
      );
    }
  });

  return bot;
}

function getBot() {
  return bot;
}

module.exports = { initBot, getBot };
