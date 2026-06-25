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
 * Returns: { task, date, time, reminder_time, category, urgency, recurring, confidence }
 */
async function parseWithLLM(text) {
  if (!client) {
    return null;
  }

  try {
    // 1. Get current date/time in Asia/Jakarta correctly
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { 
      timeZone: 'Asia/Jakarta', 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    });
    const todayStr = formatter.format(now); // Returns YYYY-MM-DD

    // Get current time in Jakarta for the prompt
    const jakartaTimeStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);

    const dayNames = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const jakartaDayName = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long'
    }).format(now);

    const prompt = `Kamu adalah asisten NLP ahli untuk bot pengingat (reminder bot).
Tugasmu adalah mengekstrak informasi dari pesan user ke dalam format JSON.

KONTEKS WAKTU:
- Hari ini: ${todayStr} (${jakartaDayName})
- Jam sekarang: ${jakartaTimeStr} (WIB/Asia/Jakarta)

FORMAT OUTPUT (HANYA JSON):
{
  "task": "nama task (perbaiki typo & buat jelas)",
  "date": "YYYY-MM-DD atau null jika tidak ada",
  "time": "HH:mm (waktu kejadian/deadline) atau null jika tidak ada",
  "reminder_time": "HH:mm (waktu diingatkan) atau null jika tidak ada",
  "category": "kuliah|kerja|belanja|kesehatan|pribadi|keuangan|general",
  "urgency": "urgent|normal|low",
  "recurring": "daily|weekly|monthly|null",
  "confidence": 0.0-1.0
}

ATURAN LOGIKA:
1. TYPO: Perbaiki kata seperti "engitein" -> "ingetin", "bsk" -> "besok", "tgas" -> "tugas".
2. DATE: 
   - "besok"/"bsk" = ${todayStr} + 1 hari.
   - "lusa" = ${todayStr} + 2 hari.
   - Jika tidak sebut tanggal, gunakan ${todayStr}.
3. TIME vs REMINDER_TIME:
   - "jam X" = waktu kejadian (time).
   - "ingetin jam X" atau "reminder jam X" = waktu notifikasi (reminder_time).
   - Jika user bilang "ingetin saya [task] jam X", maka [task] adalah tugasnya, dan jam X adalah reminder_time.
   - Jika user bilang "[task] jam X", maka jam X adalah time (deadline).
4. RECURRING:
   - "setiap hari/tiap hari" -> "daily"
   - "setiap minggu/mingguan" -> "weekly"
   - "setiap bulan/bulanan" -> "monthly"
5. KATEGORI & URGENCY: Tentukan berdasarkan konteks (misal: 'meeting' -> 'kerja', 'obat' -> 'kesehatan').

CONTOH (FEW-SHOT):
Input: "ingetin saya joging jam 6 pagi"
Output: {"task": "Joging", "date": "${todayStr}", "time": "06:00", "reminder_time": null, "category": "kesehatan", "urgency": "normal", "recurring": null, "confidence": 1.0}

Input: "remind me to drink water every day at 8am"
Output: {"task": "Minum air putih", "date": "${todayStr}", "time": "08:00", "reminder_time": null, "category": "kesehatan", "urgency": "normal", "recurring": "daily", "confidence": 1.0}

Input: "bsk jam 9 ingetin meeting penting"
Output: {"task": "Meeting penting", "date": "${todayStr}", "time": "09:00", "reminder_time": null, "category": "kerja", "urgency": "urgent", "recurring": null, "confidence": 1.0}

Input: "olahraga jam 6 pagi, ingetin jam 5"
Output: {"task": "Olahraga", "date": "${todayStr}", "time": "06:00", "reminder_time": "05:00", "category": "kesehatan", "urgency": "normal", "recurring": null, "confidence": 1.0}

Input: "belanja bulanan"
Output: {"task": "Belanja bulanan", "date": "${todayStr}", "time": null, "reminder_time": null, "category": "belanja", "urgency": "normal", "recurring": "monthly", "confidence": 0.9}

Pesan User: "${text}"`;

    const response = await client.chat.complete({
      model: 'mistral-tiny',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      maxTokens: 400,
    });

    const content = response.choices[0].message.content.trim();

    // Parse JSON response
    let jsonStr = content;
    if (content.includes('```')) {
      jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.task || parsed.confidence < 0.3) {
      return null;
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
