const chrono = require('chrono-node');

// ==================== Timezone Helper ====================
const TIMEZONE = 'Asia/Jakarta';

function getNow() {
  return new Date();
}

function getToday() {
  const now = new Date();
  // Menggunakan waktu lokal server (seharusnya sudah Asia/Jakarta)
  // Return midnight hari ini
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getDayName(date) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[date.getDay()];
}

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

// Kata-kata untuk prioritas rendah
const lowPriorityKeywords = [
  'nanti aja', 'santai', 'gak buru-buru', 'low priority',
  'kalau sempat', 'kapan aja', 'gak penting',
];

// Kata-kata untuk kategori
const categoryPatterns = {
  kuliah: ['kuliah', 'kampus', 'tugas', 'skripsi', 'ujian', 'praktikum', 'makalah', 'seminar', 'sidang', 'kp', 'magang', 'lab', 'matkul', 'mata kuliah', 'dosen', 'asisten'],
  kerja: ['kerja', 'kantor', 'meeting', 'rapat', 'presentasi', 'client', 'proyek', 'deadline', 'laporan', 'seminar', 'workshop', 'training'],
  belanja: ['beli', 'belanja', 'belanja', 'beliin', 'beliin', 'toko', 'mall', 'pasar', 'grocery'],
  kesehatan: ['obat', 'dokter', 'rumah sakit', 'rs', 'checkup', 'kontrol', 'vaksin', 'olahraga', 'gym', 'senam', 'mandi', 'bangun'],
  pribadi: ['jalan', 'nongkrong', 'ketemu', 'kumpul', 'acara', 'undangan', 'nikahan', 'sunatan', 'ulang tahun', 'wisuda'],
  keuangan: ['bayar', 'tagihan', 'cicilan', 'listrik', 'air', 'internet', 'pulsa', 'token', 'transfer', 'setor'],
};

// Kata-kata untuk recurring
const recurringPatterns = {
  daily: ['setiap hari', 'tiap hari', 'harian', 'setiap pagi', 'setiap malam', 'setiap siang'],
  weekly: ['setiap minggu', 'tiap minggu', 'mingguan', 'setiap senin', 'setiap selasa', 'setiap rabu', 'setiap kamis', 'setiap jumat', 'setiap sabtu', 'setiap minggu'],
  monthly: ['setiap bulan', 'tiap bulan', 'bulanan', 'setiap tanggal'],
};

