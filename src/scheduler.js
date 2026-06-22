const cron = require('node-cron');
const { queries } = require('./db');
const { sendReminder } = require('./email');
const { getBot } = require('./bot');
const { formatDate } = require('./parser');

let task = null;

function startScheduler() {
  // Cek setiap menit
  task = cron.schedule('* * * * *', async () => {
    try {
      const dueTodos = queries.getDueReminders.all();

      if (dueTodos.length === 0) return;

      console.log(`🔔 Found ${dueTodos.length} reminder(s) to send`);

      for (const todo of dueTodos) {
        // Kirim email
        const emailSent = await sendReminder(todo);

        // Kirim Telegram notification
        const bot = getBot();
        if (bot) {
          const deadlineStr = formatDate(new Date(todo.deadline));
          const msg =
            `🔔 *REMINDER!*\n\n` +
            `📋 *Task:* ${todo.task}\n` +
            `📅 *Deadline:* ${deadlineStr}\n` +
            `${emailSent ? '📧 Email terkirim!' : '❌ Email gagal'}`;

          try {
            await bot.telegram.sendMessage(todo.chat_id, msg, { parse_mode: 'Markdown' });
          } catch (err) {
            console.error(`❌ Telegram notify failed for chat ${todo.chat_id}:`, err.message);
          }
        }

        // Tandai sudah di-reminder
        queries.markReminded.run(todo.id);
      }
    } catch (err) {
      console.error('❌ Scheduler error:', err.message);
    }
  });

  console.log('⏰ Scheduler started (checking every minute)');
}

function stopScheduler() {
  if (task) {
    task.stop();
    console.log('⏰ Scheduler stopped');
  }
}

module.exports = { startScheduler, stopScheduler };
