#!/bin/bash

echo "🤖 Todo Reminder Bot Setup"
echo "=========================="
echo ""

# Check .env
if grep -q "TELEGRAM_BOT_TOKEN=" /home/ubuntu/todo-reminder/.env; then
  if grep -q "TELEGRAM_BOT_TOKEN=$" /home/ubuntu/todo-reminder/.env; then
    echo "⚠️  TELEGRAM_BOT_TOKEN belum diisi!"
    echo ""
    echo "Langkah:"
    echo "1. Buka Telegram, cari @BotFather"
    echo "2. Kirim /newbot"
    echo "3. Ikuti instruksi, copy bot token"
    echo "4. Edit file: /home/ubuntu/todo-reminder/.env"
    echo "5. Isi TELEGRAM_BOT_TOKEN=your-token"
    echo ""
    exit 1
  fi
fi

# Check SMTP credentials
if grep -q "SMTP_PASSWORD=$" /home/ubuntu/todo-reminder/.env; then
  echo "⚠️  SMTP_PASSWORD belum diisi!"
  echo ""
  echo "Langkah:"
  echo "1. Buka Google Account Security"
  echo "2. Aktifkan 2-Step Verification"
  echo "3. Buat App Password untuk Mail"
  echo "4. Edit file: /home/ubuntu/todo-reminder/.env"
  echo "5. Isi SMTP_EMAIL dan SMTP_PASSWORD"
  echo ""
  exit 1
fi

echo "✅ .env sudah dikonfigurasi"
echo ""

# Check Google Cloud credentials
if [ -z "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  if ! grep -q "GOOGLE_APPLICATION_CREDENTIALS=" /home/ubuntu/todo-reminder/.env; then
    echo "⚠️  Google Cloud credentials belum diset!"
    echo ""
    echo "Voice input memerlukan Google Cloud Speech-to-Text API."
    echo ""
    echo "Option A: Set environment variable"
    echo "  export GOOGLE_APPLICATION_CREDENTIALS='/path/to/service-account.json'"
    echo ""
    echo "Option B: Set di .env file"
    echo "  GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json"
    echo ""
    echo "Lihat README.md untuk instruksi lengkap."
    echo ""
  fi
fi

# Install systemd service
echo "📦 Installing systemd service..."
sudo cp /home/ubuntu/todo-reminder/todo-reminder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable todo-reminder
sudo systemctl start todo-reminder

echo ""
echo "✅ Service installed and started!"
echo ""
echo "📋 Commands:"
echo "  sudo systemctl status todo-reminder   # Cek status"
echo "  sudo systemctl restart todo-reminder   # Restart bot"
echo "  sudo systemctl stop todo-reminder      # Stop bot"
echo "  sudo journalctl -u todo-reminder -f    # Lihat logs"
echo ""
echo "🎉 Bot is running! Cek Telegram kamu."
echo ""
echo "🎤 Cara pakai:"
echo "  1. Kirim voice note ke bot"
echo "  2. Ucapkan tugas dan waktu"
echo "  3. Bot akan convert ke text dan simpan todo"
echo "  4. Kamu dapat reminder via email!"
