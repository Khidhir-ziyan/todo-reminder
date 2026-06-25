const nodemailer = require('nodemailer');
const { formatDate } = require('./parser');

let transporter = null;

function initEmail() {
  // Support Gmail atau SMTP server custom sesuai PRD
  const smtpConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false // Accept self-signed certificates
    }
  };

  transporter = nodemailer.createTransport(smtpConfig);

  // Verify connection
  transporter.verify((err) => {
    if (err) {
      console.error('❌ Email setup error:', err.message);
    } else {
      console.log('✅ Email ready');
    }
  });
}

/**
 * Kirim email reminder
 */
async function sendReminder(todo) {
  if (!transporter) {
    console.error('❌ Email not initialized');
    return false;
  }

  const scheduledAt = new Date(todo.scheduled_at);
  const deadlineStr = formatDate(scheduledAt);

  // Hitung sisa waktu
  const now = new Date();
  const diff = scheduledAt - now;
  const hoursLeft = Math.floor(diff / (1000 * 60 * 60));
  const daysLeft = Math.floor(hoursLeft / 24);

  let urgencyEmoji = '⏰';
  let urgencyText = '';
  if (daysLeft > 1) {
    urgencyText = `${daysLeft} hari lagi`;
  } else if (hoursLeft > 0) {
    urgencyText = `${hoursLeft} jam lagi`;
    urgencyEmoji = '⚠️';
  } else {
    urgencyText = 'SUDAH DEADLINE!';
    urgencyEmoji = '🚨';
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
      <div style="background: #4F46E5; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">${urgencyEmoji} Reminder: ${todo.aktivitas}</h2>
      </div>
      <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px; color: #374151;">
          <strong>📌 Aktivitas:</strong> ${todo.aktivitas}
        </p>
        <p style="font-size: 16px; color: #374151;">
          <strong>⏰ Waktu:</strong> ${deadlineStr}
        </p>
        <p style="font-size: 18px; color: #DC2626; font-weight: bold;">
          ${urgencyEmoji} ${urgencyText}
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 15px 0;">
        <p style="font-size: 12px; color: #9ca3af;">
          Dikirim oleh Todo Reminder Bot 🤖
        </p>
      </div>
    </div>
  `;

  try {
    const from = process.env.SMTP_FROM || `"Reminder Bot" <${process.env.SMTP_USER}>`;
    await transporter.sendMail({
      from: from,
      to: todo.email_target,
      subject: `${urgencyEmoji} Reminder: ${todo.aktivitas} - ${urgencyText}`,
      html,
    });
    console.log(`📧 Email sent to ${todo.email_target} for: ${todo.aktivitas}`);
    return true;
  } catch (err) {
    console.error(`❌ Email failed: ${err.message}`);
    return false;
  }
}

module.exports = { initEmail, sendReminder };
