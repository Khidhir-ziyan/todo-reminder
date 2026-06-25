const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'todos.db');

// Pastiin folder data ada
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode untuk performa lebih baik
db.pragma('journal_mode = WAL');

// Cek apakah tabel ada dan punya kolom lama
let needsMigration = false;
try {
  const tableInfo = db.prepare("PRAGMA table_info(todos)").all();
  const columns = tableInfo.map(col => col.name);
  if (columns.includes('task') || columns.includes('deadline') || columns.includes('reminded') || columns.includes('email')) {
    needsMigration = true;
  }
} catch (e) {
  // Tabel belum ada, buat baru
}

if (needsMigration) {
  console.log('🔄 Running migration to PRD schema...');

  // Buat tabel baru dengan schema PRD
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      aktivitas TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      reminder_time TEXT NOT NULL,
      email_target TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      is_sent INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'normal',
      category TEXT DEFAULT 'general',
      recurring TEXT DEFAULT NULL,
      recurring_parent_id INTEGER DEFAULT NULL,
      snoozed_until TEXT DEFAULT NULL,
      retry_count INTEGER DEFAULT 0,
      last_retry_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Copy data dari tabel lama
  try {
    db.exec(`
      INSERT INTO todos_new (id, chat_id, aktivitas, scheduled_at, reminder_time, email_target, status, is_sent, priority, category, recurring, recurring_parent_id, snoozed_until, created_at)
      SELECT id, chat_id, task, deadline, reminder_time, email, status, reminded, priority, category, recurring, recurring_parent_id, snoozed_until, created_at FROM todos
    `);
    console.log('✅ Data migrated successfully');
  } catch (err) {
    console.error('❌ Error migrating data:', err.message);
  }

  // Drop tabel lama dan rename tabel baru
  db.exec('DROP TABLE IF EXISTS todos');
  db.exec('ALTER TABLE todos_new RENAME TO todos');
  console.log('✅ Migration completed!');
} else {
  // Buat tabel jika belum ada
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      aktivitas TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      reminder_time TEXT NOT NULL,
      email_target TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      is_sent INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'normal',
      category TEXT DEFAULT 'general',
      recurring TEXT DEFAULT NULL,
      recurring_parent_id INTEGER DEFAULT NULL,
      snoozed_until TEXT DEFAULT NULL,
      retry_count INTEGER DEFAULT 0,
      last_retry_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// Tambah kolom baru jika belum ada (migration)
const columns = [
  { name: 'priority', type: "TEXT DEFAULT 'normal'" },
  { name: 'category', type: "TEXT DEFAULT 'general'" },
  { name: 'recurring', type: 'TEXT DEFAULT NULL' },
  { name: 'recurring_parent_id', type: 'INTEGER DEFAULT NULL' },
  { name: 'snoozed_until', type: 'TEXT DEFAULT NULL' },
  { name: 'retry_count', type: 'INTEGER DEFAULT 0' },
  { name: 'last_retry_at', type: 'TEXT DEFAULT NULL' },
];

for (const col of columns) {
  try {
    db.exec(`ALTER TABLE todos ADD COLUMN ${col.name} ${col.type}`);
  } catch (e) { /* kolom sudah ada */ }
}

const queries = {
  // Tambah todo baru
  addTodo: db.prepare(`
    INSERT INTO todos (chat_id, aktivitas, scheduled_at, reminder_time, email_target, priority, category, recurring, recurring_parent_id)
    VALUES (@chatId, @aktivitas, @scheduledAt, @reminderTime, @emailTarget, @priority, @category, @recurring, @recurringParentId)
  `),

  // Ambil semua todo berdasarkan chat_id
  getTodosByChat: db.prepare(`
    SELECT * FROM todos WHERE chat_id = ? ORDER BY scheduled_at ASC
  `),

  // Ambil todo yang pending
  getPendingTodos: db.prepare(`
    SELECT * FROM todos WHERE status = 'pending' ORDER BY scheduled_at ASC
  `),

  // Ambil todo untuk hari ini
  getTodayTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND date(scheduled_at, '+7 hours') = date('now', '+7 hours')
    ORDER BY scheduled_at ASC
  `),

  // Ambil todo untuk besok
  getTomorrowTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND date(scheduled_at, '+7 hours') = date('now', '+1 day', '+7 hours')
    ORDER BY scheduled_at ASC
  `),

  // Ambil todo 7 hari ke depan
  getUpcomingTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND date(scheduled_at, '+7 hours') >= date('now', '+7 hours')
    AND date(scheduled_at, '+7 hours') <= date('now', '+7 days', '+7 hours')
    ORDER BY scheduled_at ASC
  `),

  // Ambil todo untuk minggu tertentu
  getWeekTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND date(scheduled_at) >= date(?)
    AND date(scheduled_at) <= date(?)
    ORDER BY scheduled_at ASC
  `),

  // Cari todo berdasarkan keyword
  searchTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND aktivitas LIKE ?
    ORDER BY scheduled_at ASC
  `),

  // Ambil todo yang overdue (scheduled_at sudah lewat)
  getOverdueTodos: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND datetime(scheduled_at) < datetime('now')
    ORDER BY scheduled_at ASC
  `),

  // Ambil todo berdasarkan prioritas
  getTodosByPriority: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND status = 'pending'
    AND priority = ?
    ORDER BY scheduled_at ASC
  `),

  // Ambil todo berdasarkan kategori
  getTodosByCategory: db.prepare(`
    SELECT * FROM todos
    WHERE chat_id = ?
    AND category = ?
    AND status = 'pending'
    ORDER BY scheduled_at ASC
  `),

  // Ambil statistik
  getStats: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'pending' AND datetime(scheduled_at) < datetime('now') THEN 1 ELSE 0 END) as overdue,
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
    AND is_sent = 0
    AND datetime(reminder_time) <= datetime('now')
  `),

  // Ambil todo yang gagal kirim email (untuk retry)
  getFailedEmails: db.prepare(`
    SELECT * FROM todos
    WHERE status = 'pending'
    AND is_sent = 1
    AND retry_count > 0
    AND retry_count < 2
    AND datetime(last_retry_at) <= datetime('now', '-5 minutes')
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
    UPDATE todos SET is_sent = 1 WHERE id = ?
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
    UPDATE todos SET email_target = ? WHERE chat_id = ? AND status = 'pending'
  `),

  // Update priority
  updatePriority: db.prepare(`
    UPDATE todos SET priority = ? WHERE id = ? AND chat_id = ?
  `),

  // Snooze todo
  snoozeTodo: db.prepare(`
    UPDATE todos SET snoozed_until = ?, is_sent = 0 WHERE id = ? AND chat_id = ?
  `),

  // Get todo by ID
  getTodoById: db.prepare(`
    SELECT * FROM todos WHERE id = ?
  `),

  // Mark email failed (untuk retry)
  markEmailFailed: db.prepare(`
    UPDATE todos SET retry_count = retry_count + 1, last_retry_at = datetime('now') WHERE id = ?
  `),

  // Mark email sent successfully
  markEmailSent: db.prepare(`
    UPDATE todos SET is_sent = 1, retry_count = 0 WHERE id = ?
  `),
};

module.exports = { db, queries };
