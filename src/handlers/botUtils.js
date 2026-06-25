const { Markup } = require('telegraf');
const { parseReminder, formatDate } = require('../parser');
const { queries } = require('../db');
const { parseWithLLM, generateHintWithLLM } = require('../llm');

const defaultEmail = process.env.DEFAULT_EMAIL_TARGET;
const userEmails = new Map();
const pendingConfirmations = new Map();

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

function saveTodo(ctx, aktivitas, scheduledAt, reminderTime, category = 'general', urgency = 'normal', recurring = null) {
  const emailTarget = userEmails.get(ctx.chat.id) || defaultEmail;

  if (!emailTarget) {
    ctx.reply(
      `📧 Email belum di-set!

Set dulu: /setemail email@kamu.com`
    );
    return false;
  }

  const currentTime = new Date();
  if (scheduledAt < currentTime && !recurring) {
    pendingConfirmations.set(ctx.chat.id, {
      aktivitas,
      scheduledAt,
      reminderTime,
      category,
      urgency,
      recurring,
    });

    const tomorrow = new Date(scheduledAt);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow);

    ctx.reply(
      `⚠️ *Waktu itu sudah lewat!*

` +
      `📌 Aktivitas: ${aktivitas}
` +
      `⏰ Waktu: ${formatDate(scheduledAt)}

` +
      `Maksudnya *besok* di jam yang sama?
` +
      `📅 ${tomorrowStr}

` +
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

  const scheduledAtStr = formatDate(scheduledAt);
  const recurringText = recurring 
    ? `
🔁 *Berulang:* ${ { daily: '🔄 Setiap hari', weekly: '🔄 Setiap minggu', monthly: '🔄 Setiap bulan' }[recurring] || recurring }` 
    : `
🔁 *Berulang:* Tidak`;

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

  ctx.reply(
    `✅ *Reminder berhasil dibuat!*

` +
    `📌 *Aktivitas :* ${aktivitas}
` +
    `⏰ *Waktu      :* ${scheduledAtStr}
` +
    `📧 *Email ke  :* ${emailTarget}
` +
    recurringText +
    (timeContext ? `

${timeContext}` : ''),
    { parse_mode: 'Markdown' }
  );

  return true;
}

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

function getCategoryEmoji(category) {
  const emojis = {
    kuliah: '📚', kerja: '💼', belanja: '🛒', kesehatan: '🏥', pribadi: '🎉', keuangan: '💰', general: '📋',
  };
  return emojis[category] || '📋';
}

function getPriorityEmoji(priority) {
  const emojis = { urgent: '🔴', normal: '🟡', low: '🟢' };
  return emojis[priority] || '🟡';
}

function getDayName(date) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[date.getDay()];
}

function getNextRecurringDate(deadline, recurring) {
  const next = new Date(deadline);
  switch (recurring) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'monthly': next.setMonth(next.getMonth() + 1); break;
  }
  return next;
}

async function downloadTelegramFile(fileId, destPath, bot) {
  try {
    const fileLink = await bot.telegram.getFileLink(fileId);
    const url = fileLink.href;

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? require('https') : require('http');
      const file = fs.createWriteStream(destPath);

      protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          downloadTelegramFile(fileId, destPath, bot).then(resolve).catch(reject);
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

module.exports = {
  userEmails,
  pendingConfirmations,
  saveTodo,
  parseReminderHybrid,
  getCategoryEmoji,
  getPriorityEmoji,
  getDayName,
  getNextRecurringDate,
  getActionButtons,
  defaultEmail,
  downloadTelegramFile,
  cleanupFile
};
