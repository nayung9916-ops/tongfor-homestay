const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve DB path
let DATA_FILE = path.join(__dirname, 'data', 'database.json');
if (!fs.existsSync(DATA_FILE)) {
  const rootDb = path.join(__dirname, 'database.json');
  if (fs.existsSync(rootDb)) {
    DATA_FILE = rootDb;
  } else {
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

const DEFAULT_DB = {
  property_name: "โฮมสเตย์ ตองฟอร์",
  rooms: [
    {
      id: "101",
      name: "ห้อง 101",
      type: "ห้องมาตรฐาน (Standard)",
      price: 800,
      agoda_ical_url: "https://portal.agoda.com/en-us/api/ari/icalendar?key=G2Eb%2fjbsh3vaCQaQ%2foikbw%2fxCfDtGot2",
      google_ical_url: "https://calendar.google.com/calendar/ical/50cc724142402ddb0d0d5f336bc76ae41eb60a6f397596d552f7cf226cbf91f1%40group.calendar.google.com/public/basic.ics",
      google_script_url: "https://script.google.com/macros/s/AKfycbwvJ4lsqRDPHpFWIvvZVkTg5pRUxFBjwj7xu4m8x1OMEUkLvxolskHnfd0jHkOD7qVm/exec",
      last_synced: null
    },
    {
      id: "102",
      name: "ห้อง 102",
      type: "ห้องดีลักซ์ (Deluxe)",
      price: 1000,
      agoda_ical_url: "",
      google_ical_url: "",
      google_script_url: "",
      last_synced: null
    },
    {
      id: "103",
      name: "ห้อง 103",
      type: "ห้องครอบครัว (Family)",
      price: 1500,
      agoda_ical_url: "",
      google_ical_url: "",
      google_script_url: "",
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

function getDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      if (content.trim()) {
        const parsed = JSON.parse(content);
        // Ensure room 101 has google script & ical url
        const r101 = (parsed.rooms || []).find(r => String(r.id) === "101");
        if (r101) {
          if (!r101.google_script_url) {
            r101.google_script_url = "https://script.google.com/macros/s/AKfycbwvJ4lsqRDPHpFWIvvZVkTg5pRUxFBjwj7xu4m8x1OMEUkLvxolskHnfd0jHkOD7qVm/exec";
          }
          if (!r101.google_ical_url) {
            r101.google_ical_url = "https://calendar.google.com/calendar/ical/50cc724142402ddb0d0d5f336bc76ae41eb60a6f397596d552f7cf226cbf91f1%40group.calendar.google.com/public/basic.ics";
          }
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error("Read DB error:", err.message);
  }
  saveDb(DEFAULT_DB);
  return DEFAULT_DB;
}

function saveDb(db) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("Save DB error:", err.message);
  }
}

// Parse iCal helper (handles both Agoda and Google Calendar feeds)
async function parseIcalUrl(roomId, url, sourceName) {
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
    let curSummary = `${sourceName} Booking`;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'BEGIN:VEVENT') {
        inEvent = true;
        curStart = '';
        curEnd = '';
        curUid = Math.random().toString(36).substring(2);
        curSummary = `${sourceName} Booking`;
      } else if (trimmed === 'END:VEVENT') {
        if (inEvent && curStart && curEnd) {
          events.push({
            id: `${sourceName.toLowerCase()}-${curUid}`,
            room_id: String(roomId),
            uid: curUid,
            check_in: curStart,
            check_out: curEnd,
            summary: curSummary,
            source: sourceName.toLowerCase(),
            guest_name: `${sourceName} Guest`,
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
          curSummary = trimmed.split(':')[1]?.trim() || `${sourceName} Booking`;
        }
      }
    }
    return events;
  } catch (err) {
    console.error(`[${sourceName} Sync] Error room ${roomId}:`, err.message);
    return [];
  }
}

// Generate RFC 5545 iCal
function generateIcal(roomId, db) {
  const manualBookings = (db.bookings || []).filter(b => String(b.room_id) === String(roomId) && b.source !== 'agoda');
  const nowStr = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ics = "BEGIN:VCALENDAR\r\n";
  ics += "PRODID:-//Tongfor Homestay//EN\r\n";
  ics += "VERSION:2.0\r\n";
  ics += "CALSCALE:GREGORIAN\r\n";
  ics += "METHOD:PUBLISH\r\n";

  if (manualBookings.length === 0) {
    ics += "BEGIN:VEVENT\r\n";
    ics += `DTSTAMP:${nowStr}\r\n`;
    ics += `UID:init-${roomId}-2026@tongfor.com\r\n`;
    ics += `DTSTART;VALUE=DATE:20260101\r\n`;
    ics += `DTEND;VALUE=DATE:20260102\r\n`;
    ics += "SUMMARY:BOOKED\r\n";
    ics += "DESCRIPTION:BOOKED\r\n";
    ics += "CLASS:PUBLIC\r\n";
    ics += "STATUS:CONFIRMED\r\n";
    ics += "END:VEVENT\r\n";
  } else {
    for (const b of manualBookings) {
      const dtStart = b.check_in.replace(/-/g, '');
      const dtEnd = b.check_out.replace(/-/g, '');
      const uid = b.id || Math.random().toString(36).substring(2);

      ics += "BEGIN:VEVENT\r\n";
      ics += `DTSTAMP:${nowStr}\r\n`;
      ics += `UID:booking-${uid}@tongfor.com\r\n`;
      ics += `DTSTART;VALUE=DATE:${dtStart}\r\n`;
      ics += `DTEND;VALUE=DATE:${dtEnd}\r\n`;
      ics += "SUMMARY:BOOKED\r\n";
      ics += `DESCRIPTION:Guest: ${b.guest_name}\r\n`;
      ics += "CLASS:PUBLIC\r\n";
      ics += "STATUS:CONFIRMED\r\n";
      ics += "END:VEVENT\r\n";
    }
  }

  ics += "END:VCALENDAR\r\n";
  return ics;
}

// Homepage
app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'index.html');
  const p2 = path.join(__dirname, 'index.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  res.status(200).send('<h1>โฮมสเตย์ ตองฟอร์</h1>');
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
      const agodaEvs = await parseIcalUrl(r.id, r.agoda_ical_url, 'Agoda');
      allEvents = allEvents.concat(agodaEvs);
    }
    r.last_synced = new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
  db.agoda_events = allEvents;
  saveDb(db);
  res.json({ success: true, count: allEvents.length, db });
});

