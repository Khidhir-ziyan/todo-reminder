const { queries } = require('../db');
const { getBot } = require('../bot');
const { Markup } = require('telegraf');
const { getNextRecurringDate } = require('./botUtils');

async function handleAction(ctx) {
  const action = ctx.callbackQuery.data;

  if (action.startsWith('done_')) {
    const todoId = parseInt(action.split('_')[1]);
    const todo = queries.getTodoById.get(todoId);

    if (!todo) {
      return ctx.answerCbQuery('❌ Todo tidak ditemukan');
    }

    queries.markDone.run(todoId, todo.chat_id);
    await ctx.answerCbQuery('✅ Ditandai selesai!');

    await ctx.editMessageText(
      `✅ *"${todo.aktivitas}"* ditandai selesai! 🎉`,
      { parse_mode: 'Markdown' }
    );

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
        recurringParentId: todoId,
      });

      ctx.reply(
        `🔁 *Recurring:* "${todo.aktivitas}" dijadwalkan ulang
📅 Deadline: ${require('../parser').formatDate(nextScheduledAt)}`,
        { parse_mode: 'Markdown' }
      );
    }
  } else if (action.startsWith('snooze_')) {
    const [_, todoIdStr, minutesStr] = action.split('_');
    const todoId = parseInt(todoIdStr);
    const minutes = parseInt(minutesStr);
    const todo = queries.getTodoById.get(todoId);

    if (!todo) {
      return ctx.answerCbQuery('❌ Todo tidak ditemukan');
    }

    const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);
    queries.snoozeTodo.run(snoozeUntil.toISOString(), todoId, todo.chat_id);

    await ctx.answerCbQuery(`⏰ Di-snooze ${minutes} menit`);

    await ctx.editMessageText(
      `⏰ *"${todo.aktivitas}"* di-snooze ${minutes} menit
📅 Reminder: ${require('../parser').formatDate(snoozeUntil)}`,
      { parse_mode: 'Markdown' }
    );
  } else if (action.startsWith('delete_')) {
    const todoId = parseInt(action.split('_')[1]);
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
  }
}

module.exports = { handleAction };
