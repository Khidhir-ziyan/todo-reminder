# 🤖 GEMINI.md — Instructional Context & Development Guide

This document provides developer guidelines, architectural overview, building/running instructions, and development conventions for the **Todo Reminder Bot** project. Please refer to this file when onboarding, developing, or refactoring components in this repository.

---

## 📌 Project Overview

**Todo Reminder Bot** is a single-user personal Telegram Bot designed to capture, parse, and schedule reminders using natural language input (Indonesian or English), via both text and voice. Reminders are saved to a local SQLite database and dispatched timely through SMTP email alerts and interactive Telegram messages.

### Key Features
1. **Natural Language Processing (NLP):**
   - **Local Parser (`src/parser.js`):** Employs regular expressions, custom keyword dictionaries (for categories, urgency, and recurrences), and `chrono-node` to extract tasks and schedule dates.
   - **LLM-assisted Parser (`src/llm.js`):** Integrates with Mistral AI (`mistral-tiny`) for high-accuracy NLP extraction, automated typo correction, and smart context-aware conversational hints/replies.
2. **Audio/Voice Reminders:**
   - Converts Telegram audio messages (`.ogg`) to WAV using `ffmpeg` and transcribes them using Google Cloud Speech-to-Text.
3. **Robust Scheduling & Dispatching (`src/scheduler.js`):**
   - Utilizes `node-cron` to check due tasks every minute.
   - Triggers SMTP email notifications via `nodemailer` with built-in retry mechanics (auto-retry after 5 minutes on failure).
   - Sends daily morning summaries (at 08:00 AM Asia/Jakarta) listing overdue and upcoming todos.
   - Supports interactive snooze (10 mins / 1 hour) and completion ("Done") buttons directly within Telegram messages.
4. **Data Persistence (`src/db.js`):**
   - Uses `better-sqlite3` to manage a local SQLite database file with Write-Ahead Logging (WAL) enabled for optimal performance.
   - Includes automatic database schema creation and migration paths on initialization.

---

## 📂 Architecture & Directory Structure

```
todo-reminder/
├── data/                 # Local SQLite database files
├── src/
│   ├── index.js          # Main entry point: initializes SMTP, LLM, Bot, and starts Scheduler
│   ├── bot.js            # Telegram Bot handler, user commands, and voice/inline keyboards
│   ├── parser.js         # Natural language processing helpers and local extraction
│   ├── db.js             # Database connection, schemas, migrations, and query definitions
│   ├── scheduler.js      # Cron job scheduling for reminders, retries, and daily summaries
│   ├── email.js          # SMTP integration using Nodemailer
│   └── llm.js            # Mistral AI API interaction helper
├── temp/                 # Local temp storage for processing audio files
├── .env.example          # Environment variable template
├── Dockerfile            # Container build specification
├── docker-compose.yml    # Service orchestration
├── package.json          # Node.js dependencies & scripts
└── PRD.md                # Product Requirements Document
```

---

## 🛠️ Building, Configuring & Running

### 1. Configuration (`.env`)
Create a `.env` file from the template:
```bash
cp .env.example .env
```

Ensure the following variables are configured:
* `TELEGRAM_BOT_TOKEN`: Token obtained from [@BotFather](https://t.me/BotFather).
* `SMTP_USER` / `SMTP_PASS`: SMTP credentials (e.g., Gmail App Password).
* `DEFAULT_EMAIL_TARGET`: Destination email where reminder notifications will be sent.
* `MISTRAL_API_KEY` (Optional): Enabled LLM features if set.
* `GOOGLE_CLOUD_API_KEY` (Optional): Key for Google Speech-to-Text translation (otherwise standard environment auth applies).

### 2. Running Locally (Node.js 20+)
To install dependencies:
```bash
npm install
```

To run the application in production mode:
```bash
npm start
```

To run in development mode (with automatic hot-reloading):
```bash
npm run dev
```

### 3. Running with Docker
```bash
docker compose up -d
```

---

## 🗄️ Database Schema & Data Model

The database resides in `data/todos.db` and is operated using `better-sqlite3`. At startup, migrations run automatically to verify and construct the `todos` table with the following columns:

| Column Name | Type | Constraints / Default | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique ID |
| `chat_id` | INTEGER | NOT NULL | Telegram chat ID |
| `aktivitas` | TEXT | NOT NULL | Action/description of the todo |
| `scheduled_at` | TEXT | NOT NULL | Datetime when the task should occur |
| `reminder_time` | TEXT | NOT NULL | Datetime for triggering the reminder |
| `email_target` | TEXT | NOT NULL | Destination email address |
| `status` | TEXT | DEFAULT 'pending' | Status: `pending` / `done` |
| `is_sent` | INTEGER | DEFAULT 0 | Status of email reminder dispatch |
| `priority` | TEXT | DEFAULT 'normal' | Urgent, normal, or low priority |
| `category` | TEXT | DEFAULT 'general' | Category: kuliah, kerja, belanja, kesehatan, dll. |
| `recurring` | TEXT | DEFAULT NULL | Pattern: `daily`, `weekly`, `monthly`, or NULL |
| `recurring_parent_id` | INTEGER | DEFAULT NULL | ID of parent todo if generated by recurring rule |
| `snoozed_until` | TEXT | DEFAULT NULL | Datetime until which the todo is snoozed |
| `retry_count` | INTEGER | DEFAULT 0 | Number of failed email delivery attempts |
| `last_retry_at` | TEXT | DEFAULT NULL | Datetime of the last retry attempt |
| `created_at` | TEXT | DEFAULT (datetime('now', 'localtime')) | Record creation timestamp |

---

## ⚙️ Development Conventions

1. **Environment Initialization:**
   - Always verify essential variables (`TELEGRAM_BOT_TOKEN`, `SMTP_USER`, `SMTP_PASS`, `DEFAULT_EMAIL_TARGET`) at application launch in `index.js`.
2. **Database Queries:**
   - All database statements must be pre-compiled and declared within the `queries` export in `src/db.js` using `better-sqlite3`'s `.prepare(...)` statement for maximum efficiency and security against injection.
3. **Timezones:**
   - The default timezone is set to `Asia/Jakarta`. All relative calculations, daily summaries, and dates parsed through `chrono-node` should correctly reflect this timezone offset.
4. **Error Handling & Resiliency:**
   - Implement strict error handling around voice conversions, transcription, LLM prompts, and email sending.
   - When an email fails to deliver, record the failure and use the retry cron check to re-attempt delivery before marking as failed.
5. **Cleanups:**
   - Temporary voice files saved in `temp/` must be unlinked/deleted asynchronously using `fs.unlink` once processed. Use helper `cleanupFile(filePath)` in `src/bot.js`.
6. **Graceful Shutdowns:**
   - Capture `SIGINT` and `SIGTERM` signals inside `src/index.js` to shut down the bot client (`bot.stop`) and any outstanding open tasks gracefully.
7. **Code Formatting & Writing Style:**
   - Adhere to CommonJS modules (`require` / `module.exports`).
   - Use clean, asynchronous handlers with `async`/`await`.
   - Prefer lightweight composition and explicit error logs when interactions with external APIs fail.
