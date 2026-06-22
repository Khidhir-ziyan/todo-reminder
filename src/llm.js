const MistralClient = require('@mistralai/mistralai');

let client = null;

function initLLM() {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ MISTRAL_API_KEY not set, LLM features disabled');
    return false;
  }

  client = new MistralClient(apiKey);
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
    const prompt = `Kamu adalah asisten yang membantu memparse pesan todo/reminder dari bahasa Indonesia sehari-hari.

Tugas: Ekstrak informasi dari pesan berikut dan kembalikan dalam format JSON.

Pesan: "${text}"

Kembalikan HANYA JSON (tanpa markdown, tanpa penjelasan) dengan format:
{
  "task": "nama task yang jelas",
  "date": "tanggal dalam format YYYY-MM-DD atau null jika tidak ada",
  "time": "waktu dalam format HH:MM atau null jika tidak ada",
  "category": "kuliah|kerja|belanja|kesehatan|pribadi|keuangan|general",
  "urgency": "urgent|normal|low",
  "confidence": 0.0-1.0
}

Aturan:
1. Jika ada "hari X" (senin-minggu), hitung tanggal berikutnya dari hari ini
2. Jika ada "besok" = hari ini + 1, "lusa" = hari ini + 2
3. Jika ada "X hari/minggu/bulan lagi", hitung dari hari ini
4. Jika ada "jam X" tapi AM/PM tidak jelas, gunakan konteks (pagi=AM, sore/malam=PM)
5. Jika tidak ada waktu, time = null
6. Jika tidak ada tanggal, date = null
7. Deteksi urgency dari kata kunci: urgent, segera, penting, deadline, dll
8. Kategori berdasarkan konteks: tugas/kuliah = kuliah, meeting/rapat = kerja, dll
9. Jika benar-benar tidak bisa diparse, confidence = 0

Hari ini: ${new Date().toISOString().split('T')[0]}
Hari: ${['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][new Date().getDay()]}`;

    const response = await client.chat({
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

    const response = await client.chat({
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

    const response = await client.chat({
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
