const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'database.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Read DB
function getDb() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  return { property_name: "โฮมสเตย์ ตองฟอร์", rooms: [], bookings: [], agoda_events: [] };
}

// Helper: Save DB
function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
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
  const manualBookings = db.bookings.filter(b => String(b.room_id) === String(roomId) && b.source !== 'agoda');
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
  db.bookings.push(booking);
  saveDb(db);
  res.json({ success: true, booking });
});

app.delete('/api/bookings', (req, res) => {
  const id = req.query.id || req.body?.id;
  const db = getDb();
  db.bookings = db.bookings.filter(b => String(b.id) !== String(id));
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

// Periodic auto-sync every 10 minutes
setInterval(async () => {
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
    console.log(`[Auto-Sync] Synced ${allEvents.length} events from Agoda`);
  } catch (err) {
    console.error('[Auto-Sync] Error:', err.message);
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
