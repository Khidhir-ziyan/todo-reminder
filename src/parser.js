const chrono = require('chrono-node');

// Mapping hari Indonesia ke angka (0=Min, 1=Sen, ..., 6=Sab)
const hariMap = {
  'minggu': 0, 'senin': 1, 'selasa': 2, 'rabu': 3,
  'kamis': 4, 'jumat': 5, 'sabtu': 6,
  'ahad': 0, 'jum\'at': 5,
};

// Mapping kata waktu Indonesia
const waktuMap = {
  'pagi': '09:00',
  'siang': '13:00',
  'sore': '16:00',
  'malam': '20:00',
  'subuh': '05:00',
};

/**
 * Parse pesan natural language jadi { task, deadline, reminderTime }
 *
 * Contoh input:
 * - "ingetin gw tugas A hari rabu"
 * - "reminder: meeting client besok pagi"
 * - "beli susu 3 hari lagi"
 * - "presentasi senin depan jam 2 siang"
 */
function parseReminder(text) {
  const original = text;
  text = text.toLowerCase().trim();

  // Ambil waktu spesifik (jam berapa)
  let jamOverride = null;
  const jamMatch = text.match(/jam\s*(\d{1,2})[:.]?(\d{2})?/);
  if (jamMatch) {
    let h = parseInt(jamMatch[1]);
    const m = jamMatch[2] ? parseInt(jamMatch[2]) : 0;

    // Konversi ke 24-jam jika ada konteks siang/sore/malam
    if (h <= 12) {
      if (text.includes('sore') || text.includes('malam')) {
        h += 12;
      } else if (text.includes('siang') && h < 12) {
        h += 12;
      }
    }

    jamOverride = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Deteksi waktu default (pagi/siang/sore/malam)
  let waktuDefault = '09:00';
  for (const [kata, jam] of Object.entries(waktuMap)) {
    if (text.includes(kata)) {
      waktuDefault = jam;
      break;
    }
  }

  // Coba parse dengan chrono-node (support bahasa Inggris + beberapa Indonesia)
  let parsedDate = chrono.parseDate(text, { forwardDate: true });

  // Kalau chrono gagal, coba manual parse untuk bahasa Indonesia
  if (!parsedDate) {
    parsedDate = parseIndonesianDate(text);
  }

  // Jika tidak ada tanggal tapi ada jam, default ke besok
  if (!parsedDate && jamOverride) {
    const now = new Date();
    parsedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }

  // Set jam override atau default
  if (parsedDate) {
    if (jamOverride) {
      const [h, m] = jamOverride.split(':').map(Number);
      parsedDate.setHours(h, m, 0, 0);
    } else {
      const [h, m] = waktuDefault.split(':').map(Number);
      parsedDate.setHours(h, m, 0, 0);
    }
  }

  // Ekstrak task name — hapus kata-kata yang bukan task
  let task = extractTaskName(text);

  // Reminder time: 1 jam sebelum deadline (atau 1 hari sebelum untuk deadline pagi)
  let reminderTime = null;
  if (parsedDate) {
    reminderTime = new Date(parsedDate);
    if (parsedDate.getHours() <= 10) {
      // Deadline pagi → reminder H-1 jam 8 malam
      reminderTime.setDate(reminderTime.getDate() - 1);
      reminderTime.setHours(20, 0, 0, 0);
    } else {
      // Deadline siang/sore → reminder 1 jam sebelum
      reminderTime.setHours(reminderTime.getHours() - 1);
    }
  }

  return {
    task: task || original.trim(),
    deadline: parsedDate,
    reminderTime,
    raw: original,
  };
}

/**
 * Parse tanggal bahasa Indonesia manual
 */
function parseIndonesianDate(text) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // "hari X" → cari hari berikutnya
  for (const [hari, dayNum] of Object.entries(hariMap)) {
    if (text.includes(`hari ${hari}`) || text.includes(hari)) {
      const target = new Date(today);
      const currentDay = target.getDay();
      let daysUntil = dayNum - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // Kalau hari ini, ambil minggu depan
      target.setDate(target.getDate() + daysUntil);
      return target;
    }
  }

  // "besok"
  if (text.includes('besok')) {
    const target = new Date(today);
    target.setDate(target.getDate() + 1);
    return target;
  }

  // "lusa"
  if (text.includes('lusa')) {
    const target = new Date(today);
    target.setDate(target.getDate() + 2);
    return target;
  }

  // "X hari lagi"
  const hariMatch = text.match(/(\d+)\s*hari\s*lagi/);
  if (hariMatch) {
    const target = new Date(today);
    target.setDate(target.getDate() + parseInt(hariMatch[1]));
    return target;
  }

  // "X minggu lagi"
  const mingguMatch = text.match(/(\d+)\s*minggu\s*lagi/);
  if (mingguMatch) {
    const target = new Date(today);
    target.setDate(target.getDate() + parseInt(mingguMatch[1]) * 7);
    return target;
  }

  // "hari ini"
  if (text.includes('hari ini')) {
    return today;
  }

  // "sekarang"
  if (text.includes('sekarang')) {
    return now;
  }

  return null;
}

/**
 * Ekstrak nama task dari pesan, buang kata-kata perintah
 */
function extractTaskName(text) {
  // Buang kata-kata perintah
  const stopWords = [
    'ingetin', 'ingatkan', 'reminder', 'remind', 'tolong',
    'gw', 'gue', 'saya', 'aku', 'ku',
    'tentang', 'buat', 'untuk',
    'di', 'pada', 'hari', 'tanggal',
    'besok', 'lusa', 'sekarang', 'hari ini',
    'pagi', 'siang', 'sore', 'malam', 'subuh',
    'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu',
    'jam', 'depan', 'lagi',
  ];

  // Buang pattern waktu
  let cleaned = text
    .replace(/jam\s*\d{1,2}[:.]?\d{0,2}/g, '')
    .replace(/\d+\s*hari\s*lagi/g, '')
    .replace(/\d+\s*minggu\s*lagi/g, '');

  // Buang stop words
  for (const word of stopWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  // Bersihkan spasi berlebih
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Kapitalisasi huruf pertama
  if (cleaned) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

/**
 * Format tanggal ke string Indonesia
 */
function formatDate(date) {
  if (!date) return 'Tidak diketahui';

  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const bulan = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const dayName = hari[date.getDay()];
  const day = date.getDate();
  const month = bulan[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${dayName}, ${day} ${month} ${year} jam ${hours}:${minutes}`;
}

module.exports = { parseReminder, formatDate };
