const { Telegraf, Markup } = require('telegraf');
const { parseReminder, formatDate, generateHint, detectCategory, detectUrgency, detectRecurring } = require('./parser');
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
let defaultEmail = process.env.DEFAULT_EMAIL_TARGET;

// Simpan email per user (chat_id → email)
const userEmails = new Map();

// Simpan pending confirmation (chat_id → { aktivitas, scheduledAt, reminderTime, category, urgency, recurring })
const pendingConfirmations = new Map();

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// ==================== Voice Processing ====================

async function transcribeAudio(audioFilePath) {
  try {
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

// ==================== Inline Keyboard ====================

function getActionButtons(todoId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Done', `done_${todoId}`),
      Markup.button.callback('⏰ Snooze 10m', `snooze_${todoId}_10`),
      Markup.button.callback('⏰ Snooze 1h', `snooze_${todoId}_60`),
    ],
    [
      Markup.button.callback('🗑️ Hapus', `delete_${todoId}`),
    ]
  ]);
}

// ==================== Save Todo Helper ====================

function saveTodo(ctx, aktivitas, scheduledAt, reminderTime, category = 'general', urgency = 'normal', recurring = null) {
  const emailTarget = userEmails.get(ctx.chat.id) || defaultEmail;

  if (!emailTarget) {
    ctx.reply(
      `📧 Email belum di-set!\n\nSet dulu: /setemail email@kamu.com`
    );
    return false;
  }

  // Cek apakah waktu sudah lewat
  const currentTime = new Date();
  if (scheduledAt < currentTime && !recurring) {
    // Simpan pending confirmation
    pendingConfirmations.set(ctx.chat.id, {
      aktivitas,
      scheduledAt,
      reminderTime,
      category,
      urgency,
      recurring,
    });

    // Saran waktu besok
    const tomorrow = new Date(scheduledAt);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow);

    ctx.reply(
      `⚠️ *Waktu itu sudah lewat!*\n\n` +
      `📌 Aktivitas: ${aktivitas}\n` +
      `⏰ Waktu: ${formatDate(scheduledAt)}\n\n` +
      `Maksudnya *besok* di jam yang sama?\n` +
      `📅 ${tomorrowStr}\n\n` +
      `Ketik *ya* untuk konfirmasi, atau ketik waktu baru.`,
      { parse_mode: 'Markdown' }
    );
    return false;
  }

  queries.addTodo.run({
    chatId: ctx.chat.id,
    aktivitas: aktivitas,
    scheduledAt: scheduledAt.toISOString(),
    reminderTime: reminderTime.toISOString(),
    emailTarget: emailTarget,
    priority: urgency,
    category: category,
    recurring: recurring,
    recurringParentId: null,
  });

  // Get the inserted todo ID
  const insertedTodo = queries.getTodosByChat.all(ctx.chat.id).pop();

  const scheduledAtStr = formatDate(scheduledAt);
  const reminderStr = formatDate(reminderTime);

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

  // Priority indicator
  let priorityIndicator = '';
  if (urgency === 'urgent') {
    priorityIndicator = '🔴 ';
  } else if (urgency === 'low') {
    priorityIndicator = '🟢 ';
  } else {
    priorityIndicator = '🟡 ';
  }

  // Recurring indicator
  let recurringText = '';
  if (recurring) {
    const recurringLabels = {
      daily: '🔄 Setiap hari',
      weekly: '🔄 Setiap minggu',
      monthly: '🔄 Setiap bulan',
    };
    recurringText = `\n🔁 *Berulang:* ${recurringLabels[recurring] || recurring}`;
  } else {
    recurringText = `\n🔁 *Berulang:* Tidak`;
  }

  // Time context
  const now = new Date();
  const diff = scheduledAt - now;
  const hoursLeft = Math.floor(diff / (1000 * 60 * 60));
  const daysLeft = Math.floor(hoursLeft / 24);

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

  // Format pesan konfirmasi sesuai PRD
  ctx.reply(
    `✅ *Reminder berhasil dibuat!*\n\n` +
    `📌 *Aktivitas :* ${aktivitas}\n` +
    `⏰ *Waktu      :* ${scheduledAtStr}\n` +
    `📧 *Email ke  :* ${emailTarget}\n` +
    recurringText +
    (timeContext ? `\n\n${timeContext}` : ''),
    { parse_mode: 'Markdown' }
  );

  return true;
}

// ==================== Hybrid Parser ====================

