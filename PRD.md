# PRD — Telegram Reminder Bot with Email Notification

**Version:** 1.0  
**Status:** Draft  
**Author:** —  
**Last Updated:** Juni 2026

---

## 1. Overview

### 1.1 Latar Belakang
Pengguna ingin sebuah bot Telegram yang dapat memahami perintah pengingat dalam bahasa natural (Bahasa Indonesia maupun Inggris), kemudian secara otomatis mengirimkan email pengingat pada waktu yang ditentukan menggunakan protokol SMTP.

### 1.2 Tujuan Produk
Membangun bot Telegram personal yang:
- Memahami input waktu dari pesan natural (contoh: *"ingetin saya joging di jam 6"*)
- Menyimpan reminder ke dalam scheduler
- Mengirim notifikasi email tepat waktu via SMTP

### 1.3 Target Pengguna
Pengguna personal (single-user bot) yang ingin manajemen pengingat sederhana langsung dari Telegram.

---

## 2. Scope

### In Scope
- Parsing perintah reminder dari pesan Telegram (NLP sederhana / regex)
- Penjadwalan reminder berbasis waktu (harian atau sekali)
- Pengiriman email notifikasi via SMTP
- Konfirmasi ke pengguna setelah reminder berhasil dibuat
- List, edit, dan hapus reminder yang sudah terdaftar

### Out of Scope
- Multi-user / multi-tenant
- Notifikasi via SMS atau push notification lainnya
- Integrasi kalender (Google Calendar, dll.)
- Antarmuka web / dashboard

---

## 3. User Stories

| ID | Sebagai... | Saya ingin... | Sehingga... |
|----|-----------|---------------|-------------|
| US-01 | Pengguna | Mengetik perintah natural seperti *"ingetin saya joging jam 6"* | Bot otomatis menjadwalkan reminder tanpa perlu format khusus |
| US-02 | Pengguna | Menerima konfirmasi dari bot setelah reminder dibuat | Saya tahu reminder berhasil tersimpan |
| US-03 | Pengguna | Menerima email pada waktu yang ditentukan | Saya mendapat pengingat meski tidak sedang buka Telegram |
| US-04 | Pengguna | Melihat daftar semua reminder aktif | Saya bisa memantau jadwal pengingat saya |
| US-05 | Pengguna | Menghapus reminder yang tidak diperlukan | Saya bisa mengelola reminder saya |
| US-06 | Pengguna | Membuat reminder berulang harian | Bot mengingatkan saya setiap hari di jam yang sama |

---

## 4. Functional Requirements

### 4.1 Parsing Perintah (NLP Layer)

Bot harus dapat mengenali:

- **Waktu eksplisit:** "jam 6", "jam 06:00", "pukul 18.00", "6 AM", "6 PM"
- **Waktu relatif:** "30 menit lagi", "2 jam lagi", "besok jam 9"
- **Aktivitas:** teks bebas setelah kata kunci waktu diekstrak
- **Trigger kata kunci:** "ingetin", "remind", "pengingat", "jadwalkan", "kasih tau"

**Contoh parsing:**

| Input | Aktivitas | Waktu | Pengulangan |
|-------|-----------|-------|-------------|
| "ingetin saya joging jam 6" | joging | 06:00 | sekali (hari ini) |
| "remind me to drink water every day at 8am" | drink water | 08:00 | harian |
| "ingetin minum obat 30 menit lagi" | minum obat | now + 30m | sekali |
| "besok jam 9 ingetin meeting" | meeting | besok 09:00 | sekali |

### 4.2 Penjadwalan (Scheduler)

- Menggunakan job scheduler (misalnya `node-cron` atau `APScheduler`)
- Setiap reminder disimpan dengan: `id`, `user_chat_id`, `aktivitas`, `waktu`, `email_tujuan`, `is_recurring`, `status`
- Mendukung reminder sekali dan harian
- Scheduler berjalan di background process

### 4.3 Pengiriman Email (SMTP)

- Menggunakan SMTP (bisa Gmail SMTP, Mailtrap, atau SMTP custom)
- Konfigurasi via environment variable: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Template email minimal:
  - **Subject:** `⏰ Reminder: {aktivitas}`
  - **Body:** Teks pengingat + waktu + opsi balas ke Telegram

### 4.4 Command Bot Telegram

| Command | Deskripsi |
|---------|-----------|
| `/start` | Sambutan + panduan singkat |
| `/list` | Tampilkan semua reminder aktif |
| `/delete {id}` | Hapus reminder berdasarkan ID |
| `/help` | Tampilkan daftar command |
| *(pesan bebas)* | Diparse sebagai perintah reminder |

### 4.5 Konfirmasi ke Pengguna

Setelah reminder berhasil dibuat, bot membalas dengan:

```
✅ Reminder berhasil dibuat!
📌 Aktivitas : Joging
⏰ Waktu      : Hari ini, 06:00
📧 Email ke  : kamu@email.com
🔁 Berulang  : Tidak
```