// Create booking: Saves locally AND automatically pushes to Google Calendar!
app.post('/api/bookings', async (req, res) => {
  const db = getDb();
  const booking = {
    id: `bk-${Date.now()}`,
    created_at: new Date().toISOString(),
    ...req.body
  };
  if (!db.bookings) db.bookings = [];
  db.bookings.push(booking);
  saveDb(db);

  // Auto-push to Google Calendar via Webhook
  const room = (db.rooms || []).find(r => String(r.id) === String(booking.room_id));
  const webhookUrl = room?.google_script_url || (String(booking.room_id) === '101' ? "https://script.google.com/macros/s/AKfycbwvJ4lsqRDPHpFWIvvZVkTg5pRUxFBjwj7xu4m8x1OMEUkLvxolskHnfd0jHkOD7qVm/exec" : null);
  
  if (webhookUrl) {
    try {
      console.log(`[Google Sync] Pushing booking for room ${booking.room_id} to Google Apps Script...`);
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          ...booking
        })
      }).then(r => console.log(`[Google Sync] Pushed to Google Calendar!`))
        .catch(err => console.error('[Google Sync Error]', err.message));
    } catch (e) {
      console.error('[Google Sync Exception]', e.message);
    }
  }

  res.json({ success: true, booking, googleSynced: !!webhookUrl });
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

// Handler for iCal feed
function handleIcalRequest(req, res, roomId) {
  console.log(`[iCal Request] Room: ${roomId} from UA: ${req.headers['user-agent']}`);
  const db = getDb();
  const ics = generateIcal(roomId, db);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${roomId}.ics"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(ics);
}

app.get('/api/ical/:roomId.ics', (req, res) => {
  handleIcalRequest(req, res, req.params.roomId);
});

app.get('/:roomId.ics', (req, res) => {
  handleIcalRequest(req, res, req.params.roomId);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