async function parseReminderHybrid(text) {
  const llmResult = await parseWithLLM(text);

  if (llmResult && llmResult.confidence >= 0.5) {
    const deadline = new Date(`${llmResult.date}T${llmResult.time || '09:00'}:00`);

    if (!isNaN(deadline.getTime())) {
      let reminderTime;
      const now = new Date();

      if (llmResult.reminder_time) {
        reminderTime = new Date(deadline);
        const [rh, rm] = llmResult.reminder_time.split(':').map(Number);
        reminderTime.setHours(rh, rm, 0, 0);

        if (reminderTime >= deadline) {
          reminderTime.setDate(reminderTime.getDate() - 1);
        }
      } else {
        // Default: 1 jam sebelum deadline
        reminderTime = new Date(deadline.getTime() - 60 * 60 * 1000);
      }

      if (reminderTime <= now) {
        reminderTime = new Date(now.getTime() + 60 * 1000);
      }

      return {
        aktivitas: llmResult.task,
        scheduledAt: deadline,
        reminderTime: reminderTime,
        category: llmResult.category || 'general',
        urgency: llmResult.urgency || 'normal',
        recurring: llmResult.recurring || null,
        raw: text,
        source: 'llm',
      };
    }
  }

  const regexResult = parseReminder(text);
  // Map field names to PRD schema
  return {
    aktivitas: regexResult.task,
    scheduledAt: regexResult.deadline,
    reminderTime: regexResult.reminderTime,
    category: regexResult.category,
    urgency: regexResult.urgency,
    recurring: regexResult.recurring,
    raw: regexResult.raw,
    source: 'regex',
  };
}

// ==================== Bot Initialization ====================

