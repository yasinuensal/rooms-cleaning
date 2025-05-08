const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = 3000;

// === Upload-Ordner für Render ===
const uploadPath = path.resolve('/uploads'); // Render mountet das Volume direkt hier


// === Multer-Konfiguration ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// === Statische Bereitstellung der Uploads ===
app.use('/uploads', express.static(uploadPath));

app.use(express.static('public'));
app.use(express.json());

// === Smoobu API-Key ===
const API_KEY = 'MjZxE_RYZZr5uMlBJmk1R1TqhAKiW4oW';

// === PostgreSQL-Verbindung ===
const db = new Pool({
  host: 'i8d7.your-database.de',
  port: 5432,
  user: 'roomsz_1',
  password: 'BQm8K3HYF6wCNchp',
  database: 'roomsz_db1'
});

// === Hilfsfunktionen ===
function heutigesDatumISO() {
  return new Date().toISOString().split('T')[0];
}

function istGueltigeBuchung(r, datum, feld) {
  if (!r[feld]) return false;
  const vergleichsDatum = new Date(r[feld]).toISOString().split('T')[0];
  return (
    vergleichsDatum === datum &&
    !r['is-blocked-booking'] &&
    r['guest-name'] &&
    r.status !== 'cancelled' &&
    !(r.type && r.type.toLowerCase().includes('cancellation'))
  );
}

// === Login ===
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Falsches Passwort' });

    res.json({ success: true, role: user.role });
  } catch (err) {
    console.error('Login-Fehler:', err);
    res.status(500).json({ error: 'Serverfehler bei Login' });
  }
});

// === Checkins & Checkouts ===
app.get('/api/checkins-checkouts', async (req, res) => {
  const datum = req.query.datum || heutigesDatumISO();
  console.log(`📅 Abfrage für Datum: ${datum}`);

  try {
    const url = `https://login.smoobu.com/api/reservations?from=${datum}&to=${datum}&pageSize=1000`;
    const response = await axios.get(url, { headers: { 'Api-Key': API_KEY } });
    const daten = response.data;
    const buchungen = Array.isArray(daten) ? daten : daten.bookings || [];

    const checkins = buchungen
      .filter(r => istGueltigeBuchung(r, datum, 'arrival'))
      .map(r => ({
        booking_id: r.id,
        type: 'checkin',
        guestName: r['guest-name'],
        apartmentName: r.apartment?.name || 'Unbekannt',
        checkTime: r['check-in'] || null,
        babybed: (r['assistant-notice'] || '').toLowerCase().includes('babybett'),
        guests: (r.adults || 0) + (r.children || 0)
      }));

    const checkouts = buchungen
      .filter(r => istGueltigeBuchung(r, datum, 'departure'))
      .map(r => ({
        booking_id: r.id,
        type: 'checkout',
        guestName: r['guest-name'],
        apartmentName: r.apartment?.name || 'Unbekannt',
        checkTime: r['check-out'] || null,
        guests: (r.adults || 0) + (r.children || 0)
      }));

    res.json({ checkins, checkouts });
  } catch (error) {
    console.error('❌ Fehler beim Abrufen:', error.response?.status || '', error.message);
    res.status(500).json({ error: 'Fehler beim Abrufen der Buchungsdaten' });
  }
});

// === Notizen speichern ===
app.post('/api/notes', async (req, res) => {
  const { booking_id, type, text, photo_url } = req.body;

  if (!booking_id || !type || !text) {
    return res.status(400).json({ error: 'Fehlende Felder' });
  }

  try {
    await db.query(
      'INSERT INTO booking_notes (booking_id, type, text, photo_url) VALUES ($1, $2, $3, $4)',
      [booking_id, type, text, photo_url || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Fehler beim Speichern der Notiz:', err);
    res.status(500).json({ error: 'Fehler beim Speichern' });
  }
});

// === Notizen abrufen ===
app.get('/api/notes/:booking_id', async (req, res) => {
  const { booking_id } = req.params;

  try {
    const result = await db.query(
      'SELECT id, type, text, photo_url FROM booking_notes WHERE booking_id = $1 ORDER BY id DESC',
      [booking_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fehler beim Abrufen der Notizen:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen' });
  }
});


// === Notiz löschen ===
app.delete('/api/notes/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM booking_notes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Fehler beim Löschen:', err);
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// === Status speichern ===
app.post('/api/status', async (req, res) => {
  const { booking_id, status } = req.body;

  if (!booking_id || !status) {
    return res.status(400).json({ error: 'Fehlende Felder' });
  }

  try {
    await db.query(`
      INSERT INTO booking_status (booking_id, status)
      VALUES ($1, $2)
      ON CONFLICT (booking_id)
      DO UPDATE SET status = EXCLUDED.status
    `, [booking_id, status]);

    res.json({ success: true });
  } catch (err) {
    console.error('Fehler beim Speichern des Status:', err);
    res.status(500).json({ error: 'Fehler beim Speichern des Status' });
  }
});

app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) {
    console.error('❌ Keine Datei im Request gefunden');
    return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  }

  console.log('✅ Datei gespeichert:', req.file.path);
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});


// === Status abrufen ===
app.get('/api/status/:booking_id', async (req, res) => {
  const { booking_id } = req.params;

  try {
    const result = await db.query(
      'SELECT status FROM booking_status WHERE booking_id = $1',
      [booking_id]
    );
    res.json(result.rows[0] || { status: null });
  } catch (err) {
    console.error('Fehler beim Abrufen des Status:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen' });
  }
});

// === Serverstart ===
app.listen(PORT, () => {
  console.log(`🚀 Server läuft unter http://localhost:${PORT}`);
});
