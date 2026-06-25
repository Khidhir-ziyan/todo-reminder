const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'todos.db');
const db = new Database(DB_PATH);

console.log('🔄 Starting migration...');

// Rename columns to match PRD
const renames = [
  { from: 'task', to: 'aktivitas' },
  { from: 'deadline', to: 'scheduled_at' },
  { from: 'reminded', to: 'is_sent' },
  { from: 'email', to: 'email_target' },
];

// SQLite doesn't support RENAME COLUMN in older versions
// We need to create a new table and copy data

// Check if old columns exist
const tableInfo = db.prepare("PRAGMA table_info(todos)").all();
const existingColumns = tableInfo.map(col => col.name);

const hasOldColumns = existingColumns.includes('task') || existingColumns.includes('deadline');

if (hasOldColumns) {
  console.log('📦 Creating new table with PRD schema...');

  // Create new table with PRD schema
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

  // Copy data from old table
  const hasEmail = existingColumns.includes('email');
  const hasReminded = existingColumns.includes('reminded');
  const hasTask = existingColumns.includes('task');
  const hasDeadline = existingColumns.includes('deadline');

  const selectCols = ['id', 'chat_id'];
  const insertCols = ['id', 'chat_id'];

  if (hasTask) {
    selectCols.push('task');
    insertCols.push('aktivitas');
  }
  if (hasDeadline) {
    selectCols.push('deadline');
    insertCols.push('scheduled_at');
  }

  selectCols.push('reminder_time');
  insertCols.push('reminder_time');

  if (hasEmail) {
    selectCols.push('email');
    insertCols.push('email_target');
  }

  selectCols.push('status');
  insertCols.push('status');

  if (hasReminded) {
    selectCols.push('reminded');
    insertCols.push('is_sent');
  }

  // Add remaining columns
  const remainingCols = ['priority', 'category', 'recurring', 'recurring_parent_id', 'snoozed_until', 'created_at'];
  for (const col of remainingCols) {
    if (existingColumns.includes(col)) {
      selectCols.push(col);
      insertCols.push(col);
    }
  }

  const insertSQL = `INSERT INTO todos_new (${insertCols.join(', ')}) SELECT ${selectCols.join(', ')} FROM todos`;

  try {
    db.exec(insertSQL);
    console.log('✅ Data copied successfully');
  } catch (err) {
    console.error('❌ Error copying data:', err.message);
    // Try with simpler query
    db.exec(`
      INSERT INTO todos_new (id, chat_id, aktivitas, scheduled_at, reminder_time, email_target, status, is_sent, priority, category, recurring, recurring_parent_id, snoozed_until, created_at)
      SELECT id, chat_id, task, deadline, reminder_time, email, status, reminded, priority, category, recurring, recurring_parent_id, snoozed_until, created_at FROM todos
    `);
    console.log('✅ Data copied with fallback query');
  }

  // Drop old table and rename new table
  db.exec('DROP TABLE todos');
  db.exec('ALTER TABLE todos_new RENAME TO todos');

  console.log('✅ Migration completed!');
} else {
  console.log('✅ Table already has PRD schema');

  // Add retry columns if not exist
  const retryColumns = [
    { name: 'retry_count', type: 'INTEGER DEFAULT 0' },
    { name: 'last_retry_at', type: 'TEXT DEFAULT NULL' },
  ];

  for (const col of retryColumns) {
    try {
      db.exec(`ALTER TABLE todos ADD COLUMN ${col.name} ${col.type}`);
      console.log(`✅ Added column: ${col.name}`);
    } catch (e) {
      // Column already exists
    }
  }
}

db.close();
console.log('🎉 Migration script finished');
