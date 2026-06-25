const { queries } = require('../db');
const { 
  saveTodo, 
  parseReminderHybrid, 
  getCategoryEmoji, 
  getPriorityEmoji, 
  getDayName 
} = require('./botUtils');
const { generateHintWithLLM } = require('../llm');
const { generateHint } = require('../parser');
const { formatDate } = require('../parser');

function setupCommands(bot) {
  // /start
  bot.start((ctx) => {
    const name = ctx.from.first_name || 'User';
    ctx.reply(
      `👋 Halo ${name}! Gw Todo Reminder Bot!

` +
      `Gw bisa bantu kamu manage todo & reminder.

` +
      `*Cara pakai:*
` +
      `• /remind <task> <waktu>
` +
      `• Kirim voice note (ucapkan tugas + waktu)
` +
      `• Ketik langsung aja, gw auto-detect!

` +
      `*Commands:*
` +
      `/today — Todo hari ini
` +
      `/tomorrow — Todo besok
` +
      `/upcoming — 7 hari ke depan
` +
      `/calendar — Kalender mingguan
` +
      `/list — Semua todo
` +
      `/stats — Statistik
` +
      `/search <keyword> — Cari todo
` +
      `/setemail <email>
` +
      `/help — Bantuan

` +
      `*Contoh input:*
` +
      `• "Tugas A besok jam 3 sore"
` +
      `• "Meeting client senin depan"
` +
      `• "Olahraga setiap senin jam 6 pagi"`,
      { parse_mode: 'Markdown' }
    );
  });

  // /help
  bot.help((ctx) => {
    ctx.reply(
      `📖 *Command List*

` +
      `*📋 Todo:*
` +
      `/remind <task> <waktu> — Tambah reminder
` +
      `/list — Lihat semua todo
` +
      `/done <nomor> — Tandai selesai
` +
      `/delete <nomor> — Hapus todo

` +
      `*🔍 Lihat Todo:*
` +
      `/today — Hari ini
` +
      `/tomorrow — Besok
` +
      `/upcoming — 7 hari ke depan
` +
      `/calendar — Kalender mingguan
` +
      `/search <keyword> — Cari todo
` +
      `/stats — Statistik

` +
      `*⚙️ Settings:*
` +
      `/setemail <email> — Set email reminder

` +
      `*🔄 Recurring:*
` +
      `"Olahraga setiap senin jam 6 pagi"
` +
      `"Minum obat setiap hari jam 8"

` +
      `*💡 Tips:*
` +
      `• Tambah kata "urgent" untuk prioritas tinggi
` +
      `• Gw auto-detect kategori (kuliah, kerja, dll)
` +
      `• Kirim teks langsung, gw coba pahami!
` +
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

    const { userEmails } = require('./botUtils');
    userEmails.set(ctx.chat.id, email);
    ctx.reply(`✅ Email di-set ke: ${email}
📧 Semua reminder akan dikirim ke email ini.`);
  });

  // /remind
  bot.command('remind', async (ctx) => {
    const text = ctx.message.text;
    const taskText = text.replace(/^\/remind\s*/i, '').trim();

    if (!taskText) {
      return ctx.reply(
        `❌ Format: /remind <task> <waktu>

` +
        `Contoh:
` +
        `• /remind tugas A hari rabu
` +
        `• /remind beli susu besok pagi
` +
        `• /remind olahraga setiap senin jam 6 pagi`
      );
    }

    const result = await parseReminderHybrid(taskText);

    if (!result.scheduledAt) {
      const llmHint = await generateHintWithLLM(taskText);
      const hints = generateHint(taskText);

      let msg = `❌ Gw gak ngerti waktu-nya 😅

`;
      if (llmHint) {
        msg += `💡 *${llmHint}*

`;
      } else if (hints.length > 0) {
        msg += `*Saran:*
`;
        hints.forEach(h => { msg += `• ${h}
`; });
        msg += '
';
      }
      msg += `*Contoh:*
` +
        `• /remind tugas A hari rabu
` +
        `• /remind beli susu besok pagi
` +
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

    let msg = `📋 *Todo Hari Ini (${todos.length}):*

`;
    todos.forEach((todo, i) => {
      const scheduledAt = new Date(todo.scheduled_at);
      const hours = String(scheduledAt.getHours()).padStart(2, '0');
      const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);
      const priorityEmoji = getPriorityEmoji(todo.priority);

      msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*
`;
      msg += `   ⏰ Jam ${hours}:${minutes}

`;
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

    let msg = `📋 *Todo Besok (${todos.length}):*

`;
    todos.forEach((todo, i) => {
      const scheduledAt = new Date(todo.scheduled_at);
      const hours = String(scheduledAt.getHours()).padStart(2, '0');
      const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);
      const priorityEmoji = getPriorityEmoji(todo.priority);

      msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*
`;
      msg += `   ⏰ Jam ${hours}:${minutes}

`;
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

    let msg = `📋 *Todo 7 Hari Ke Depan (${todos.length}):*

`;

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

      msg += `*${dayName} (${dateStr}):*
`;
      dayTodos.forEach(todo => {
        const scheduledAt = new Date(todo.scheduled_at);
        const hours = String(scheduledAt.getHours()).padStart(2, '0');
        const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
        const status = todo.status === 'done' ? '✅' : '⏳';
        const categoryEmoji = getCategoryEmoji(todo.category);
        const priorityEmoji = getPriorityEmoji(todo.priority);
        const recurringEmoji = todo.recurring ? '🔁' : '';

        msg += `  ${status} ${priorityEmoji} ${categoryEmoji} ${todo.aktivitas} ${recurringEmoji} (⏰${hours}:${minutes})
`;
      });
      msg += '
';
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

    let msg = `📅 *Kalender Minggu Ini*
`;
    msg += `${formatDate(startOfWeek)} - ${formatDate(endOfWeek)}

`;

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
        msg += `${dayEmojis[i]} ${dayLabel}: -
`;
      } else {
        msg += `${dayEmojis[i]} ${dayLabel}:
`;
        dayTodos.forEach(todo => {
          const scheduledAt = new Date(todo.scheduled_at);
          const hours = String(scheduledAt.getHours()).padStart(2, '0');
          const minutes = String(scheduledAt.getMinutes()).padStart(2, '0');
          const status = todo.status === 'done' ? '✅' : '⏳';
          const priorityEmoji = getPriorityEmoji(todo.priority);

          msg += `   ${status} ${priorityEmoji} ${todo.aktivitas} (${hours}:${minutes})
`;
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

    let msg = `📊 *Statistik Todo*

`;
    msg += `📋 Total: *${stats.total}*
`;
    msg += `✅ Selesai: *${stats.completed}*
`;
    msg += `⏳ Pending: *${stats.pending}*
`;

    if (stats.overdue > 0) {
      msg += `🚨 Overdue: *${stats.overdue}*
`;
    }

    msg += `
*Prioritas:*
`;
    msg += `🔴 Urgent: *${stats.urgent || 0}*
`;
    msg += `🟡 Normal: *${stats.normal_priority || 0}*
`;
    msg += `🟢 Low: *${stats.low_priority || 0}*
`;

    msg += `
📈 Tingkat penyelesaian: *${completionRate}%*
`;

    if (completionRate >= 80) {
      msg += `
🎉 *Hebat!* Kamu produktif banget!`;
    } else if (completionRate >= 50) {
      msg += `
💪 *Bagus!* Pertahankan!`;
    } else if (stats.overdue > 0) {
      msg += `
⚠️ *Ayo selesaikan yang overdue!*`;
    }

    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /search
  bot.command('search', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const keyword = args.join(' ');

    if (!keyword) {
      return ctx.reply('❌ Format: /search <keyword>
Contoh: /search meeting');
    }

    const todos = queries.searchTodos.all(ctx.chat.id, `%${keyword}%`);

    if (todos.length === 0) {
      return ctx.reply(`🔍 Tidak ditemukan todo dengan kata "${keyword}"`);
    }

    let msg = `🔍 *Hasil pencarian "${keyword}" (${todos.length}):*

`;
    todos.forEach((todo, i) => {
      const scheduledAt = formatDate(new Date(todo.scheduled_at));
      const status = todo.status === 'done' ? '✅' : '⏳';
      const categoryEmoji = getCategoryEmoji(todo.category);
      const priorityEmoji = getPriorityEmoji(todo.priority);

      msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*
`;
      msg += `   📅 ${scheduledAt}

`;
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
      msg += `🚨 *${overdue.length} todo OVERDUE!*

`;
    }

    msg += `📋 *Daftar Todo (${todos.length}):*

`;
    todos.forEach((todo, i) => {
      const scheduledAt = formatDate(new Date(todo.scheduled_at));
      const status = todo.status === 'done' ? '✅' : (todo.is_sent ? '🔔' : '⏳');
      const categoryEmoji = getCategoryEmoji(todo.category);
      const priorityEmoji = getPriorityEmoji(todo.priority);
      const isOverdue = todo.status === 'pending' && new Date(todo.scheduled_at) < new Date();
      const recurringEmoji = todo.recurring ? '🔁' : '';

      msg += `${i + 1}. ${status} ${priorityEmoji} ${categoryEmoji} *${todo.aktivitas}*${isOverdue ? ' ⚠️' : ''} ${recurringEmoji}
`;
      msg += `   📅 ${scheduledAt}
`;
      msg += `   🆔 ID: `${todo.id}`

`;
    });

    msg += `
/done <nomor> — Tandai selesai
/delete <nomor> — Hapus`;

    ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  // /done
  bot.command('done', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const index = parseInt(args[0]) - 1;

    if (isNaN(index)) {
      return ctx.reply('❌ Format: /done <nomor>
Cek nomor dengan /list');
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
      msg = `✅ *"${todo.aktivitas}"* ditandai selesai! 🎉

💪 *Tepat waktu! Good job!*`;
    } else {
      msg = `✅ *"${todo.aktivitas}"* ditandai selesai!

⏰ *Agak telat, tapi better late than never!*`;
    }

    ctx.reply(msg, { parse_mode: 'Markdown' });

    if (todo.recurring) {
      const nextScheduledAt = getNextRecurringDate(new Date(todo.scheduled_at), todo.recurring);
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
        `🔁 *Recurring:* "${todo.aktivitas}" dijadwalkan ulang
📅 Deadline: ${formatDate(nextScheduledAt)}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // /delete
  bot.command('delete', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const index = parseInt(args[0]) - 1;

    if (isNaN(index)) {
      return ctx.reply('❌ Format: /delete <nomor>
Cek nomor dengan /list');
    }

    const todos = queries.getTodosByChat.all(ctx.chat.id);
    if (index < 0 || index >= todos.length) {
      return ctx.reply(`❌ Nomor tidak valid. Pilih 1-${todos.length}`);
    }

    const todo = todos[index];
    queries.deleteTodo.run(todo.id, ctx.chat.id);

    ctx.reply(`🗑️ *"${todo.aktivitas}"* dihapus!`, { parse_mode: 'Markdown' });
  });
}

module.exports = { setupCommands };