function initBot() {
  bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Middleware: log setiap pesan
  bot.use((ctx, next) => {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text || ctx.message?.voice ? '[voice]' : '';
    console.log(`💬 [${chatId}] ${text}`);
    return next();
  });

  // ==================== Inline Button Handlers ====================

  bot.action(/^done_(\d+)$/, async (ctx) => {
    const todoId = parseInt(ctx.match[1]);
    const todo = queries.getTodoById.get(todoId);

    if (!todo) {
      return ctx.answerCbQuery('❌ Todo tidak ditemukan');
    }

    queries.markDone.run(todoId, todo.chat_id);
    await ctx.answerCbQuery('✅ Ditandai selesai!');

    // Edit message to show completed
    await ctx.editMessageText(
      `✅ *"${todo.aktivitas}"* ditandai selesai! 🎉`,
      { parse_mode: 'Markdown' }
    );

    // If recurring, create next occurrence
    if (todo.recurring) {
      const nextScheduledAt = getNextRecurringDate(new Date(todo.scheduled_at), todo.recurring);
      // Default: 1 jam sebelum deadline
      const nextReminder = new Date(nextScheduledAt.getTime() - 60 * 60 * 1000);

      queries.addTodo.run({
        chatId: todo.chat_id,
        aktivitas: todo.aktivitas,
        scheduledAt: nextScheduledAt.toISOString(),
        reminderTime: nextReminder.toISOString(),
        emailTarget: todo.email_target,
        priority: todo.priority,
        category: todo.category,
        recurring: todo.recurring,
        recurringParentId: todoId,
      });

      ctx.reply(
        `🔁 *Recurring:* "${todo.aktivitas}" dijadwalkan ulang\n📅 Deadline: ${formatDate(nextScheduledAt)}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  bot.action(/^snooze_(\d+)_(\d+)$/, async (ctx) => {
    const todoId = parseInt(ctx.match[1]);
    const minutes = parseInt(ctx.match[2]);
    const todo = queries.getTodoById.get(todoId);

    if (!todo) {
      return ctx.answerCbQuery('❌ Todo tidak ditemukan');
    }

    const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);
    queries.snoozeTodo.run(snoozeUntil.toISOString(), todoId, todo.chat_id);

    await ctx.answerCbQuery(`⏰ Di-snooze ${minutes} menit`);

    await ctx.editMessageText(
      `⏰ *"${todo.aktivitas}"* di-snooze ${minutes} menit\n📅 Reminder: ${formatDate(snoozeUntil)}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action(/^delete_(\d+)$/, async (ctx) => {
    const todoId = parseInt(ctx.match[1]);
    const todo = queries.getTodoById.get(todoId);

    if (!todo) {
      return ctx.answerCbQuery('❌ Todo tidak ditemukan');
    }

    queries.deleteTodo.run(todoId, todo.chat_id);
    await ctx.answerCbQuery('🗑️ Dihapus!');

    await ctx.editMessageText(
      `🗑️ *"${todo.aktivitas}"* dihapus!`,
      { parse_mode: 'Markdown' }
    );
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
      `/calendar — Kalender mingguan\n` +
      `/list — Semua todo\n` +
      `/stats — Statistik\n` +
      `/search <keyword> — Cari todo\n` +
      `/setemail <email>\n` +
      `/help — Bantuan\n\n` +
      `*Contoh input:*\n` +
      `• "Tugas A besok jam 3 sore"\n` +
      `• "Meeting client senin depan"\n` +
      `• "Olahraga setiap senin jam 6 pagi"`,
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
      `/calendar — Kalender mingguan\n` +
      `/search <keyword> — Cari todo\n` +
      `/stats — Statistik\n\n` +
      `*⚙️ Settings:*\n` +
      `/setemail <email> — Set email reminder\n\n` +
      `*🔄 Recurring:*\n` +
      `"Olahraga setiap senin jam 6 pagi"\n` +
      `"Minum obat setiap hari jam 8"\n\n` +
      `*💡 Tips:*\n` +
      `• Tambah kata "urgent" untuk prioritas tinggi\n` +
      `• Gw auto-detect kategori (kuliah, kerja, dll)\n` +
      `• Kirim teks langsung, gw coba pahami!\n` +
      `• Ketik "help" atau "bantuan" untuk bantuan`,
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
        `• /remind olahraga setiap senin jam 6 pagi`
      );
    }

    const result = await parseReminderHybrid(taskText);

    if (!result.scheduledAt) {
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
        `• /remind olahraga setiap senin jam 6`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    saveTodo(ctx, result.aktivitas, result.scheduledAt, result.reminderTime, result.category, result.urgency, result.recurring);
  });

  // /today
  bot.command('today', (ctx) => {
    const todos = queries.getTodayTodos.all(ctx.chat.id);

    if (todos.length === 0) {
      return ctx.reply('📭 Tidak ada todo untuk hari ini! 🎉');
    }

    let msg = `📋 *Todo Hari Ini (${todos.length}):*\n\n`;
    todos.forEach((todo, i) => {
      const scheduledAt = new Date(todo.scheduled_at);
      const hours = String(scheduledAt.getHours()).padStart(2, '0');
      const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);
      const priorityEmoji = getPriorityEmoji(todo.priority);

      msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*\n`;
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
      const scheduledAt = new Date(todo.scheduled_at);
      const hours = String(scheduledAt.getHours()).padStart(2, '0');
      const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);
      const priorityEmoji = getPriorityEmoji(todo.priority);

      msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*\n`;
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

    const grouped = {};
    todos.forEach(todo => {
      const scheduledAt = new Date(todo.scheduled_at);
      const dayKey = scheduledAt.toDateString();
      if (!grouped[dayKey]) grouped[dayKey] = [];
      grouped[dayKey].push(todo);
    });

    for (const [dayKey, dayTodos] of Object.entries(grouped)) {
      const date = new Date(dayTodos[0].scheduled_at);
      const dayName = getDayName(date);
      const dateStr = `${date.getDate()}/${date.getMonth() + 1}`;

      msg += `*${dayName} (${dateStr}):*\n`;
      dayTodos.forEach(todo => {
        const scheduledAt = new Date(todo.scheduled_at);
        const hours = String(scheduledAt.getHours()).padStart(2, '0');
        const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);
        const priorityEmoji = getPriorityEmoji(todo.priority);
        const recurringEmoji = todo.recurring ? '🔁' : '';

        msg += `  ${status} ${priorityEmoji} ${categoryEmoji} ${todo.aktivitas} ${recurringEmoji} (⏰${hours}:${minutes})\n`;
      });
      msg += '\n';
    }

    msg += `/done <nomor> — Tandai selesai`;
    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /calendar
  bot.command('calendar', (ctx) => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday

    const todos = queries.getWeekTodos.all(ctx.chat.id, startOfWeek.toISOString().split('T')[0], endOfWeek.toISOString().split('T')[0]);

    const days = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const dayEmojis = ['📅', '📅', '📅', '📅', '📅', '🎉', '🎉'];

    let msg = `📅 *Kalender Minggu Ini*\n`;
    msg += `${formatDate(startOfWeek)} - ${formatDate(endOfWeek)}\n\n`;

    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      const isToday = date.toDateString() === today.toDateString();

      const dayTodos = todos.filter(t => {
        const scheduledAt = new Date(t.scheduled_at);
        return scheduledAt.toDateString() === date.toDateString();
      });

      const dayLabel = isToday ? `*▸ ${days[i]} ${date.getDate()} ◂*` : `*${days[i]} ${date.getDate()}*`;

      if (dayTodos.length === 0) {
        msg += `${dayEmojis[i]} ${dayLabel}: -\n`;
      } else {
        msg += `${dayEmojis[i]} ${dayLabel}:\n`;
        dayTodos.forEach(todo => {
          const scheduledAt = new Date(todo.scheduled_at);
          const hours = String(scheduledAt.getHours()).padStart(2, '0');
          const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
          const status = todo.status === 'done' ? '✅' : '⏳';
          const priorityEmoji = getPriorityEmoji(todo.priority);

          msg += `   ${status} ${priorityEmoji} ${todo.aktivitas} (${hours}:${minutes})\n`;
        });
      }
    }

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

    msg += `\n*Prioritas:*\n`;
    msg += `🔴 Urgent: *${stats.urgent || 0}*\n`;
    msg += `🟡 Normal: *${stats.normal_priority || 0}*\n`;
    msg += `🟢 Low: *${stats.low_priority || 0}*\n`;

    msg += `\n📈 Tingkat penyelesaian: *${completionRate}%*\n`;

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
      const scheduledAt = formatDate(new Date(todo.scheduled_at));
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);
      const priorityEmoji = getPriorityEmoji(todo.priority);

      msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*\n`;
      msg += `   📅 ${scheduledAt}\n\n`;
    });

    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /list
  bot.command('list', (ctx) => {
    const todos = queries.getTodosByChat.all(ctx.chat.id);

    if (todos.length === 0) {
      return ctx.reply('📭 Tidak ada todo! Tambah dengan /remind atau kirim voice note.');
    }

    const overdue = todos.filter(t => t.status === 'pending' && new Date(t.scheduled_at) < new Date());
    let msg = '';

    if (overdue.length > 0) {
      msg += `🚨 *${overdue.length} todo OVERDUE!*\n\n`;
    }

    msg += `📋 *Daftar Todo (${todos.length}):*\n\n`;
    todos.forEach((todo, i) => {
      const scheduledAt = formatDate(new Date(todo.scheduled_at));
      const status = todo.status === 'done' ? '✅' : (todo.is_sent ? '🔔' : '⏳');
      const categoryEmoji = getCategoryEmoji(todo.category);
      const priorityEmoji = getPriorityEmoji(todo.priority);
      const isOverdue = todo.status === 'pending' && new Date(todo.scheduled_at) < new Date();
      const recurringEmoji = todo.recurring ? '🔁' : '';

      msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*${isOverdue ? ' ⚠️' : ''} ${recurringEmoji}\n`;
      msg += `   📅 ${scheduledAt}\n`;
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

    const now = new Date();
    const scheduledAt = new Date(todo.scheduled_at);
    const isOnTime = scheduledAt >= now;

    let msg = '';
    if (isOnTime) {
      msg = `✅ *"${todo.aktivitas}"* ditandai selesai! 🎉\n\n💪 *Tepat waktu! Good job!*`;
    } else {
      msg = `✅ *"${todo.aktivitas}"* ditandai selesai!\n\n⏰ *Agak telat, tapi better late than never!*`;
    }

    ctx.reply(msg, { parse_mode: 'Markdown' });

    // If recurring, create next occurrence
    if (todo.recurring) {
      const nextScheduledAt = getNextRecurringDate(new Date(todo.scheduled_at), todo.recurring);
      // Default: 1 jam sebelum deadline
      const nextReminder = new Date(nextScheduledAt.getTime() - 60 * 60 * 1000);

      queries.addTodo.run({
        chatId: todo.chat_id,
        aktivitas: todo.aktivitas,
        scheduledAt: nextScheduledAt.toISOString(),
        reminderTime: nextReminder.toISOString(),
        emailTarget: todo.email_target,
        priority: todo.priority,
        category: todo.category,
        recurring: todo.recurring,
        recurringParentId: todo.id,
      });

      ctx.reply(
        `🔁 *Recurring:* "${todo.aktivitas}" dijadwalkan ulang\n📅 Deadline: ${formatDate(nextScheduledAt)}`,
        { parse_mode: 'Markdown' }
      );
    }
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

    ctx.reply(`🗑️ *"${todo.aktivitas}"* dihapus!`, { parse_mode: 'Markdown' });
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

      cleanupFile(oggPath);
      cleanupFile(wavPath);

      if (!transcription) {
        return ctx.reply('❌ Gagal transcribe voice note. Coba lagi ya.');
      }

      const result = await parseReminderHybrid(transcription);

      if (!result.scheduledAt) {
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

      const saved = saveTodo(ctx, result.aktivitas, result.scheduledAt, result.reminderTime, result.category, result.urgency, result.recurring);

      if (saved) {
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

    if (text.startsWith('/')) return;

    // ==================== Natural Language Commands ====================

    // "list todo", "lihat todo", "todo list"
    if (lower.match(/^(list|lihat|cek|tampilkan)\s*(todo|tugas|daftar)/i) ||
        lower.match(/^(todo|tugas)\s*(list|daftar)/i) ||
        lower.match(/^(semua|seluruh)\s*(todo|tugas)/i)) {
      const todos = queries.getTodosByChat.all(ctx.chat.id);

      if (todos.length === 0) {
        return ctx.reply('📭 Tidak ada todo! Tambah dengan /remind atau kirim voice note.');
      }

      let msg = `📋 *Daftar Todo (${todos.length}):*\n\n`;
      todos.forEach((todo, i) => {
        const scheduledAt = formatDate(new Date(todo.scheduled_at));
        const status = todo.status === 'done' ? '✅' : (todo.is_sent ? '🔔' : '⏳');
        const categoryEmoji = getCategoryEmoji(todo.category);
        const priorityEmoji = getPriorityEmoji(todo.priority);
        const isOverdue = todo.status === 'pending' && new Date(todo.scheduled_at) < new Date();
        const recurringEmoji = todo.recurring ? '🔁' : '';

        msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*${isOverdue ? ' ⚠️' : ''} ${recurringEmoji}\n`;
        msg += `   📅 ${scheduledAt}\n\n`;
      });

      msg += `\n💡 Ketik "done 1" untuk selesai, "hapus 1" untuk hapus`;
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "todo hari ini", "today"
    if (lower.match(/^(todo|tugas)\s*(hari\s*ini|today)/i) ||
        lower.match(/^(hari\s*ini|today)\s*(apa|ada)/i) ||
        lower.match(/^(apa|ada)\s*(aja)?\s*(hari\s*ini|today)/i)) {
      const todos = queries.getTodayTodos.all(ctx.chat.id);

      if (todos.length === 0) {
        return ctx.reply('📭 Tidak ada todo untuk hari ini! 🎉');
      }

      let msg = `📋 *Todo Hari Ini (${todos.length}):*\n\n`;
      todos.forEach((todo, i) => {
        const scheduledAt = new Date(todo.scheduled_at);
        const hours = String(scheduledAt.getHours()).padStart(2, '0');
        const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);
        const priorityEmoji = getPriorityEmoji(todo.priority);

        msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*\n`;
        msg += `   ⏰ Jam ${hours}:${minutes}\n\n`;
      });

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "todo besok"
    if (lower.match(/^(todo|tugas)\s*besok/i) ||
        lower.match(/^besok\s*(apa|ada)/i)) {
      const todos = queries.getTomorrowTodos.all(ctx.chat.id);

      if (todos.length === 0) {
        return ctx.reply('📭 Tidak ada todo untuk besok! 🎉');
      }

      let msg = `📋 *Todo Besok (${todos.length}):*\n\n`;
      todos.forEach((todo, i) => {
        const scheduledAt = new Date(todo.scheduled_at);
        const hours = String(scheduledAt.getHours()).padStart(2, '0');
        const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);
        const priorityEmoji = getPriorityEmoji(todo.priority);

        msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*\n`;
        msg += `   ⏰ Jam ${hours}:${minutes}\n\n`;
      });

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "kalender", "calendar", "jadwal"
    if (lower.match(/^(kalender|calendar|jadwal)/i)) {
      const today = new Date();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay() + 1);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);

      const todos = queries.getWeekTodos.all(ctx.chat.id, startOfWeek.toISOString().split('T')[0], endOfWeek.toISOString().split('T')[0]);

      const days = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

      let msg = `📅 *Kalender Minggu Ini*\n\n`;

      for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        const isToday = date.toDateString() === today.toDateString();

        const dayTodos = todos.filter(t => {
          const scheduledAt = new Date(t.scheduled_at);
          return scheduledAt.toDateString() === date.toDateString();
        });

        const dayLabel = isToday ? `*▸ ${days[i]} ${date.getDate()} ◂*` : `*${days[i]} ${date.getDate()}*`;

        if (dayTodos.length === 0) {
          msg += `📅 ${dayLabel}: -\n`;
        } else {
          msg += `📅 ${dayLabel}:\n`;
          dayTodos.forEach(todo => {
            const scheduledAt = new Date(todo.scheduled_at);
            const hours = String(scheduledAt.getHours()).padStart(2, '0');
            const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
            const status = todo.status === 'done' ? '✅' : '⏳';
            const priorityEmoji = getPriorityEmoji(todo.priority);

            msg += `   ${status} ${priorityEmoji} ${todo.aktivitas} (${hours}:${minutes})\n`;
          });
        }
      }

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

      msg += `\n*Prioritas:*\n`;
      msg += `🔴 Urgent: *${stats.urgent || 0}*\n`;
      msg += `🟡 Normal: *${stats.normal_priority || 0}*\n`;
      msg += `🟢 Low: *${stats.low_priority || 0}*\n`;

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

    // "done 1", "selesai 1"
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
      const scheduledAt = new Date(todo.scheduled_at);
      const isOnTime = scheduledAt >= now;

      let msg = '';
      if (isOnTime) {
        msg = `✅ *"${todo.aktivitas}"* ditandai selesai! 🎉\n\n💪 *Tepat waktu! Good job!*`;
      } else {
        msg = `✅ *"${todo.aktivitas}"* ditandai selesai!\n\n⏰ *Agak telat, tapi better late than never!*`;
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

      return ctx.reply(`🗑️ *"${todo.aktivitas}"* dihapus!`, { parse_mode: 'Markdown' });
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
        const scheduledAt = formatDate(new Date(todo.scheduled_at));
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);
        const priorityEmoji = getPriorityEmoji(todo.priority);

        msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*\n`;
        msg += `   📅 ${scheduledAt}\n\n`;
      });

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    // "bantuan", "help"
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
        `/calendar — Kalender mingguan\n` +
        `/search <keyword> — Cari todo\n` +
        `/stats — Statistik\n\n` +
        `*💡 Atau ketik langsung:*\n` +
        `• "list todo" — Lihat semua todo\n` +
        `• "todo hari ini" — Todo hari ini\n` +
        `• "kalender" — Kalender mingguan\n` +
        `• "done 1" — Tandai selesai\n` +
        `• "hapus 1" — Hapus todo\n` +
        `• "cari meeting" — Cari todo\n` +
        `• "statistik" — Lihat progress`,
        { parse_mode: 'Markdown' }
      );
    }

    // ==================== Handle Confirmation ====================

    if (lower === 'ya' || lower === 'y' || lower === 'yes') {
      const pending = pendingConfirmations.get(ctx.chat.id);
      if (pending) {
        pendingConfirmations.delete(ctx.chat.id);

        // Set waktu ke besok di jam yang sama
        const tomorrow = new Date(pending.scheduledAt);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const tomorrowReminder = new Date(pending.reminderTime);
        tomorrowReminder.setDate(tomorrowReminder.getDate() + 1);

        return saveTodo(ctx, pending.aktivitas, tomorrow, tomorrowReminder, pending.category, pending.urgency, pending.recurring);
      }
    }

    // ==================== Auto-parse Reminder ====================

    const result = await parseReminderHybrid(text);

    if (result.scheduledAt) {
      saveTodo(ctx, result.aktivitas, result.scheduledAt, result.reminderTime, result.category, result.urgency, result.recurring);
    } else {
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
        `• "Olahraga setiap senin jam 6 pagi"\n` +
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

function getPriorityEmoji(priority) {
  const emojis = {
    urgent: '🔴',
    normal: '🟡',
    low: '🟢',
  };
  return emojis[priority] || '🟡';
}

function getDayName(date) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[date.getDay()];
}

function getNextRecurringDate(deadline, recurring) {
  const next = new Date(deadline);

  switch (recurring) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
  }

  return next;
}

function getBot() {
  return bot;
}

module.exports = { initBot, getBot };
