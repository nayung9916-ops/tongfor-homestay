const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve DB path (supports both data/database.json and root database.json)
let DATA_FILE = path.join(__dirname, 'data', 'database.json');
if (!fs.existsSync(DATA_FILE)) {
  const rootDb = path.join(__dirname, 'database.json');
  if (fs.existsSync(rootDb)) {
    DATA_FILE = rootDb;
  } else {
    // If data folder doesn't exist, create it or use root
    try {
      if (!fs.existsSync(path.join(__dirname, 'data'))) {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
      }
    } catch (e) {
      DATA_FILE = rootDb;
    }
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Default database template
const DEFAULT_DB = {
  property_name: "โฮมสเตย์ ตองฟอร์",
  rooms: [
    {
      id: "101",
      name: "ห้อง 101",
      type: "ห้องมาตรฐาน (Standard)",
      price: 800,
      agoda_ical_url: "https://portal.agoda.com/en-us/api/ari/icalendar?key=G2Eb%2fjbsh3vaCQaQ%2foikbw%2fxCfDtGot2",
      last_synced: null
    },
    {
      id: "102",
      name: "ห้อง 102",
      type: "ห้องดีลักซ์ (Deluxe)",
      price: 1000,
      agoda_ical_url: "",
      last_synced: null
    },
    {
      id: "103",
      name: "ห้อง 103",
      type: "ห้องครอบครัว (Family)",
      price: 1500,
      agoda_ical_url: "",
      last_synced: null
    }
  ],
  bookings: [
    {
      id: "bk-demo-1",
      room_id: "102",
      guest_name: "คุณสมชาย (ตัวอย่าง)",
      phone: "081-234-5678",
      check_in: "2026-09-15",
      check_out: "2026-09-17",
      source: "facebook",
      price: 2000,
      paid_status: "paid",
      notes: "จองผ่านเพจ Facebook โอนมัดจำเรียบร้อย",
      created_at: "2026-09-12T15:00:00Z"
    }
  ],
  agoda_events: []
};

// Helper: Read DB
function getDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      if (content.trim()) return JSON.parse(content);
    }
  } catch (err) {
    console.error("Read DB error:", err.message);
  }
  saveDb(DEFAULT_DB);
  return DEFAULT_DB;
}

// Helper: Save DB
function saveDb(db) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("Save DB error:", err.message);
  }
}

// Helper: Sync Agoda iCal
async function syncAgodaRoom(roomId, url) {
  if (!url) return [];
  try {
    const res = await fetch(url);
    const content = await res.text();
    const events = [];
    
    const lines = content.split(/\r?\n/);
    let inEvent = false;
    let curStart = '';
    let curEnd = '';
    let curUid = '';
    let curSummary = 'Agoda Booking';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'BEGIN:VEVENT') {
        inEvent = true;
        curStart = '';
        curEnd = '';
        curUid = Math.random().toString(36).substring(2);
        curSummary = 'Agoda Booking';
      } else if (trimmed === 'END:VEVENT') {
        if (inEvent && curStart && curEnd) {
          events.push({
            id: `agoda-${curUid}`,
            room_id: String(roomId),
            uid: curUid,
            check_in: curStart,
            check_out: curEnd,
            summary: curSummary,
            source: 'agoda',
            guest_name: 'Agoda Guest',
            phone: '-',
            price: 0,
            paid_status: 'paid'
          });
        }
        inEvent = false;
      } else if (inEvent) {
        if (trimmed.startsWith('DTSTART')) {
          const val = trimmed.split(':')[1]?.trim() || '';
          if (val.length >= 8) {
            curStart = `${val.substring(0, 4)}-${val.substring(4, 6)}-${val.substring(6, 8)}`;
          }
        } else if (trimmed.startsWith('DTEND')) {
          const val = trimmed.split(':')[1]?.trim() || '';
          if (val.length >= 8) {
            curEnd = `${val.substring(0, 4)}-${val.substring(4, 6)}-${val.substring(6, 8)}`;
          }
        } else if (trimmed.startsWith('UID:')) {
          curUid = trimmed.substring(4).trim();
        } else if (trimmed.startsWith('SUMMARY')) {
          curSummary = trimmed.split(':')[1]?.trim() || 'Agoda Booking';
        }
      }
    }
    return events;
  } catch (err) {
    console.error(`[Agoda Sync] Error room ${roomId}:`, err.message);
    return [];
  }
}

