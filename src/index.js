require('dotenv').config();
const { initBot } = require('./bot');
const { initEmail } = require('./email');
const { startScheduler } = require('./scheduler');

// Validasi environment variables
const requiredEnv = ['TELEGRAM_BOT_TOKEN', 'SMTP_EMAIL', 'SMTP_PASSWORD', 'REMINDER_EMAIL'];
for (const envVar of requiredEnv) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing environment variable: ${envVar}`);
    process.exit(1);
  }
}

// ==================== Start Application ====================
async function main() {
  console.log('🤖 Starting Todo Reminder Bot...');
  console.log('================================');

  // 1. Initialize email
  console.log('\n📧 Initializing email...');
  initEmail();

  // 2. Initialize bot
  console.log('\n🤖 Initializing bot...');
  const bot = initBot();

  // 3. Start scheduler
  console.log('\n⏰ Starting scheduler...');
  startScheduler();

  // 4. Launch bot
  console.log('\n🚀 Launching bot...');
  await bot.launch();

  console.log('\n✅ Bot is running!');
  console.log('📧 Email reminder: active');
  console.log('🎤 Voice input: active');
  console.log('⏰ Scheduler: active (checking every minute)');
  console.log('\nPress Ctrl+C to stop');

  // Graceful shutdown
  process.once('SIGINT', () => {
    console.log('\n🛑 Stopping bot...');
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    console.log('\n🛑 Stopping bot...');
    bot.stop('SIGTERM');
  });
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
