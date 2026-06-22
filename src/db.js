const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'todos.db');

// Pastiin folder data ada
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode untuk performa lebih baik
db.pragma('journal_mode = WAL');

// Buat tabel todos
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
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

const queries = {
  // Tambah todo baru
  addTodo: db.prepare(`
    INSERT INTO todos (chat_id, task, deadline, reminder_time, email)
    VALUES (@chatId, @task, @deadline, @reminderTime, @email)
  `),

  // Ambil semua todo berdasarkan chat_id
  getTodosByChat: db.prepare(`
    SELECT * FROM todos WHERE chat_id = ? ORDER BY deadline ASC
  `),

  // Ambil todo yang pending
  getPendingTodos: db.prepare(`
    SELECT * FROM todos WHERE status = 'pending' ORDER BY deadline ASC
  `),

  // Ambil todo yang perlu di-reminder (waktu reminder sudah lewat, belum di-reminder)
  getDueReminders: db.prepare(`
    SELECT * FROM todos
    WHERE status = 'pending'
    AND reminded = 0
    AND reminder_time <= datetime('now', 'localtime')
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
};

module.exports = { db, queries };
