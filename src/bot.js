const { Telegraf } = require('telegraf');
const { parseReminder, formatDate, generateHint, detectCategory, detectUrgency } = require('./parser');
const { queries } = require('./db');
const { sendReminder } = require('./email');
const { parseWithLLM, generateResponse, generateHintWithLLM } = require('./llm');
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

// ==================== Hybrid Parser (LLM + Regex) ====================

async function parseReminderHybrid(text) {
  // Coba LLM dulu
  const llmResult = await parseWithLLM(text);

  if (llmResult && llmResult.confidence >= 0.5) {
    // LLM berhasil parse dengan confidence tinggi
    const deadline = new Date(`${llmResult.date}T${llmResult.time || '09:00'}:00`);

    // Validasi tanggal
    if (!isNaN(deadline.getTime())) {
      // Hitung reminder time
      let reminderTime;
      const now = new Date();

      if (llmResult.reminder_time) {
        // User tentukan jam reminder sendiri
        reminderTime = new Date(deadline);
        const [rh, rm] = llmResult.reminder_time.split(':').map(Number);
        reminderTime.setHours(rh, rm, 0, 0);

        // Jika reminder jam > deadline jam, reminder adalah hari sebelumnya
        if (reminderTime >= deadline) {
          reminderTime.setDate(reminderTime.getDate() - 1);
        }
      } else {
        // Default logic
        reminderTime = new Date(deadline);
        if (deadline.getHours() <= 10) {
          reminderTime.setDate(reminderTime.getDate() - 1);
          reminderTime.setHours(20, 0, 0, 0);
        } else {
          reminderTime.setHours(reminderTime.getHours() - 1);
        }
      }

      // Jika reminder time sudah lewat, set ke 1 menit dari sekarang
      if (reminderTime <= now) {
        reminderTime = new Date(now.getTime() + 60 * 1000);
      }

      return {
        task: llmResult.task,
        deadline: deadline,
        reminderTime: reminderTime,
        category: llmResult.category || 'general',
        urgency: llmResult.urgency || 'normal',
        raw: text,
        source: 'llm',
      };
    }
  }

  // Fallback ke regex parser
  const regexResult = parseReminder(text);
  return { ...regexResult, source: 'regex' };
}

// ==================== Voice Processing ====================

