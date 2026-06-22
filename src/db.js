const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'todos.db');

// Pastiin folder data ada
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode untuk performa lebih baik
db.pragma('journal_mode = WAL');

// Buat tabel todos dengan field baru
db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    task TEXT NOT NULL,
    deadline TEXT NOT NULL,
    reminder_time TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    reminded INTEGER DEFAULT 0,
    priority TEXT DEFAULT 'normal',
    category TEXT DEFAULT 'general',
    recurring TEXT DEFAULT NULL,
    recurring_parent_id INTEGER DEFAULT NULL,
    snoozed_until TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

// Tambah kolom baru jika belum ada (migration)
const columns = [
  { name: 'priority', type: "TEXT DEFAULT 'normal'" },
  { name: 'category', type: "TEXT DEFAULT 'general'" },
  { name: 'recurring', type: 'TEXT DEFAULT NULL' },
  { name: 'recurring_parent_id', type: 'INTEGER DEFAULT NULL' },
  { name: 'snoozed_until', type: 'TEXT DEFAULT NULL' },
];

for (const col of columns) {
  try {
    db.exec(`ALTER TABLE todos ADD COLUMN ${col.name} ${col.type}`);
  } catch (e) { /* kolom sudah ada */ }
}

const queries = {
  // Tambah todo baru
  addTodo: db.prepare(`
    INSERT INTO todos (chat_id, task, deadline, reminder_time, email, priority, category, recurring, recurring_parent_id)
    VALUES (@chatId, @task, @deadline, @reminderTime, @email, @priority, @category, @recurring, @recurringParentId)
  `),

  // Ambil semua todo berdasarkan chat_id
  getTodosByChat: db.prepare(`
    SELECT * FROM todos WHERE chat_id = ? ORDER BY deadline ASC
  `),

  // Ambil todo yang pending
  getPendingTodos: db.prepare(`
    SELECT * FROM todos WHERE status = 'pending' ORDER BY deadline ASC
  `),

  // Ambil todo untuk hari ini
  getTodayTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND date(deadline) = date('now', 'localtime')
    ORDER BY deadline ASC
  `),

  // Ambil todo untuk besok
  getTomorrowTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND date(deadline) = date('now', '+1 day', 'localtime')
    ORDER BY deadline ASC
  `),

  // Ambil todo 7 hari ke depan
  getUpcomingTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND date(deadline) >= date('now', 'localtime')
    AND date(deadline) <= date('now', '+7 days', 'localtime')
    ORDER BY deadline ASC
  `),

  // Ambil todo untuk minggu tertentu
  getWeekTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND date(deadline) >= date(?)
    AND date(deadline) <= date(?)
    ORDER BY deadline ASC
  `),

  // Cari todo berdasarkan keyword
  searchTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND task LIKE ?
    ORDER BY deadline ASC
  `),

  // Ambil todo yang overdue (deadline sudah lewat)
  getOverdueTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND deadline < datetime('now', 'localtime')
    ORDER BY deadline ASC
  `),

  // Ambil todo berdasarkan prioritas
  getTodosByPriority: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND priority = ?
    ORDER BY deadline ASC
  `),

  // Ambil todo berdasarkan kategori
  getTodosByCategory: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND category = ?
    AND status = 'pending'
    ORDER BY deadline ASC
  `),

  // Ambil statistik
  getStats: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'pending' AND deadline < datetime('now', 'localtime') THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN priority = 'urgent' AND status = 'pending' THEN 1 ELSE 0 END) as urgent,
      SUM(CASE WHEN priority = 'normal' AND status = 'pending' THEN 1 ELSE 0 END) as normal_priority,
      SUM(CASE WHEN priority = 'low' AND status = 'pending' THEN 1 ELSE 0 END) as low_priority
    FROM todos
    WHERE chat_id = ?
  `),

  // Ambil semua chat_id unik (untuk daily summary)
  getAllChatIds: db.prepare(`
    SELECT DISTINCT chat_id FROM todos
  `),

  // Ambil todo yang perlu di-reminder (waktu reminder sudah lewat, belum di-reminder)
  getDueReminders: db.prepare(`
    SELECT * FROM todos
    WHERE status = 'pending'
    AND reminded = 0
    AND reminder_time <= datetime('now', 'localtime')
  `),

  // Ambil todo recurring yang perlu dibuat ulang
  getDueRecurring: db.prepare(`
    SELECT * FROM todos
    WHERE status = 'done'
    AND recurring IS NOT NULL
    AND recurring_parent_id IS NULL
  `),

  // Tandai sudah di-reminder
  markReminded: db.prepare(`
    UPDATE todos SET reminded = 1 WHERE id = ?
  `),

  // Tandai selesai
  markDone: db.prepare(`
    UPDATE todos SET status = 'done' WHERE id = ? AND chat_id = ?
  `),

  // Hapus todo
  deleteTodo: db.prepare(`
    DELETE FROM todos WHERE id = ? AND chat_id = ?
  `),

  // Update email default untuk chat
  updateEmail: db.prepare(`
    UPDATE todos SET email = ? WHERE chat_id = ? AND status = 'pending'
  `),

  // Update priority
  updatePriority: db.prepare(`
    UPDATE todos SET priority = ? WHERE id = ? AND chat_id = ?
  `),

  // Snooze todo
  snoozeTodo: db.prepare(`
    UPDATE todos SET snoozed_until = ?, reminded = 0 WHERE id = ? AND chat_id = ?
  `),

  // Get todo by ID
  getTodoById: db.prepare(`
    SELECT * FROM todos WHERE id = ?
  `),
};

module.exports = { db, queries };
