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
  try {
    const [users] = await db.execute('SELECT id, username, password, role, phone, club_id as clubId, assigned_court_ids as assignedCourtIds FROM users');
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
  const { username, password, role, phone, clubId, assignedCourtIds } = req.body;
  try {
    const assignedCourtsStr = assignedCourtIds ? assignedCourtIds.join(',') : null;
    const [result] = await db.execute(
      'INSERT INTO users (username, password, phone, role, club_id, assigned_court_ids) VALUES (?, ?, ?, ?, ?, ?)',
      [username, password || '1234', phone, role, clubId, assignedCourtsStr]
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
  console.log('Login attempt:', username);
  try {
    const [users] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) return res.status(401).json({ error: 'Usuario no encontrado' });

    const user = users[0];
    if (password !== user.password) return res.status(401).json({ error: 'Contraseña incorrecta' });

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
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
  const { courtId, date, startTime, endTime, userName, label, deposit, paymentMethod } = req.body;
  try {
    const [result] = await db.execute(
      'INSERT INTO bookings (court_id, date, start_time, end_time, user_name, label, deposit, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [courtId, date, startTime, endTime, userName, label || 'NORMAL', deposit || 0, paymentMethod]
    );
    
    // If there's a deposit, record it in cash movements
    if (deposit > 0) {
      const [clubRes] = await db.execute('SELECT club_id FROM courts WHERE id = ?', [courtId]);
      const clubId = clubRes[0].club_id;
      
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

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await db.execute('SELECT 1');
    console.log('DATABASE_CONNECTION_SUCCESS');
  } catch (err) {
    console.error('DATABASE_CONNECTION_ERROR:', err.message);
  }
});
