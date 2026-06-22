const chrono = require('chrono-node');

// ==================== Mappings ====================

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
  'dini hari': '03:00',
};

// Kata-kata yang menandakan urgency
const urgentKeywords = [
  'urgent', 'segera', 'penting', 'penting banget', 'harus',
  'deadline', 'terakhir', 'sesegera', 'darurat', 'mepet',
  'kritis', 'wajib', 'gak bisa ditunda', 'tidak bisa ditunda',
];

// Kata-kata untuk kategori
const categoryPatterns = {
  kuliah: ['kuliah', 'kampus', 'tugas', 'skripsi', 'ujian', 'praktikum', 'makalah', 'seminar', 'sidang', 'kp', 'magang', 'lab', 'matkul', 'mata kuliah', 'dosen', 'asisten'],
  kerja: ['kerja', 'kantor', 'meeting', 'rapat', 'presentasi', 'client', 'proyek', 'deadline', 'laporan', 'seminar', 'workshop', 'training'],
  belanja: ['beli', 'belanja', 'belanja', 'beliin', 'beliin', 'toko', 'mall', 'pasar', 'grocery'],
  kesehatan: ['obat', 'dokter', 'rumah sakit', 'rs', 'checkup', 'kontrol', 'vaksin', 'olahraga', 'gym', 'senam'],
  pribadi: ['jalan', 'nongkrong', 'ketemu', 'kumpul', 'acara', 'undangan', 'nikahan', 'sunatan', 'ulang tahun', 'wisuda'],
  keuangan: ['bayar', 'tagihan', 'cicilan', 'listrik', 'air', 'internet', 'pulsa', 'token', 'transfer', 'setor'],
};

// Stop words untuk task extraction
const stopWords = [
  'ingetin', 'ingatkan', 'reminder', 'remind', 'tolong',
  'gw', 'gue', 'saya', 'aku', 'ku', 'dong', 'ya', 'nih',
  'tentang', 'buat', 'untuk', 'agar', 'biar',
  'di', 'pada', 'hari', 'tanggal', 'tgl',
  'besok', 'lusa', 'sekarang', 'hari ini', 'nanti',
  'pagi', 'siang', 'sore', 'malam', 'subuh',
  'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu',
  'jam', 'depan', 'lagi', 'yang', 'dan', 'atau',
];

// ==================== Helper Functions ====================

/**
 * Deteksi urgency dari text
 */
function detectUrgency(text) {
  const lower = text.toLowerCase();

  // Cek keyword urgency
  for (const keyword of urgentKeywords) {
    if (lower.includes(keyword)) {
      return 'urgent';
    }
  }

  // Cek deadline yang sangat dekat (akan dihitung nanti di parseReminder)
  return 'normal';
}

/**
 * Deteksi kategori dari text
 */
function detectCategory(text) {
  const lower = text.toLowerCase();

  for (const [category, keywords] of Object.entries(categoryPatterns)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return category;
      }
    }
  }

  return 'general';
}

/**
 * Ekstrak nama task dari pesan dengan konteks lebih baik
 */