---

## 5. Non-Functional Requirements

| Kategori | Requirement |
|----------|-------------|
| **Ketersediaan** | Bot harus berjalan 24/7 (hosting VPS atau server tetap) |
| **Ketepatan waktu** | Email dikirim maksimal ±1 menit dari waktu yang ditentukan |
| **Keamanan** | Kredensial SMTP disimpan di `.env`, tidak di-hardcode |
| **Skalabilitas** | Minimal mendukung 50 reminder aktif secara bersamaan |
| **Recovery** | Reminder yang tersimpan di database tidak hilang jika bot restart |

---

## 6. Arsitektur Teknis

```
Pengguna
   │
   ▼
Telegram Bot API
   │
   ▼
┌─────────────────────────────────┐
│         Bot Server              │
│                                 │
│  ┌──────────┐  ┌─────────────┐  │
│  │  Message │  │  Scheduler  │  │
│  │  Handler │  │  (cron job) │  │
│  └────┬─────┘  └──────┬──────┘  │
│       │               │         │
│       ▼               ▼         │
│  ┌──────────────────────────┐   │
│  │        Database          │   │
│  │  (SQLite / PostgreSQL)   │   │
│  └──────────────────────────┘   │
│               │                  │
│               ▼                  │
│       SMTP Email Sender          │
└─────────────────────────────────┘
```

### Tech Stack Rekomendasi

| Layer | Pilihan |
|-------|---------|
| Runtime | Node.js (atau Python) |
| Bot Library | `node-telegram-bot-api` / `telegraf` (Node) atau `python-telegram-bot` |
| Scheduler | `node-cron` (Node) atau `APScheduler` (Python) |
| NLP/Parsing | Regex + `chrono-node` (Node) atau `dateparser` (Python) |
| Database | SQLite (simple) atau PostgreSQL |
| ORM | Prisma (Node) atau SQLAlchemy (Python) |
| Email | Nodemailer (Node) atau `smtplib` (Python) |
| Env Config | `dotenv` |

---

## 7. Data Model

### Tabel `reminders`

| Field | Tipe | Deskripsi |
|-------|------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `chat_id` | TEXT | Telegram chat ID pengguna |
| `aktivitas` | TEXT | Deskripsi pengingat |
| `scheduled_at` | DATETIME | Waktu pertama trigger |
| `is_recurring` | BOOLEAN | True jika harian |
| `email_target` | TEXT | Alamat email tujuan |
| `is_sent` | BOOLEAN | Status pengiriman |
| `created_at` | DATETIME | Waktu dibuat |

---

## 8. Alur Utama (Happy Path)

```
1. Pengguna kirim pesan: "ingetin saya joging jam 6"
2. Bot menerima pesan → NLP parser ekstrak aktivitas & waktu
3. Bot simpan reminder ke database
4. Bot kirim konfirmasi ke pengguna
5. Scheduler cek setiap menit → temukan reminder yang jatuh tempo
6. Bot kirim email via SMTP ke alamat terdaftar
7. Status reminder di-update menjadi `is_sent = true`
```

---

## 9. Konfigurasi Environment

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token

# Email SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM="Reminder Bot <your@gmail.com>"

# Email tujuan default (bisa di-override per user)
DEFAULT_EMAIL_TARGET=your@gmail.com

# Database
DATABASE_URL=file:./reminders.db
```

---

## 10. Edge Cases & Error Handling

| Kondisi | Penanganan |
|---------|-----------|
| Waktu tidak terdeteksi dari pesan | Bot balas: *"Hmm, aku nggak nangkep waktunya. Coba tulis ulang, contoh: 'ingetin joging jam 6'"* |
| Waktu sudah lewat | Bot balas: *"Waktu itu sudah lewat. Maksudnya besok jam 6?"* dan minta konfirmasi |
| SMTP gagal kirim | Log error, retry 1x setelah 5 menit, lalu tandai `failed` |
| Bot restart | Scheduler reload semua reminder aktif dari database saat startup |
| Pesan tidak relevan | Bot diam atau balas dengan `/help` |

---

## 11. Milestones

| Fase | Deliverable | Estimasi |
|------|-------------|----------|
| **M1** | Setup bot, `/start`, `/help`, echo message | 1 hari |
| **M2** | NLP parser waktu & aktivitas, simpan ke DB | 2 hari |
| **M3** | Scheduler + pengiriman email SMTP | 2 hari |
| **M4** | `/list`, `/delete`, konfirmasi pesan | 1 hari |
| **M5** | Testing end-to-end, error handling, deployment | 2 hari |

---

## 12. Open Questions

- [ ] Apakah email tujuan perlu bisa diubah per reminder, atau cukup satu email fixed dari `.env`?
- [ ] Apakah bot perlu mendukung timezone selain WIB?
- [ ] Apakah perlu fitur snooze (tunda reminder)?
- [ ] Deployment target: VPS mandiri, Railway, atau lainnya?
