const cron = require('node-cron');
const { queries } = require('./db');
const { sendReminder } = require('./email');
const { getBot } = require('./bot');
const { formatDate } = require('./parser');

let reminderTask = null;
let dailySummaryTask = null;
let retryTask = null;

function startScheduler() {
  // ==================== Reminder Scheduler ====================
  // Cek setiap menit
  reminderTask = cron.schedule('* * * * *', async () => {
    try {
      const dueTodos = queries.getDueReminders.all();

      if (dueTodos.length === 0) return;

      console.log(`🔔 Found ${dueTodos.length} reminder(s) to send`);

      for (const todo of dueTodos) {
        // Cek snooze
        if (todo.snoozed_until) {
          const snoozeTime = new Date(todo.snoozed_until);
          if (snoozeTime > new Date()) {
            continue; // Masih di-snooze
          }
        }

        // Kirim email
        const emailSent = await sendReminder(todo);

        if (emailSent) {
          // Mark email sent successfully
          queries.markEmailSent.run(todo.id);
        } else {
          // Mark email failed for retry
          queries.markEmailFailed.run(todo.id);
          console.log(`📧 Email failed for todo ${todo.id}, will retry in 5 minutes`);
        }

        // Kirim Telegram notification dengan inline buttons
        const bot = getBot();
        if (bot) {
          const scheduledAtStr = formatDate(new Date(todo.scheduled_at));
          const priorityEmoji = getPriorityEmoji(todo.priority);
          const categoryEmoji = getCategoryEmoji(todo.category);

          const msg =
            `🔔 *REMINDER!*\n\n` +
            `${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*\n` +
            `📅 *Waktu:* ${scheduledAtStr}\n` +
            `${emailSent ? '📧 Email terkirim!' : '❌ Email gagal, akan di-retry 5 menit lagi'}`;

          // Inline keyboard buttons
          const { Markup } = require('telegraf');
          const keyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Done', `done_${todo.id}`),
              Markup.button.callback('⏰ Snooze 10m', `snooze_${todo.id}_10`),
              Markup.button.callback('⏰ Snooze 1h', `snooze_${todo.id}_60`),
            ],
            [
              Markup.button.callback('🗑️ Hapus', `delete_${todo.id}`),
            ]
          ]);

          try {
            await bot.telegram.sendMessage(todo.chat_id, msg, {
              parse_mode: 'Markdown',
              reply_markup: keyboard.reply_markup,
            });
          } catch (err) {
            console.error(`❌ Telegram notify failed for chat ${todo.chat_id}:`, err.message);
          }
        }

        // Tandai sudah di-reminder (jika belum)
        if (!todo.is_sent) {
          queries.markReminded.run(todo.id);
        }
      }
    } catch (err) {
      console.error('❌ Scheduler error:', err.message);
    }
  });

  // ==================== Email Retry Scheduler ====================
  // Cek setiap menit untuk email yang gagal
  retryTask = cron.schedule('* * * * *', async () => {
    try {
      const failedTodos = queries.getFailedEmails.all();

      if (failedTodos.length === 0) return;

      console.log(`🔄 Retrying ${failedTodos.length} failed email(s)`);

      for (const todo of failedTodos) {
        const emailSent = await sendReminder(todo);

        if (emailSent) {
          queries.markEmailSent.run(todo.id);
          console.log(`✅ Email retry succeeded for todo ${todo.id}`);
        } else {
          queries.markEmailFailed.run(todo.id);
          console.log(`❌ Email retry failed for todo ${todo.id}`);
        }
      }
    } catch (err) {
      console.error('❌ Retry scheduler error:', err.message);
    }
  });

  // ==================== Daily Summary Scheduler ====================
  // Kirim summary setiap pagi jam 8 (Asia/Jakarta)
  dailySummaryTask = cron.schedule('0 8 * * *', async () => {
    try {
      const bot = getBot();
      if (!bot) return;

      const chatIds = queries.getAllChatIds.all();
      console.log(`📬 Sending daily summary to ${chatIds.length} user(s)`);

      for (const { chat_id } of chatIds) {
        const todayTodos = queries.getTodayTodos.all(chat_id);
        const overdueTodos = queries.getOverdueTodos.all(chat_id);

        if (todayTodos.length === 0 && overdueTodos.length === 0) continue;

        let msg = `☀️ *Selamat Pagi!*\n\n`;

        if (overdueTodos.length > 0) {
          msg += `🚨 *${overdueTodos.length} todo OVERDUE:*\n`;
          overdueTodos.forEach(todo => {
            const priorityEmoji = getPriorityEmoji(todo.priority);
            msg += `  ❌ ${priorityEmoji} ${todo.aktivitas}\n`;
          });
          msg += '\n';
        }

        if (todayTodos.length > 0) {
          msg += `📋 *${todayTodos.length} todo hari ini:*\n`;
          todayTodos.forEach(todo => {
            const scheduledAt = new Date(todo.scheduled_at);
            const hours = String(scheduledAt.getHours()).padStart(2, '0');
            const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
            const priorityEmoji = getPriorityEmoji(todo.priority);
            const categoryEmoji = getCategoryEmoji(todo.category);
            const recurringEmoji = todo.recurring ? '🔁' : '';

            msg += `  ⏰ ${hours}:${minutes} - ${priorityEmoji} ${categoryEmoji} ${todo.aktivitas} ${recurringEmoji}\n`;
          });
          msg += `\n💪 *Semangat hari ini!*`;
        }

        try {
          await bot.telegram.sendMessage(chat_id, msg, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error(`❌ Daily summary failed for chat ${chat_id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('❌ Daily summary error:', err.message);
    }
  }, {
    timezone: 'Asia/Jakarta'
  });

  console.log('⏰ Scheduler started (reminders: every minute, retry: every minute, daily summary: 8 AM)');
}

function stopScheduler() {
  if (reminderTask) {
    reminderTask.stop();
  }
  if (retryTask) {
    retryTask.stop();
  }
  if (dailySummaryTask) {
    dailySummaryTask.stop();
  }
  console.log('⏰ Scheduler stopped');
}

// Helper functions
function getPriorityEmoji(priority) {
  const emojis = {
    urgent: '🔴',
    normal: '🟡',
    low: '🟢',
  };
  return emojis[priority] || '🟡';
}

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

module.exports = { startScheduler, stopScheduler };