// Stop words untuk task extraction
const stopWords = [
  'ingetin', 'ingatkan', 'reminder', 'remind', 'tolong',
  'gw', 'gue', 'saya', 'aku', 'ku', 'dong', 'ya', 'nih',
  'kamu', 'kau', 'lu', 'loe',
  'tentang', 'buat', 'untuk', 'agar', 'biar',
  'di', 'pada', 'pda', 'hari', 'tanggal', 'tgl',
  'besok', 'lusa', 'sekarang', 'hari ini', 'nanti',
  'pagi', 'siang', 'sore', 'malam', 'subuh',
  'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu',
  'jam', 'depan', 'lagi', 'yang', 'dan', 'atau',
  'setiap', 'tiap', 'harian', 'mingguan', 'bulanan',
  'kana', 'kna',
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

  // Cek keyword prioritas rendah
  for (const keyword of lowPriorityKeywords) {
    if (lower.includes(keyword)) {
      return 'low';
    }
  }

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
 * Deteksi recurring pattern dari text
 */
function detectRecurring(text) {
  const lower = text.toLowerCase();

  // Cek pattern harian
  for (const pattern of recurringPatterns.daily) {
    if (lower.includes(pattern)) {
      return 'daily';
    }
  }

  // Cek pattern mingguan
  for (const pattern of recurringPatterns.weekly) {
    if (lower.includes(pattern)) {
      return 'weekly';
    }
  }

  // Cek pattern bulanan
  for (const pattern of recurringPatterns.monthly) {
    if (lower.includes(pattern)) {
      return 'monthly';
    }
  }

  return null;
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

  // Buang pattern "X menit/mnt sebelum"
  cleaned = cleaned.replace(/\d+\s*(menit|mnt|minute|min)\s*(sebelum|sblm|sebelumnya)/gi, '');

  // Buang kata "reminder" dan "ingetin"
  cleaned = cleaned.replace(/(reminder|ingetin|ingatkan|remind)/gi, '');

  // Buang kata urgency (bukan bagian dari task)
  for (const keyword of urgentKeywords) {
    cleaned = cleaned.replace(new RegExp(keyword, 'gi'), '');
  }

  // Buang kata recurring
  for (const patterns of Object.values(recurringPatterns)) {
    for (const pattern of patterns) {
      cleaned = cleaned.replace(new RegExp(pattern, 'gi'), '');
    }
  }

  // Buang stop words
  for (const word of stopWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  // Buang filler words yang sering muncul
  cleaned = cleaned.replace(/\b(itu|ya|dong|nih|deh|lah|sih|aja|doang)\b/gi, '');

  // Bersihkan koma, titik, dan spasi berlebih
  cleaned = cleaned.replace(/[,.\-;:!?]+/g, ' ');
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
  const today = getToday();
  const now = getNow();

  // "besok" → hari ini + 1 (PRIORITAS TERTINGGI)
  if (text.includes('besok') || text.includes('bsk')) {
    const target = new Date(today);
    target.setDate(target.getDate() + 1);

    // Cek apakah ada "hari X" yang disebut
    for (const [hari, dayNum] of Object.entries(hariMap)) {
      if (text.includes(`hari ${hari}`) || text.includes(hari)) {
        const tomorrowDay = target.getDay();
        if (tomorrowDay === dayNum) {
          return target;
        }
        return target;
      }
    }

    return target;
  }

  // "hari X" → cari hari berikutnya (HANYA jika tidak ada "besok")
  for (const [hari, dayNum] of Object.entries(hariMap)) {
    if (text.includes(`hari ${hari}`)) {
      const target = new Date(today);
      const currentDay = target.getDay();
      let daysUntil = dayNum - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      target.setDate(target.getDate() + daysUntil);
      return target;
    }
  }

  // "senin depan", "selasa besok", dll
  for (const [hari, dayNum] of Object.entries(hariMap)) {
    if (text.includes(`${hari} depan`) || text.includes(`${hari} besok`)) {
      const target = new Date(today);
      const currentDay = target.getDay();
      let daysUntil = dayNum - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      target.setDate(target.getDate() + daysUntil);
      return target;
    }
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
 * Parse pesan natural language jadi { task, deadline, reminderTime, category, urgency, recurring }
 */
function parseReminder(text) {
  const original = text;
  text = text.toLowerCase().trim();

  // Deteksi urgency
  let urgency = detectUrgency(text);

  // Deteksi kategori
  const category = detectCategory(text);

  // Deteksi recurring
  const recurring = detectRecurring(text);

  // Ambil waktu spesifik (jam berapa)
  let jamOverride = null;
  let reminderJamOverride = null;

  // Cek apakah ada "X menit sebelum" atau "X mnt sebelum"
  let reminderMinutesBefore = null;
  const menitSebelumMatch = text.match(/(\d+)\s*(menit|mnt|menit|minute|min)\s*(sebelum|sblm|sebelumnya)/i);
  if (menitSebelumMatch) {
    reminderMinutesBefore = parseInt(menitSebelumMatch[1]);
  }

  // Cek apakah ada "ingetin nya jam X" atau "reminder jam X"
  const reminderJamMatch = text.match(/ingetin\s*(nya)?\s*jam\s*(\d{1,2})[:.]?(\d{2})?/i) ||
                           text.match(/reminder\s*jam\s*(\d{1,2})[:.]?(\d{2})?/i);
  if (reminderJamMatch) {
    let h = parseInt(reminderJamMatch[2] || reminderJamMatch[1]);
    const m = reminderJamMatch[3] ? parseInt(reminderJamMatch[3]) : 0;

    // Konversi ke 24-jam
    if (h <= 12) {
      if (text.includes('sore') || text.includes('malam')) {
        h += 12;
      } else if (text.includes('pagi') || text.includes('subuh')) {
        // Tetap AM
      } else if (text.includes('siang') && h < 12) {
        h += 12;
      }
    }

    reminderJamOverride = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Ambil jam deadline
  const jamMatch = text.match(/jam\s*(\d{1,2})[:.]?(\d{2})?/g);
  if (jamMatch) {
    for (const match of jamMatch) {
      const nums = match.match(/(\d{1,2})[:.]?(\d{2})?/);
      if (nums) {
        let h = parseInt(nums[1]);
        const m = nums[2] ? parseInt(nums[2]) : 0;

        if (h <= 12) {
          if (text.includes('sore') || text.includes('malam')) {
            h += 12;
          } else if (text.includes('siang') && h < 12) {
            h += 12;
          }
        }

        const jamStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        if (jamStr !== reminderJamOverride) {
          jamOverride = jamStr;
          break;
        }
      }
    }

    if (!jamOverride && jamMatch.length > 0) {
      const nums = jamMatch[0].match(/(\d{1,2})[:.]?(\d{2})?/);
      if (nums) {
        let h = parseInt(nums[1]);
        const m = nums[2] ? parseInt(nums[2]) : 0;

        if (h <= 12) {
          if (text.includes('sore') || text.includes('malam')) {
            h += 12;
          } else if (text.includes('siang') && h < 12) {
            h += 12;
          }
        }

        jamOverride = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }
  }

  // Deteksi waktu default (pagi/siang/sore/malam)
  let waktuDefault = '09:00';
  for (const [kata, jam] of Object.entries(waktuMap)) {
    if (text.includes(kata)) {
      waktuDefault = jam;
      break;
    }
  }

  // Coba parse dengan chrono-node
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
    const now = getNow();
    const diff = parsedDate - now;
    const hoursLeft = diff / (1000 * 60 * 60);

    if (hoursLeft <= 0) {
      urgency = 'overdue';
    } else if (hoursLeft <= 24) {
      urgency = 'urgent';
    }
  }

  // Ekstrak task name
  let task = extractTaskName(text);

  // Reminder time
  let reminderTime = null;
  if (parsedDate) {
    const now = getNow();

    if (reminderMinutesBefore !== null) {
      // "X menit sebelum" → deadline minus X minutes
      reminderTime = new Date(parsedDate.getTime() - reminderMinutesBefore * 60 * 1000);
    } else if (reminderJamOverride) {
      reminderTime = new Date(parsedDate);
      const [rh, rm] = reminderJamOverride.split(':').map(Number);
      reminderTime.setHours(rh, rm, 0, 0);

      if (reminderTime >= parsedDate) {
        reminderTime.setDate(reminderTime.getDate() - 1);
      }
    } else {
      // Default: 1 jam sebelum deadline
      reminderTime = new Date(parsedDate.getTime() - 60 * 60 * 1000);
    }

    if (reminderTime <= now) {
      reminderTime = new Date(now.getTime() + 60 * 1000);
    }

    if (parsedDate <= now) {
      urgency = 'overdue';
    }
  }

  return {
    task: task || original.trim(),
    deadline: parsedDate,
    reminderTime,
    category,
    urgency,
    recurring,
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

  const hasTime = lower.match(/jam\s*\d/) || lower.includes('pagi') || lower.includes('siang') ||
    lower.includes('sore') || lower.includes('malam') || lower.includes('besok') ||
    lower.includes('lusa') || lower.match(/\d+\s*hari/);

  if (!hasTime) {
    hints.push('⏰ Kapan deadline-nya? Tambahkan waktu, contoh: "besok jam 3 sore"');
  }

  const task = extractTaskName(text);
  if (!task || task.length < 3) {
    hints.push('📋 Apa task-nya? Sebutkan dengan jelas, contoh: "Tugas A" atau "Meeting client"');
  }

  return hints;
}

module.exports = { parseReminder, formatDate, generateHint, detectCategory, detectUrgency, detectRecurring };
