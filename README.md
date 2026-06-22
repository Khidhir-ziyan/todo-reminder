# 🤖 Todo Reminder Bot

Telegram bot untuk mengingatkan tugas dengan **email reminder** dan input via **voice note**!

## ✨ Fitur

- 🎤 **Input via Voice Note** - Kirim suara, bot convert ke text
- 📧 **Reminder via Email** - Dapat reminder di email dengan urgency indicator
- 🇮🇩 **Support bahasa Indonesia** - Parsing waktu natural
- ⏰ **Smart Reminder** - 1 jam sebelum deadline (atau H-1 jam 8 malam untuk deadline pagi)
- 📱 **Auto-parse Text** - Kirim pesan biasa, bot otomatis detect reminder

## 🚀 Setup

### 1. Buat Telegram Bot

1. Buka Telegram, cari **@BotFather**
2. Kirim `/newbot`
3. Ikuti instruksi, beri nama dan username bot
4. Copy **bot token** yang diberikan

### 2. Setup Email

**Option A: Gmail (Recommended)**

1. Buka [Google Account Security](https://myaccount.google.com/security)
2. Aktifkan **2-Step Verification** (jika belum)
3. Buka **App Passwords** (search di Google Account)
4. Pilih **Mail** dan **Other (Custom name)**
5. Beri nama "Todo Bot"
6. Copy **16-character password** yang muncul

**Option B: Email Kampus/Custom SMTP**

1. Siapkan email dan password
2. Ketahui SMTP host dan port (biasanya 587 untuk TLS)

### 3. Setup Google Cloud Speech-to-Text (untuk Voice Input)

**Option A: Service Account JSON (Recommended)**
1. Buka [Google Cloud Console](https://console.cloud.google.com)
2. Buat project baru atau pilih existing
3. Enable **Cloud Speech-to-Text API**
4. Buat **Service Account** di IAM & Admin
5. Download JSON key file
6. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
   ```

**Option B: API Key**
1. Buka [Google Cloud Console](https://console.cloud.google.com)
2. Buat **API Key** di Credentials
3. Set di `.env`:
   ```
   GOOGLE_CLOUD_API_KEY=your-api-key
   ```

### 4. Konfigurasi

Edit file `.env`:

```bash
# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token-here

# Email - Gmail
SMTP_EMAIL=your-email@gmail.com
SMTP_PASSWORD=your-16-char-app-password
REMINDER_EMAIL=your-email@gmail.com

# Email - Custom SMTP (opsional)
# SMTP_HOST=mail.example.com
# SMTP_PORT=587

# Timezone
TZ=Asia/Jakarta
```

### 5. Jalankan

```bash
npm start
```

Untuk development (auto-restart):

```bash
npm run dev
```

## 📱 Commands

| Command | Fungsi |
|---------|--------|
| `/start` | Mulai bot |
| `/remind <tugas> <waktu>` | Tambah reminder |
| `/setemail <email>` | Set email reminder |
| `/list` | Lihat semua todo |
| `/done <nomor>` | Tandai selesai |
| `/delete <nomor>` | Hapus todo |
| `/help` | Bantuan |

## 🎤 Cara Pakai Voice Note

1. Buka chat dengan bot
2. Tekan dan tahan tombol **microphone**
3. Ucapkan tugas dan waktu, contoh:
   - "Belajar Node.js besok jam 3 sore"
   - "Meeting client hari jumat jam 10 pagi"
   - "Bayar tagihan tanggal 25 juni jam 9 pagi"
4. Lepas tombol, bot akan proses voice note
5. Bot akan konfirmasi todo yang ditambahkan

## 💡 Contoh Input

### Via Command
```
/remind tugas A hari rabu
/remind beli susu besok pagi
/remind meeting client senin depan jam 2 siang
/remind bayar tagihan 3 hari lagi
```

### Via Voice Note
```
"Belajar Node.js besok jam 3 sore"
"Meeting dengan client hari jumat jam 10 pagi"
"Bayar tagihan 25 juni jam 9 pagi"
"Olahraga setiap senin jam 6 pagi"
```

### Via Text Biasa (Auto-parse)
```
"ingetin gw tugas A hari rabu"
"reminder: meeting client besok pagi"
"beli susu 3 hari lagi"
```

## 🔔 Cara Kerja Reminder

1. Kamu tambah todo (via voice, command, atau text biasa)
2. Bot simpan todo dengan deadline
3. **1 jam sebelum deadline**, bot kirim **email reminder**
4. Untuk deadline pagi (≤10:00), reminder dikirim **H-1 jam 8 malam**
5. Jika email gagal, bot kirim pesan Telegram sebagai fallback

## 📁 Struktur Project

```
todo-reminder/
├── src/
│   ├── index.js      # Entry point
│   ├── bot.js        # Bot logic & commands
│   ├── parser.js     # Natural language parsing (Indonesia)
│   ├── email.js      # Email sending
│   ├── scheduler.js  # Cron scheduler
│   └── db.js         # Database setup & queries
├── data/             # SQLite database (auto-created)
├── temp/             # Temporary voice files (auto-cleaned)
├── .env              # Konfigurasi
└── package.json
```

## ⚠️ Catatan

- **Voice Input** memerlukan Google Cloud Speech-to-Text API
- **Email Reminder** mendukung Gmail dan SMTP custom
- Bot harus tetap running untuk mengirim reminder
- Database tersimpan di `data/todos.db`
- File voice temporary akan dihapus otomatis

## 🛠️ Troubleshooting

### Voice Note Tidak Bisa
- Pastikan Google Cloud Speech-to-Text API aktif
- Cek credentials di `.env` atau environment variable
- Cek logs: `npm run dev`

### Email Tidak Terkirim
- **Gmail**: Pastikan menggunakan **App Password**, bukan password biasa
- **Custom SMTP**: Pastikan SMTP_HOST dan SMTP_PORT benar
- Cek SMTP_EMAIL dan SMTP_PASSWORD di `.env`

### Bot Tidak Merespons
- Cek TELEGRAM_BOT_TOKEN di `.env`
- Pastikan bot sudah running: `npm start`
- Cek logs untuk error messages