// Generate Export iCal (.ics)
function generateIcal(roomId, db) {
  const room = db.rooms.find(r => String(r.id) === String(roomId));
  const roomName = room ? room.name : `Room ${roomId}`;
  const manualBookings = (db.bookings || []).filter(b => String(b.room_id) === String(roomId) && b.source !== 'agoda');
  const nowStr = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ics = "BEGIN:VCALENDAR\r\n";
  ics += "VERSION:2.0\r\n";
  ics += "PRODID:-//Tongfor Homestay//PMS 1.0//EN\r\n";
  ics += "CALSCALE:GREGORIAN\r\n";
  ics += "METHOD:PUBLISH\r\n";
  ics += `X-WR-CALNAME:โฮมสเตย์ ตองฟอร์ - ${roomName}\r\n`;

  for (const b of manualBookings) {
    const dtStart = b.check_in.replace(/-/g, '');
    const dtEnd = b.check_out.replace(/-/g, '');
    const uid = b.id || Math.random().toString(36).substring(2);

    ics += "BEGIN:VEVENT\r\n";
    ics += `UID:booking-${uid}@tongfor\r\n`;
    ics += `DTSTAMP:${nowStr}\r\n`;
    ics += `DTSTART;VALUE=DATE:${dtStart}\r\n`;
    ics += `DTEND;VALUE=DATE:${dtEnd}\r\n`;
    ics += `SUMMARY:จอง (${b.source}) - ${b.guest_name}\r\n`;
    ics += `DESCRIPTION:โทร: ${b.phone || '-'}\r\n`;
    ics += "STATUS:CONFIRMED\r\n";
    ics += "END:VEVENT\r\n";
  }

  ics += "END:VCALENDAR\r\n";
  return ics;
}

// Route for Homepage: checks both public/index.html and ./index.html
app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'index.html');
  const p2 = path.join(__dirname, 'index.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  res.status(200).send(`
    <div style="font-family: sans-serif; text-align: center; padding: 50px;">
      <h2>🏡 โฮมสเตย์ ตองฟอร์</h2>
      <p style="color: #666;">กำลังเชื่อมต่อระบบ กรุณาตรวจสอบว่ามีไฟล์ <b>index.html</b> อยู่บน GitHub หรือไม่</p>
    </div>
  `);
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json(getDb());
});

app.post('/api/sync', async (req, res) => {
  const db = getDb();
  let allEvents = [];
  for (const r of db.rooms) {
    if (r.agoda_ical_url) {
      const evs = await syncAgodaRoom(r.id, r.agoda_ical_url);
      allEvents = allEvents.concat(evs);
      r.last_synced = new Date().toISOString().replace('T', ' ').substring(0, 19);
    }
  }
  db.agoda_events = allEvents;
  saveDb(db);
  res.json({ success: true, count: allEvents.length, db });
});

app.post('/api/bookings', (req, res) => {
  const db = getDb();
  const booking = {
    id: `bk-${Date.now()}`,
    created_at: new Date().toISOString(),
    ...req.body
  };
  if (!db.bookings) db.bookings = [];
  db.bookings.push(booking);
  saveDb(db);
  res.json({ success: true, booking });
});

app.delete('/api/bookings', (req, res) => {
  const id = req.query.id || req.body?.id;
  const db = getDb();
  db.bookings = (db.bookings || []).filter(b => String(b.id) !== String(id));
  saveDb(db);
  res.json({ success: true });
});

app.post('/api/settings', async (req, res) => {
  const db = getDb();
  if (req.body.rooms) db.rooms = req.body.rooms;
  if (req.body.property_name) db.property_name = req.body.property_name;
  saveDb(db);
  res.json({ success: true });
});

app.get('/api/ical/:roomId.ics', (req, res) => {
  const db = getDb();
  const ics = generateIcal(req.params.roomId, db);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.roomId}.ics"`);
  res.send(ics);
});

// Auto-sync on startup
setTimeout(async () => {
  try {
    const db = getDb();
    let allEvents = [];
    for (const r of db.rooms) {
      if (r.agoda_ical_url) {
        const evs = await syncAgodaRoom(r.id, r.agoda_ical_url);
        allEvents = allEvents.concat(evs);
        r.last_synced = new Date().toISOString().replace('T', ' ').substring(0, 19);
      }
    }
    db.agoda_events = allEvents;
    saveDb(db);
  } catch (e) {}
}, 2000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
