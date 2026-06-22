const { Mistral } = require('@mistralai/mistralai');

let client = null;

function initLLM() {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ MISTRAL_API_KEY not set, LLM features disabled');
    return false;
  }

  client = new Mistral({ apiKey: apiKey });
  console.log('✅ Mistral AI initialized');
  return true;
}

/**
 * Parse pesan natural language menggunakan LLM
 * Returns: { task, date, time, category, urgency, confidence }
 */
async function parseWithLLM(text) {
  if (!client) {
    return null;
  }

  try {
    // Hitung hari ini di timezone Jakarta
    const now = new Date();
    const jakartaOffset = 7 * 60; // UTC+7
    const localOffset = now.getTimezoneOffset();
    const diff = jakartaOffset + localOffset;
    const jakartaNow = new Date(now.getTime() + diff * 60 * 1000);
    const todayStr = jakartaNow.toISOString().split('T')[0];
    const dayNames = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const todayDay = dayNames[jakartaNow.getDay()];

    const prompt = `Kamu adalah asisten yang membantu memparse pesan todo/reminder dari bahasa Indonesia sehari-hari.

Tugas: Ekstrak informasi dari pesan berikut dan kembalikan dalam format JSON.

Pesan: "${text}"

Kembalikan HANYA JSON (tanpa markdown, tanpa penjelasan) dengan format:
{
  "task": "nama task yang SUDAH DIPERBAIKI typo-nya dan jelas",
  "date": "tanggal dalam format YYYY-MM-DD atau null jika tidak ada",
  "time": "waktu DEADLINE dalam format HH:MM (24 jam) atau null jika tidak ada",
  "reminder_time": "waktu REMINDER dalam format HH:MM (24 jam) atau null jika user sebut 'ingetin jam X'",
  "category": "kuliah|kerja|belanja|kesehatan|pribadi|keuangan|general",
  "urgency": "urgent|normal|low",
  "confidence": 0.0-1.0
}

Aturan PENTING:
1. PERBAIKI TYPO! Contoh: "engitein" → "ingetin", "bsk" → "besok", "tgas" → "tugas"
2. "besok"/"bsk" = hari ini + 1 hari (bukan hari ini!)
3. "lusa" = hari ini + 2 hari
4. Jika ada "besok" + "hari X", gunakan BESOK (bukan hari X berikutnya)
5. Jika ada "X hari/minggu/bulan lagi", hitung dari hari ini

6. PERBEDAAN TIME vs REMINDER_TIME:
   - "jam X" yang berdiri sendiri = DEADLINE time (time)
   - "ingetin jam X" atau "reminder jam X" = REMINDER time (reminder_time)
   - Contoh: "olahraga jam 6 pagi" → time: "06:00" (DEADLINE)
   - Contoh: "olahraga jam 6 pagi, ingetin jam 5" → time: "06:00", reminder_time: "05:00"
   - Contoh: "ingetin saya olahraga jam 6 pagi" → time: "06:00" (DEADLINE, karena "jam 6 pagi" adalah waktu kejadian)

7. Konversi waktu ke 24 jam: "jam 9 pagi" = 09:00, "jam 2 siang" = 14:00, "jam 9 malam" = 21:00
8. "subuh" = 05:00, "pagi" = 09:00, "siang" = 13:00, "sore" = 16:00, "malam" = 20:00
9. Jika ada "jam X" spesifik, gunakan itu sebagai time (DEADLINE), BUKAN reminder_time
10. reminder_time HANYA jika user secara eksplisit bilang "ingetin jam X" atau "reminder jam X"
11. Deteksi urgency dari kata kunci: urgent, segera, penting, deadline, dll
12. Kategori berdasarkan konteks: tugas/kuliah = kuliah, meeting/rapat = kerja, olahraga/mandi/bangun = kesehatan, dll
13. Jika benar-benar tidak bisa diparse, confidence = 0

Hari ini: ${todayStr} (${todayDay})
Waktu sekarang: ${String(jakartaNow.getHours()).padStart(2,'0')}:${String(jakartaNow.getMinutes()).padStart(2,'0')}`;

    const response = await client.chat.complete({
      model: 'mistral-tiny',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      maxTokens: 300,
    });

    const content = response.choices[0].message.content.trim();

    // Parse JSON response
    // Handle case where LLM might wrap in markdown code blocks
    let jsonStr = content;
    if (content.includes('```')) {
      jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.task || parsed.confidence < 0.3) {
      return null;
    }

    // Pastikan reminder_time ada jika user sebut "ingetin jam X"
    if (!parsed.reminder_time) {
      const reminderMatch = text.match(/ingetin\s*(nya)?\s*jam\s*(\d{1,2})/i);
      if (reminderMatch) {
        let h = parseInt(reminderMatch[2]);
        if (h <= 12 && (text.includes('pagi') || text.includes('subuh'))) {
          // Tetap AM
        } else if (h <= 12 && (text.includes('sore') || text.includes('malam'))) {
          h += 12;
        }
        parsed.reminder_time = `${String(h).padStart(2, '0')}:00`;
      }
    }

    return parsed;
  } catch (error) {
    console.error('❌ LLM parse error:', error.message);
    return null;
  }
}

/**
 * Generate smart response menggunakan LLM
 */
async function generateResponse(task, deadline, category, urgency) {
  if (!client) {
    return null;
  }

  try {
    const prompt = `Kamu adalah bot reminder yang friendly dan helpful. Buat response singkat (maks 2 baris) untuk konfirmasi todo baru.

Task: ${task}
Deadline: ${deadline.toLocaleString('id-ID')}
Kategori: ${category}
Urgency: ${urgency}

Buat response yang:
1. Konfirmasi task tersimpan
2. Tambah emoji yang sesuai
3. Jika urgent, beri penekanan
4. Jika deadline dekat, beri peringatan
5. Gunakan bahasa Indonesia casual

HANYA response, tanpa penjelasan.`;

    const response = await client.chat.complete({
      model: 'mistral-tiny',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      maxTokens: 100,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('❌ LLM response error:', error.message);
    return null;
  }
}

/**
 * Generate hint/saran ketika input tidak dipahami
 */
async function generateHintWithLLM(text) {
  if (!client) {
    return null;
  }

  try {
    const prompt = `Kamu adalah bot reminder. User mengirim pesan yang tidak bisa diparse sebagai todo/reminder.

Pesan user: "${text}"

Beri saran singkat (1-2 baris) dalam bahasa Indonesia casual tentang bagaimana cara menulis pesan yang benar. Gunakan emoji.

HANYA saran, tanpa penjelasan.`;

    const response = await client.chat.complete({
      model: 'mistral-tiny',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      maxTokens: 100,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('❌ LLM hint error:', error.message);
    return null;
  }
}

module.exports = { initLLM, parseWithLLM, generateResponse, generateHintWithLLM };
