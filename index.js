const express = require('express');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- USER MANAGEMENT ENDPOINTS ---
app.get('/api/users', async (req, res) => {
  const { clubId, role } = req.query;
  try {
    let query = 'SELECT id, username, password, role, phone, email, club_id as clubId, assigned_court_ids as assignedCourtIds FROM users WHERE 1=1';
    const params = [];

    if (clubId) {
      query += ' AND club_id = ?';
      params.push(clubId);
    }
    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }

    const [users] = await db.execute(query, params);
    // Map assigned_court_ids from string to array
    const mappedUsers = users.map(u => ({
      ...u,
      assignedCourtIds: u.assignedCourtIds ? u.assignedCourtIds.split(',').map(Number) : []
    }));
    res.json(mappedUsers);
  } catch (error) {
    console.error('ERROR /api/users:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  const { username, password, role, phone, email, clubId, assignedCourtIds } = req.body;
  try {
    const assignedCourtsStr = assignedCourtIds ? assignedCourtIds.join(',') : null;
    const [result] = await db.execute(
      'INSERT INTO users (username, password, phone, email, role, club_id, assigned_court_ids) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        username, 
        password || '1234', 
        phone || null, 
        email || null,
        role, 
        clubId || null, 
        assignedCourtsStr
      ]
    );
    res.json({ id: result.insertId, success: true });
  } catch (error) {
    console.error('ERROR POST /api/users:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- AUTH ENDPOINTS ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const cleanUser = (username || '').trim();
  const cleanPass = (password || '').trim();
  
  console.log('Login attempt:', cleanUser);
  try {
    const [users] = await db.execute(
      'SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', 
      [cleanUser, cleanUser]
    );
    if (users.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });

    const user = users[0];
    if (cleanPass !== user.password) return res.status(401).json({ error: 'Contraseña incorrecta' });

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      phone: user.phone,
      email: user.email,
      clubId: user.club_id,
      assignedCourtIds: user.assigned_court_ids ? user.assigned_court_ids.split(',').map(Number) : []
    });
  } catch (error) {
    console.error('ERROR /api/login:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- COURT ENDPOINTS ---
app.get('/api/courts', async (req, res) => {
  const { clubId } = req.query;
  try {
    const [courts] = await db.execute('SELECT * FROM courts WHERE club_id = ?', [clubId || 1]);
    res.json(courts);
  } catch (error) {
    console.error('ERROR /api/courts:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/courts', async (req, res) => {
  const { name, type, clubId, price, startHour, endHour, slotDuration } = req.body;
  try {
    const [result] = await db.execute(
      'INSERT INTO courts (name, type, club_id, price, start_hour, end_hour, slot_duration) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, type, clubId || 1, price || 0, startHour || '08:00', endHour || '23:00', slotDuration || 90]
    );
    res.json({ id: result.insertId, success: true });
  } catch (error) {
    console.error('ERROR POST /api/courts:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/courts/:id', async (req, res) => {
  const { id } = req.params;
  const { name, type, price, startHour, endHour, slotDuration } = req.body;
  try {
    await db.execute(
      'UPDATE courts SET name = ?, type = ?, price = ?, start_hour = ?, end_hour = ?, slot_duration = ? WHERE id = ?',
      [name, type, price || 0, startHour || '08:00', endHour || '23:00', slotDuration || 90, id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('ERROR PUT /api/courts:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- BOOKING ENDPOINTS ---
app.get('/api/bookings', async (req, res) => {
  const { courtId, date } = req.query;
  try {
    let query = 'SELECT * FROM bookings WHERE 1=1';
    const params = [];
    if (courtId) { query += ' AND court_id = ?'; params.push(courtId); }
    if (date) { query += ' AND date = ?'; params.push(date); }
    
    const [bookings] = await db.execute(query, params);
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bookings', async (req, res) => {
  console.log('RECV BOOKING:', JSON.stringify(req.body, null, 2));
  const { courtId, date, startTime, endTime, userName, label, deposit, paymentMethod, phone, email } = req.body;
  
  try {
    const [result] = await db.execute(
      'INSERT INTO bookings (court_id, date, start_time, end_time, user_name, phone, email, label, deposit, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [courtId, date, startTime, endTime, userName, phone || null, email || null, label || 'NORMAL', deposit || 0, paymentMethod]
    );
    
    // Fetch court name for the webhook
    const [courtRes] = await db.execute('SELECT name, club_id FROM courts WHERE id = ?', [courtId]);
    const courtName = courtRes[0]?.name || 'Cancha ' + courtId;
    const clubId = courtRes[0]?.club_id;

    // --- Webhook Notification (Server-Side to bypass CORS) ---
    // Await it to ensure it finishes or use .catch to not block the response if desired, 
    // but here we want to be sure it's sent.
    try {
      const webhookPayload = {
        nombre: userName,
        telefono: phone || 'Sin Telefono',
        email: email || 'Sin Email',
        cancha: courtName,
        fecha: date,
        hora: startTime,
        precio: deposit || 60000,
        source: 'turnitoclub_server'
      };
      
      console.log('Sending to Webhook:', webhookPayload);

      await fetch('https://n8np.pediclub.com/webhook/turnitoclub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });
      console.log('Webhook SUCCESS for:', userName);
    } catch (whErr) {
      console.error('Webhook ERROR:', whErr.message);
    }

    // If there's a deposit, record it in cash movements
    if (deposit > 0) {
      await db.execute(
        'INSERT INTO cash_movements (club_id, court_id, concept, player_name, income, payment_method) VALUES (?, ?, ?, ?, ?, ?)',
        [clubId, courtId, 'Cobro Seña', userName, deposit, paymentMethod]
      );
    }

    res.json({ id: result.insertId, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- CASH MOVEMENTS ENDPOINTS ---
app.get('/api/cash-movements', async (req, res) => {
  const { clubId } = req.query;
  try {
    const [movements] = await db.execute('SELECT * FROM cash_movements WHERE club_id = ? ORDER BY date_movement DESC', [clubId || 1]);
    res.json(movements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { username, password, role, phone, email, clubId, assignedCourtIds } = req.body;
  try {
    const assignedCourtsStr = Array.isArray(assignedCourtIds) ? assignedCourtIds.join(',') : null;
    await db.execute(
      'UPDATE users SET username = ?, password = ?, role = ?, phone = ?, email = ?, club_id = ?, assigned_court_ids = ? WHERE id = ?',
      [
        username, 
        password || '1234', 
        role, 
        phone || null, 
        email || null,
        clubId || null, 
        assignedCourtsStr, 
        id
      ]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('ERROR PUT /api/users:', error);
    res.status(500).json({ error: error.message });
  }
});


app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await db.execute('SELECT 1');
    console.log('DATABASE_CONNECTION_SUCCESS');
  } catch (err) {
    console.error('DATABASE_CONNECTION_ERROR:', err.message);
  }
});
