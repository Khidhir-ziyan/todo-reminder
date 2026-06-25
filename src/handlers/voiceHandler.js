const path = require('path');
const fs = require('fs');
const speech = require('@google-cloud/speech');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { downloadTelegramFile, cleanupFile } = require('./botUtils'); // This will be added to botUtils if not present, or we move them here.
const { parseReminderHybrid, saveTodo } = require('./botUtils');
const { generateHintWithLLM } = require('../llm');
const { generateHint } = require('../parser');

ffmpeg.setFfmpegPath(ffmpegPath);

async function transcribeAudio(audioFilePath) {
  try {
    const clientOptions = process.env.GOOGLE_CLOUD_API_KEY
      ? { apiKey: process.env.GOOGLE_CLOUD_API_KEY }
      : {};
    const client = new speech.SpeechClient(clientOptions);
    const audioBytes = fs.readFileSync(audioFilePath).toString('base64');

    const request = {
      audio: { content: audioBytes },
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'id-ID',
        alternativeLanguageCodes: ['en-US'],
      },
    };

    const [response] = await client.recognize(request);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join('
');

    return transcription || null;
  } catch (error) {
    console.error('❌ Error transcribing audio:', error.message);
    return null;
  }
}

async function convertOggToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

async function handleVoice(ctx, bot) {
  try {
    const voice = ctx.message.voice;
    const chatId = ctx.chat.id;
    const timestamp = Date.now();
    const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');

    const oggPath = path.join(TEMP_DIR, `voice_${chatId}_${timestamp}.ogg`);
    const wavPath = path.join(TEMP_DIR, `voice_${chatId}_${timestamp}.wav`);

    await ctx.reply('🎤 Memproses voice note...');
    
    // downloadTelegramFile helper needs to be in botUtils
    const { downloadTelegramFile, cleanupFile } = require('./botUtils');
    await downloadTelegramFile(voice.file_id, oggPath, bot);

    await ctx.reply('🔄 Konversi audio...');
    await convertOggToWav(oggPath, wavPath);

    await ctx.reply('📝 Transcribing...');
    const transcription = await transcribeAudio(wavPath);

    cleanupFile(oggPath);
    cleanupFile(wavPath);

    if (!transcription) {
      return ctx.reply('❌ Gagal transcribe voice note. Coba lagi ya.');
    }

    const result = await parseReminderHybrid(transcription);

    if (!result.scheduledAt) {
      const llmHint = await generateHintWithLLM(transcription);
      const hints = generateHint(transcription);

      let msg = `📝 *Hasil Transcribe:*
"${transcription}"

`;
      msg += `❌ Waktu tidak dikenali.

`;
      if (llmHint) {
        msg += `💡 *${llmHint}*
`;
      } else if (hints.length > 0) {
        msg += `*Saran:*
`;
        hints.forEach(h => { msg += `• ${h}
`; });
      }
      msg += `
💡 *Contoh: "Belajar besok jam 3 sore"*`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    const saved = saveTodo(ctx, result.aktivitas, result.scheduledAt, result.reminderTime, result.category, result.urgency, result.recurring);

    if (saved) {
      ctx.reply(
        `🎤 *Voice Note:* "${transcription}"`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('❌ Error handling voice:', error);
    ctx.reply('❌ Error processing voice note. Coba lagi ya.');
  }
}

module.exports = { handleVoice };