async function transcribeAudio(audioFilePath) {
  try {
    // Support API key atau default credentials
    const clientOptions = process.env.GOOGLE_CLOUD_API_KEY
      ? { apiKey: process.env.GOOGLE_CLOUD_API_KEY }
      : {};
    const client = new speech.SpeechClient(clientOptions);
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

function saveTodo(ctx, task, deadline, reminderTime, category = 'general', urgency = 'normal') {
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
    priority: urgency,
    category: category,
  });

  const deadlineStr = formatDate(deadline);
  const reminderStr = formatDate(reminderTime);

  // Smart response berdasarkan konteks
  const now = new Date();
  const diff = deadline - now;
  const hoursLeft = Math.floor(diff / (1000 * 60 * 60));
  const daysLeft = Math.floor(hoursLeft / 24);

  // Category emoji
  const categoryEmojis = {
    kuliah: '📚',
    kerja: '💼',
    belanja: '🛒',
    kesehatan: '🏥',
    pribadi: '🎉',
    keuangan: '💰',
    general: '📋',
  };
  const categoryEmoji = categoryEmojis[category] || '📋';

  // Urgency indicator
  let urgencyIndicator = '';
  if (urgency === 'urgent' || daysLeft <= 1) {
    urgencyIndicator = '🔴 *URGENT!* ';
  } else if (daysLeft <= 3) {
    urgencyIndicator = '🟡 ';
  } else {
    urgencyIndicator = '🟢 ';
  }

  // Time context
  let timeContext = '';
  if (daysLeft <= 0 && hoursLeft <= 0) {
    timeContext = '⚠️ *Waktu sudah lewat!*';
  } else if (daysLeft <= 0) {
    timeContext = `⏰ *${hoursLeft} jam lagi!*`;
  } else if (daysLeft === 1) {
    timeContext = '📅 *Besok!*';
  } else if (daysLeft <= 7) {
    timeContext = `📅 *${daysLeft} hari lagi*`;
  }

  ctx.reply(
    `${urgencyIndicator}✅ *Reminder disimpan!*\n\n` +
    `${categoryEmoji} *Task:* ${task}\n` +
    `📅 *Deadline:* ${deadlineStr}\n` +
    `⏰ *Reminder:* ${reminderStr}\n` +
    `📧 *Email:* ${email}\n` +
    (timeContext ? `\n${timeContext}` : ''),
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
      `Gw bisa bantu kamu manage todo & reminder.\n\n` +
      `*Cara pakai:*\n` +
      `• /remind <task> <waktu>\n` +
      `• Kirim voice note (ucapkan tugas + waktu)\n` +
      `• Ketik langsung aja, gw auto-detect!\n\n` +
      `*Commands:*\n` +
      `/today — Todo hari ini\n` +
      `/tomorrow — Todo besok\n` +
      `/upcoming — 7 hari ke depan\n` +
      `/list — Semua todo\n` +
      `/stats — Statistik\n` +
      `/search <keyword> — Cari todo\n` +
      `/setemail <email>\n` +
      `/help — Bantuan\n\n` +
      `*Contoh input:*\n` +
      `• "Tugas A besok jam 3 sore"\n` +
      `• "Meeting client senin depan"\n` +
      `• "Beli susu 3 hari lagi"`,
      { parse_mode: 'Markdown' }
    );
  });

  // /help
  bot.help((ctx) => {
    ctx.reply(
      `📖 *Command List*\n\n` +
      `*📋 Todo:*\n` +
      `/remind <task> <waktu> — Tambah reminder\n` +
      `/list — Lihat semua todo\n` +
      `/done <nomor> — Tandai selesai\n` +
      `/delete <nomor> — Hapus todo\n\n` +
      `*🔍 Lihat Todo:*\n` +
      `/today — Hari ini\n` +
      `/tomorrow — Besok\n` +
      `/upcoming — 7 hari ke depan\n` +
      `/search <keyword> — Cari todo\n` +
      `/stats — Statistik\n\n` +
      `*⚙️ Settings:*\n` +
      `/setemail <email> — Set email reminder\n\n` +
      `*🎤 Voice Note:*\n` +
      `Kirim voice note dengan tugas dan waktu\n\n` +
      `*Format Waktu:*\n` +
      `• hari senin/selasa/rabu/...\n` +
      `• besok / lusa / nanti\n` +
      `• 3 hari lagi / 2 minggu lagi\n` +
      `• jam 14:00 / jam 2 siang\n\n` +
      `*💡 Tips:*\n` +
      `• Tambah kata "urgent" untuk prioritas tinggi\n` +
      `• Gw auto-detect kategori (kuliah, kerja, dll)\n` +
      `• Kirim teks langsung, gw coba pahami!`,
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
    ctx.reply(`✅ Email di-set ke: ${email}\n📧 Semua reminder akan dikirim ke email ini.`);
  });

  // /remind
  bot.command('remind', async (ctx) => {
    const text = ctx.message.text;
    const taskText = text.replace(/^\/remind\s*/i, '').trim();

    if (!taskText) {
      return ctx.reply(
        `❌ Format: /remind <task> <waktu>\n\n` +
        `Contoh:\n` +
        `• /remind tugas A hari rabu\n` +
        `• /remind beli susu besok pagi\n` +
        `• /remind meeting urgent senin depan`
      );
    }

    const result = await parseReminderHybrid(taskText);

    if (!result.deadline) {
      // Beri hint yang helpful (coba LLM dulu)
      const llmHint = await generateHintWithLLM(taskText);
      const hints = generateHint(taskText);

      let msg = `❌ Gw gak ngerti waktu-nya 😅\n\n`;
      if (llmHint) {
        msg += `💡 *${llmHint}*\n\n`;
      } else if (hints.length > 0) {
        msg += `*Saran:*\n`;
        hints.forEach(h => { msg += `• ${h}\n`; });
        msg += '\n';
      }
      msg += `*Contoh:*\n` +
        `• /remind tugas A hari rabu\n` +
        `• /remind beli susu besok pagi\n` +
        `• /remind meeting 3 hari lagi`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    saveTodo(ctx, result.task, result.deadline, result.reminderTime, result.category, result.urgency);
  });

  // /today
  bot.command('today', (ctx) => {
    const todos = queries.getTodayTodos.all(ctx.chat.id);

    if (todos.length === 0) {
      return ctx.reply('📭 Tidak ada todo untuk hari ini! 🎉');
    }

    let msg = `📋 *Todo Hari Ini (${todos.length}):*\n\n`;
    todos.forEach((todo, i) => {
      const deadline = new Date(todo.deadline);
      const hours = String(deadline.getHours()).padStart(2, '0');
      const minutes = String(deadline.getMinutes()).padStart(2, '0');
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);

      msg += `${i + 1}. ${status} ${categoryEmoji} *${todo.task}*\n`;
      msg += `   ⏰ Jam ${hours}:${minutes}\n\n`;
    });

    msg += `/done <nomor> — Tandai selesai`;
    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /tomorrow
  bot.command('tomorrow', (ctx) => {
    const todos = queries.getTomorrowTodos.all(ctx.chat.id);

    if (todos.length === 0) {
      return ctx.reply('📭 Tidak ada todo untuk besok! 🎉');
    }

    let msg = `📋 *Todo Besok (${todos.length}):*\n\n`;
    todos.forEach((todo, i) => {
      const deadline = new Date(todo.deadline);
      const hours = String(deadline.getHours()).padStart(2, '0');
      const minutes = String(deadline.getMinutes()).padStart(2, '0');
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);

      msg += `${i + 1}. ${status} ${categoryEmoji} *${todo.task}*\n`;
      msg += `   ⏰ Jam ${hours}:${minutes}\n\n`;
    });

    msg += `/done <nomor> — Tandai selesai`;
    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /upcoming
  bot.command('upcoming', (ctx) => {
    const todos = queries.getUpcomingTodos.all(ctx.chat.id);

    if (todos.length === 0) {
      return ctx.reply('📭 Tidak ada todo dalam 7 hari ke depan! 🎉');
    }

    let msg = `📋 *Todo 7 Hari Ke Depan (${todos.length}):*\n\n`;

    // Group by day
    const grouped = {};
    todos.forEach(todo => {
      const deadline = new Date(todo.deadline);
      const dayKey = deadline.toDateString();
      if (!grouped[dayKey]) grouped[dayKey] = [];
      grouped[dayKey].push(todo);
    });

    for (const [dayKey, dayTodos] of Object.entries(grouped)) {
      const date = new Date(dayTodos[0].deadline);
      const dayName = getDayName(date);
      const dateStr = `${date.getDate()}/${date.getMonth() + 1}`;

      msg += `*${dayName} (${dateStr}):*\n`;
      dayTodos.forEach(todo => {
        const deadline = new Date(todo.deadline);
        const hours = String(deadline.getHours()).padStart(2, '0');
        const minutes = String(deadline.getMinutes()).padStart(2, '0');
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);

        msg += `  ${status} ${categoryEmoji} ${todo.task} (⏰${hours}:${minutes})\n`;
      });
      msg += '\n';
    }

    msg += `/done <nomor> — Tandai selesai`;
    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /stats
  bot.command('stats', (ctx) => {
    const stats = queries.getStats.get(ctx.chat.id);

    if (!stats || stats.total === 0) {
      return ctx.reply('📊 Belum ada todo yang dibuat.');
    }

    const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

    let msg = `📊 *Statistik Todo*\n\n`;
    msg += `📋 Total: *${stats.total}*\n`;
    msg += `✅ Selesai: *${stats.completed}*\n`;
    msg += `⏳ Pending: *${stats.pending}*\n`;

    if (stats.overdue > 0) {
      msg += `🚨 Overdue: *${stats.overdue}*\n`;
    }

    msg += `\n📈 Tingkat penyelesaian: *${completionRate}%*\n`;

    // Motivasi
    if (completionRate >= 80) {
      msg += `\n🎉 *Hebat!* Kamu produktif banget!`;
    } else if (completionRate >= 50) {
      msg += `\n💪 *Bagus!* Pertahankan!`;
    } else if (stats.overdue > 0) {
      msg += `\n⚠️ *Ayo selesaikan yang overdue!*`;
    }

    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /search
  bot.command('search', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const keyword = args.join(' ');

    if (!keyword) {
      return ctx.reply('❌ Format: /search <keyword>\nContoh: /search meeting');
    }

    const todos = queries.searchTodos.all(ctx.chat.id, `%${keyword}%`);

    if (todos.length === 0) {
      return ctx.reply(`🔍 Tidak ditemukan todo dengan kata "${keyword}"`);
    }

    let msg = `🔍 *Hasil pencarian "${keyword}" (${todos.length}):*\n\n`;
    todos.forEach((todo, i) => {
      const deadline = formatDate(new Date(todo.deadline));
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);

      msg += `${i + 1}. ${status} ${categoryEmoji} *${todo.task}*\n`;
      msg += `   📅 ${deadline}\n\n`;
    });

    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /list
  bot.command('list', (ctx) => {
    const todos = queries.getTodosByChat.all(ctx.chat.id);

    if (todos.length === 0) {
      return ctx.reply('📭 Tidak ada todo! Tambah dengan /remind atau kirim voice note.');
    }

    // Cek overdue
    const overdue = todos.filter(t => t.status === 'pending' && new Date(t.deadline) < new Date());
    let msg = '';

    if (overdue.length > 0) {
      msg += `🚨 *${overdue.length} todo OVERDUE!*\n\n`;
    }

    msg += `📋 *Daftar Todo (${todos.length}):*\n\n`;
    todos.forEach((todo, i) => {
      const deadline = formatDate(new Date(todo.deadline));
      const status = todo.status === 'done' ? '✅' : (todo.reminded ? '🔔' : '⏳');
      const categoryEmoji = getCategoryEmoji(todo.category);
      const isOverdue = todo.status === 'pending' && new Date(todo.deadline) < new Date();

      msg += `${i + 1}. ${status} ${categoryEmoji} *${todo.task}*${isOverdue ? ' ⚠️' : ''}\n`;
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

    // Smart response berdasarkan konteks
    const now = new Date();
    const deadline = new Date(todo.deadline);
    const isOnTime = deadline >= now;

    let msg = '';
    if (isOnTime) {
      msg = `✅ *"${todo.task}"* ditandai selesai! 🎉\n\n` +
        `💪 *Tepat waktu! Good job!*`;
    } else {
      msg = `✅ *"${todo.task}"* ditandai selesai!\n\n` +
        `⏰ *Agak telat, tapi better late than never!*`;
    }

    ctx.reply(msg, { parse_mode: 'Markdown' });
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

      await ctx.reply('🎤 Memproses voice note...');
      await downloadTelegramFile(voice.file_id, oggPath);

      await ctx.reply('🔄 Konversi audio...');
      await convertOggToWav(oggPath, wavPath);

      await ctx.reply('📝 Transcribing...');
      const transcription = await transcribeAudio(wavPath);

      // Cleanup temp files
      cleanupFile(oggPath);
      cleanupFile(wavPath);

      if (!transcription) {
        return ctx.reply('❌ Gagal transcribe voice note. Coba lagi ya.');
      }

      // Parse todo dari text (pakai hybrid)
      const result = await parseReminderHybrid(transcription);

      if (!result.deadline) {
        // Beri hint (coba LLM dulu)
        const llmHint = await generateHintWithLLM(transcription);
        const hints = generateHint(transcription);

        let msg = `📝 *Hasil Transcribe:*\n"${transcription}"\n\n`;
        msg += `❌ Waktu tidak dikenali.\n\n`;
        if (llmHint) {
          msg += `💡 *${llmHint}*\n`;
        } else if (hints.length > 0) {
          msg += `*Saran:*\n`;
          hints.forEach(h => { msg += `• ${h}\n`; });
        }
        msg += `\n💡 *Contoh: "Belajar besok jam 3 sore"*`;

        return ctx.reply(msg, { parse_mode: 'Markdown' });
      }

      const saved = saveTodo(ctx, result.task, result.deadline, result.reminderTime, result.category, result.urgency);

      if (saved) {
        // Tambahkan info transcribe
        ctx.reply(
          `🎤 *Voice Note:* "${transcription}"`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      console.error('❌ Error handling voice:', error);
      ctx.reply('❌ Error processing voice note. Coba lagi ya.');
    }
  });

  // ==================== Auto-parse Text Messages ====================

  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const lower = text.toLowerCase().trim();

    // Skip commands
    if (text.startsWith('/')) return;

    // ==================== Natural Language Commands ====================

    // "list todo", "lihat todo", "todo list", "lihat semua todo"
    if (lower.match(/^(list|lihat|cek|tampilkan)\s*(todo|tugas|daftar)/i) ||
        lower.match(/^(todo|tugas)\s*(list|daftar)/i) ||
        lower.match(/^(semua|seluruh)\s*(todo|tugas)/i)) {
      // Trigger /list command
      const todos = queries.getTodosByChat.all(ctx.chat.id);

      if (todos.length === 0) {
        return ctx.reply('📭 Tidak ada todo! Tambah dengan /remind atau kirim voice note.');
      }

      let msg = `📋 *Daftar Todo (${todos.length}):*\n\n`;
      todos.forEach((todo, i) => {
        const deadline = formatDate(new Date(todo.deadline));
        const status = todo.status === 'done' ? '✅' : (todo.reminded ? '🔔' : '⏳');
        const categoryEmoji = getCategoryEmoji(todo.category);
        const isOverdue = todo.status === 'pending' && new Date(todo.deadline) < new Date();

        msg += `${i + 1}. ${status} ${categoryEmoji} *${todo.task}*${isOverdue ? ' ⚠️' : ''}\n`;
        msg += `   📅 ${deadline}\n\n`;
      });

      msg += `\n💡 Ketik "done 1" untuk selesai, "hapus 1" untuk hapus`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "todo hari ini", "today", "apa aja hari ini"
    if (lower.match(/^(todo|tugas)\s*(hari\s*ini|today)/i) ||
        lower.match(/^(hari\s*ini|today)\s*(apa|ada)/i) ||
        lower.match(/^(apa|ada)\s*(aja)?\s*(hari\s*ini|today)/i)) {
      const todos = queries.getTodayTodos.all(ctx.chat.id);

      if (todos.length === 0) {
        return ctx.reply('📭 Tidak ada todo untuk hari ini! 🎉');
      }

      let msg = `📋 *Todo Hari Ini (${todos.length}):*\n\n`;
      todos.forEach((todo, i) => {
        const deadline = new Date(todo.deadline);
        const hours = String(deadline.getHours()).padStart(2, '0');
        const minutes = String(deadline.getMinutes()).padStart(2, '0');
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);

        msg += `${i + 1}. ${status} ${categoryEmoji} *${todo.task}*\n`;
        msg += `   ⏰ Jam ${hours}:${minutes}\n\n`;
      });

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "todo besok", "tomorrow"
    if (lower.match(/^(todo|tugas)\s*besok/i) ||
        lower.match(/^besok\s*(apa|ada)/i)) {
      const todos = queries.getTomorrowTodos.all(ctx.chat.id);

      if (todos.length === 0) {
        return ctx.reply('📭 Tidak ada todo untuk besok! 🎉');
      }

      let msg = `📋 *Todo Besok (${todos.length}):*\n\n`;
      todos.forEach((todo, i) => {
        const deadline = new Date(todo.deadline);
        const hours = String(deadline.getHours()).padStart(2, '0');
        const minutes = String(deadline.getMinutes()).padStart(2, '0');
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);

        msg += `${i + 1}. ${status} ${categoryEmoji} *${todo.task}*\n`;
        msg += `   ⏰ Jam ${hours}:${minutes}\n\n`;
      });

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "statistik", "stats", "progress"
    if (lower.match(/^(statistik|stats|progress|progres|status)/i)) {
      const stats = queries.getStats.get(ctx.chat.id);

      if (!stats || stats.total === 0) {
        return ctx.reply('📊 Belum ada todo yang dibuat.');
      }

      const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

      let msg = `📊 *Statistik Todo*\n\n`;
      msg += `📋 Total: *${stats.total}*\n`;
      msg += `✅ Selesai: *${stats.completed}*\n`;
      msg += `⏳ Pending: *${stats.pending}*\n`;

      if (stats.overdue > 0) {
        msg += `🚨 Overdue: *${stats.overdue}*\n`;
      }

      msg += `\n📈 Tingkat penyelesaian: *${completionRate}%*\n`;

      if (completionRate >= 80) {
        msg += `\n🎉 *Hebat!* Kamu produktif banget!`;
      } else if (completionRate >= 50) {
        msg += `\n💪 *Bagus!* Pertahankan!`;
      } else if (stats.overdue > 0) {
        msg += `\n⚠️ *Ayo selesaikan yang overdue!*`;
      }

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "done 1", "selesai 1", "tandai selesai 1"
    const doneMatch = lower.match(/^(done|selesai|selesaikan|tandai)\s*(\d+)/i);
    if (doneMatch) {
      const index = parseInt(doneMatch[2]) - 1;
      const todos = queries.getTodosByChat.all(ctx.chat.id);

      if (index < 0 || index >= todos.length) {
        return ctx.reply(`❌ Nomor tidak valid. Pilih 1-${todos.length}`);
      }

      const todo = todos[index];
      queries.markDone.run(todo.id, ctx.chat.id);

      const now = new Date();
      const deadline = new Date(todo.deadline);
      const isOnTime = deadline >= now;

      let msg = '';
      if (isOnTime) {
        msg = `✅ *"${todo.task}"* ditandai selesai! 🎉\n\n💪 *Tepat waktu! Good job!*`;
      } else {
        msg = `✅ *"${todo.task}"* ditandai selesai!\n\n⏰ *Agak telat, tapi better late than never!*`;
      }

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "hapus 1", "delete 1"
    const deleteMatch = lower.match(/^(hapus|delete|buang)\s*(\d+)/i);
    if (deleteMatch) {
      const index = parseInt(deleteMatch[2]) - 1;
      const todos = queries.getTodosByChat.all(ctx.chat.id);

      if (index < 0 || index >= todos.length) {
        return ctx.reply(`❌ Nomor tidak valid. Pilih 1-${todos.length}`);
      }

      const todo = todos[index];
      queries.deleteTodo.run(todo.id, ctx.chat.id);

      return ctx.reply(`🗑️ *"${todo.task}"* dihapus!`, { parse_mode: 'Markdown' });
    }

    // "cari <keyword>", "search <keyword>"
    const searchMatch = lower.match(/^(cari|search|find)\s+(.+)/i);
    if (searchMatch) {
      const keyword = searchMatch[2];
      const todos = queries.searchTodos.all(ctx.chat.id, `%${keyword}%`);

      if (todos.length === 0) {
        return ctx.reply(`🔍 Tidak ditemukan todo dengan kata "${keyword}"`);
      }

      let msg = `🔍 *Hasil pencarian "${keyword}" (${todos.length}):*\n\n`;
      todos.forEach((todo, i) => {
        const deadline = formatDate(new Date(todo.deadline));
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);

        msg += `${i + 1}. ${status} ${categoryEmoji} *${todo.task}*\n`;
        msg += `   📅 ${deadline}\n\n`;
      });

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "bantuan", "help", "gimana cara"
    if (lower.match(/^(bantuan|help|gimana|cara|panduan)/i)) {
      return ctx.reply(
        `📖 *Command List*\n\n` +
        `*📋 Todo:*\n` +
        `/remind <task> <waktu> — Tambah reminder\n` +
        `/list — Lihat semua todo\n` +
        `/done <nomor> — Tandai selesai\n` +
        `/delete <nomor> — Hapus todo\n\n` +
        `*🔍 Lihat Todo:*\n` +
        `/today — Hari ini\n` +
        `/tomorrow — Besok\n` +
        `/upcoming — 7 hari ke depan\n` +
        `/search <keyword> — Cari todo\n` +
        `/stats — Statistik\n\n` +
        `*💡 Atau ketik langsung:*\n` +
        `• "list todo" — Lihat semua todo\n` +
        `• "todo hari ini" — Todo hari ini\n` +
        `• "done 1" — Tandai selesai\n` +
        `• "hapus 1" — Hapus todo\n` +
        `• "cari meeting" — Cari todo\n` +
        `• "statistik" — Lihat progress`,
        { parse_mode: 'Markdown' }
      );
    }

    // ==================== Auto-parse Reminder ====================

    // Coba parse sebagai reminder (pakai hybrid)
    const result = await parseReminderHybrid(text);

    if (result.deadline) {
      saveTodo(ctx, result.task, result.deadline, result.reminderTime, result.category, result.urgency);
    } else {
      // Beri saran yang helpful (coba LLM dulu)
      const llmHint = await generateHintWithLLM(text);
      const hints = generateHint(text);

      let msg = `🤔 Gw gak ngerti 😅\n\n`;

      if (llmHint) {
        msg += `💡 *${llmHint}*\n\n`;
      } else if (hints.length > 0) {
        msg += `*Mungkin maksud kamu:*\n`;
        hints.forEach(h => { msg += `• ${h}\n`; });
        msg += '\n';
      }

      msg += `*Contoh input:*\n` +
        `• "Tugas A besok jam 3 sore"\n` +
        `• "Meeting client senin depan"\n` +
        `• "list todo" — Lihat semua todo\n` +
        `• "help" — Bantuan`;

      ctx.reply(msg, { parse_mode: 'Markdown' });
    }
  });

  return bot;
}

// ==================== Helper Functions ====================

function getCategoryEmoji(category) {
  const emojis = {
    kuliah: '📚',
    kerja: '💼',
    belanja: '🛒',
    kesehatan: '🏥',
    pribadi: '🎉',
    keuangan: '💰',
    general: '📋',
  };
  return emojis[category] || '📋';
}

function getDayName(date) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[date.getDay()];
}

function getBot() {
  return bot;
}

module.exports = { initBot, getBot };
