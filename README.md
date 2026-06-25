# 🤖 Todo Reminder Bot — Telegram Bot with Email Notification

Bot Telegram yang memahami perintah reminder dalam bahasa natural (Indonesia/Inggris) dan mengirim notifikasi email via SMTP.

## ✨ Fitur

### Sesuai PRD
- ✅ **NLP Parsing** — Pahami input natural: *"ingetin saya joging jam 6"*
- ✅ **Penjadwalan** — Reminder sekali dan berulang (harian/mingguan/bulanan)
- ✅ **Email SMTP** — Kirim notifikasi email tepat waktu
- ✅ **Konfirmasi** — Balasan setelah reminder berhasil dibuat
- ✅ **List/Edit/Hapus** — Kelola reminder yang sudah terdaftar
- ✅ **Retry Email** — Auto-retry 1x setelah 5 menit jika gagal
- ✅ **Past Time Handling** — Konfirmasi jika waktu sudah lewat

### Fitur Tambahan
- 🎤 **Voice Note** — Kirim voice note, bot auto-transcribe & jadwalkan
- ⌨️ **Inline Buttons** — Done, Snooze (10m/1h), Delete
- 🏷️ **Auto Category** — Deteksi kategori (kuliah, kerja, kesehatan, dll)
- 🔴 **Priority** — Deteksi urgensi (urgent/normal/low)
- 📅 **Calendar View** — Kalender mingguan
- 📊 **Statistik** — Progress & completion rate
- 🔍 **Search** — Cari todo berdasarkan keyword
- ☀️ **Daily Summary** — Ringkasan todo setiap pagi jam 8
- 🤖 **LLM Integration** — Mistral AI untuk parsing lebih akurat (opsional)

## 🚀 Quick Start

### 1. Clone & Setup
```bash
git clone <repo-url>
cd todo-reminder
cp .env.example .env
```

### 2. Configure Environment
Edit `.env` file:
```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token

# SMTP (sesuai PRD)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM="Reminder Bot <your@gmail.com>"

# Email tujuan default
DEFAULT_EMAIL_TARGET=your@gmail.com

# Timezone
TZ=Asia/Jakarta
```

### 3. Run with Docker
```bash
docker compose up -d
```

### 4. Run without Docker
```bash
npm install
npm start
```

## 📱 Commands

| Command | Deskripsi |
|---------|-----------|
| `/start` | Sambutan + panduan |
| `/help` | Daftar command |
| `/remind <task> <waktu>` | Tambah reminder |
| `/list` | Lihat semua reminder |
| `/today` | Todo hari ini |
| `/tomorrow` | Todo besok |
| `/upcoming` | 7 hari ke depan |
| `/calendar` | Kalender mingguan |
| `/search <keyword>` | Cari todo |
| `/stats` | Statistik |
| `/setemail <email>` | Set email tujuan |
| `/done <nomor>` | Tandai selesai |
| `/delete <nomor>` | Hapus reminder |

## 💬 Contoh Input Natural

```
"ingetin saya joging jam 6"
"remind me to drink water every day at 8am"
"meeting client besok jam 3 sore"
"tugas kuliah hari rabu, reminder 30 menit sebelum"
"olahraga setiap senin jam 6 pagi"
```

## 📧 Email Configuration

### Gmail
1. Aktifkan 2FA di Google Account
2. Buat App Password: https://myaccount.google.com/apppasswords
3. Gunakan App Password di `SMTP_PASS`

### SMTP Custom (Kampus/Corporate)
```env
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=email@example.com
SMTP_PASS=your_password
```

## 🗄️ Data Model

Sesuai PRD, tabel `reminders`:

| Field | Tipe | Deskripsi |
|-------|------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `chat_id` | INTEGER | Telegram chat ID |
| `aktivitas` | TEXT | Deskripsi pengingat |
| `scheduled_at` | DATETIME | Waktu trigger |
| `reminder_time` | DATETIME | Waktu reminder |
| `email_target` | TEXT | Alamat email tujuan |
| `is_sent` | BOOLEAN | Status pengiriman |
| `status` | TEXT | pending/done |
| `priority` | TEXT | urgent/normal/low |
| `category` | TEXT | kuliah/kerja/dll |
| `recurring` | TEXT | daily/weekly/monthly |
| `retry_count` | INTEGER | Jumlah retry email |
| `created_at` | DATETIME | Waktu dibuat |

## 🔧 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | - | Bot token dari @BotFather |
| `SMTP_HOST` | ✅ | smtp.gmail.com | SMTP server |
| `SMTP_PORT` | ✅ | 587 | SMTP port |
| `SMTP_USER` | ✅ | - | SMTP username |
| `SMTP_PASS` | ✅ | - | SMTP password |
| `SMTP_FROM` | ❌ | "Reminder Bot" | Email sender |
| `DEFAULT_EMAIL_TARGET` | ✅ | - | Email tujuan default |
| `MISTRAL_API_KEY` | ❌ | - | Mistral AI API key |
| `TZ` | ❌ | Asia/Jakarta | Timezone |

## 📦 Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 |
| Bot Library | Telegraf |
| Scheduler | node-cron |
| NLP/Parsing | Regex + chrono-node |
| LLM | Mistral AI (opsional) |
| Database | SQLite (better-sqlite3) |
| Email | Nodemailer |
| Voice | Google Cloud Speech-to-Text |

## 📁 Struktur Project

```
todo-reminder/
├── src/
│   ├── index.js      # Entry point
│   ├── bot.js        # Bot logic & commands
│   ├── parser.js     # Natural language parsing
│   ├── email.js      # Email sending (SMTP)
│   ├── scheduler.js  # Cron scheduler + retry
│   ├── db.js         # Database setup & queries
│   ├── llm.js        # Mistral AI integration
│   └── migration.js  # Database migration
├── data/             # SQLite database
├── temp/             # Temporary voice files
├── .env              # Konfigurasi
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## 📄 License

MIT
