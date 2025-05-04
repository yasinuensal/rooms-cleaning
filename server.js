const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// 🔑 Trage hier deinen echten Smoobu API-Key ein
const API_KEY = 'MjZxE_RYZZr5uMlBJmk1R1TqhAKiW4oW';

app.use(express.static('public'));

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

app.get('/api/checkins-checkouts', async (req, res) => {
  const datum = req.query.datum || heutigesDatumISO();
  console.log(`📅 Abfrage für Datum: ${datum}`);

  try {
    const url = `https://login.smoobu.com/api/reservations?from=${datum}&to=${datum}&pageSize=1000`;
    const response = await axios.get(url, {
      headers: { 'Api-Key': API_KEY }
    });

    const daten = response.data;
    const buchungen = Array.isArray(daten) ? daten : daten.bookings || [];
    console.log(`📦 Buchungen erhalten: ${buchungen.length}`);

    const checkins = buchungen
      .filter(r => istGueltigeBuchung(r, datum, 'arrival'))
      .map(r => ({
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
        type: 'checkout',
        guestName: r['guest-name'],
        apartmentName: r.apartment?.name || 'Unbekannt',
        checkTime: r['check-out'] || null,
        guests: (r.adults || 0) + (r.children || 0)
      }));

    console.log(`✅ Check-ins: ${checkins.length} | Check-outs: ${checkouts.length}`);
    res.json({ checkins, checkouts });

  } catch (error) {
    console.error('❌ Fehler beim Abrufen:', error.response?.status || '', error.message);
    res.status(500).json({ error: 'Fehler beim Abrufen der Buchungsdaten' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server läuft unter http://localhost:${PORT}`);
});