function extractTaskName(text) {
  let cleaned = text.toLowerCase().trim();

  // Buang pattern waktu
  cleaned = cleaned
    .replace(/jam\s*\d{1,2}[:.]?\d{0,2}/g, '')
    .replace(/\d+\s*hari\s*lagi/g, '')
    .replace(/\d+\s*minggu\s*lagi/g, '')
    .replace(/\d+\s*bulan\s*lagi/g, '')
    .replace(/hari\s+(senin|selasa|rabu|kamis|jumat|sabtu|minggu|ahad)/g, '')
    .replace(/(besok|lusa|sekarang|hari ini|nanti)/g, '')
    .replace(/(pagi|siang|sore|malam|subuh|dini hari)/g, '');

  // Buang kata urgency (bukan bagian dari task)
  for (const keyword of urgentKeywords) {
    cleaned = cleaned.replace(new RegExp(keyword, 'gi'), '');
  }

  // Buang stop words
  for (const word of stopWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  // Bersihkan spasi berlebih dan trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Kapitalisasi huruf pertama setiap kata
  if (cleaned) {
    cleaned = cleaned
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return cleaned;
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

  // "hari ini"
  if (text.includes('hari ini')) {
    return today;
  }

  // "nanti" → hari ini juga
  if (text.includes('nanti') || text.includes('sebentar lagi')) {
    return today;
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

  // "X bulan lagi"
  const bulanMatch = text.match(/(\d+)\s*bulan\s*lagi/);
  if (bulanMatch) {
    const target = new Date(today);
    target.setMonth(target.getMonth() + parseInt(bulanMatch[1]));
    return target;
  }

  // "depan" → minggu depan
  if (text.includes('depan')) {
    const target = new Date(today);
    target.setDate(target.getDate() + 7);
    return target;
  }

  // "sekarang"
  if (text.includes('sekarang')) {
    return now;
  }

  return null;
}

/**
 * Generate smart response berdasarkan konteks
 */
function generateSmartResponse(task, deadline, category, urgency) {
  const now = new Date();
  const diff = deadline - now;
  const hoursLeft = Math.floor(diff / (1000 * 60 * 60));
  const daysLeft = Math.floor(hoursLeft / 24);

  let urgencyEmoji = '';
  let urgencyNote = '';

  // Update urgency berdasarkan waktu
  if (daysLeft <= 0 && hoursLeft <= 0) {
    urgency = 'overdue';
    urgencyEmoji = '🚨';
    urgencyNote = '⚠️ *Waktu sudah lewat!*';
  } else if (daysLeft <= 1) {
    urgency = 'urgent';
    urgencyEmoji = '🔴';
    urgencyNote = '⏰ *Deadline besok!*';
  } else if (daysLeft <= 3) {
    urgencyEmoji = '🟡';
    urgencyNote = `📅 ${daysLeft} hari lagi`;
  } else {
    urgencyEmoji = '🟢';
    urgencyNote = `📅 ${daysLeft} hari lagi`;
  }

  // Category emoji
  const categoryEmojis = {
    kuliah: '📚',
    kerja: '💼',
    belanja: '🛒',
    kesehatan: '🏥',
    pribadi: '🎉',
    keuangan: '💰',
    general: '📋',
  };

  const categoryEmoji = categoryEmojis[category] || '📋';

  return { urgencyEmoji, urgencyNote, categoryEmoji };
}

// ==================== Main Parser ====================

/**
 * Parse pesan natural language jadi { task, deadline, reminderTime, category, urgency }
 *
 * Contoh input:
 * - "ingetin gw tugas A hari rabu"
 * - - "reminder: meeting client besok pagi"
 * - "beli susu 3 hari lagi"
 * - "presentasi senin depan jam 2 siang"
 */
function parseReminder(text) {
  const original = text;
  text = text.toLowerCase().trim();

  // Deteksi urgency
  let urgency = detectUrgency(text);

  // Deteksi kategori
  const category = detectCategory(text);

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

  // Update urgency berdasarkan deadline
  if (parsedDate) {
    const now = new Date();
    const diff = parsedDate - now;
    const hoursLeft = diff / (1000 * 60 * 60);

    if (hoursLeft <= 0) {
      urgency = 'overdue';
    } else if (hoursLeft <= 24) {
      urgency = 'urgent';
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
    category,
    urgency,
    raw: original,
  };
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

/**
 * Generate hint untuk user jika input ambigu
 */
function generateHint(text) {
  const lower = text.toLowerCase();
  const hints = [];

  // Cek apakah ada waktu
  const hasTime = lower.match(/jam\s*\d/) || lower.includes('pagi') || lower.includes('siang') ||
    lower.includes('sore') || lower.includes('malam') || lower.includes('besok') ||
    lower.includes('lusa') || lower.match(/\d+\s*hari/);

  if (!hasTime) {
    hints.push('⏰ Kapan deadline-nya? Tambahkan waktu, contoh: "besok jam 3 sore"');
  }

  // Cek apakah ada task yang jelas
  const task = extractTaskName(text);
  if (!task || task.length < 3) {
    hints.push('📋 Apa task-nya? Sebutkan dengan jelas, contoh: "Tugas A" atau "Meeting client"');
  }

  return hints;
}

module.exports = { parseReminder, formatDate, generateHint, detectCategory, detectUrgency };
