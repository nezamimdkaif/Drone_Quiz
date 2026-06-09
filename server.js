import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import db from './database.js';

const app = express();
const httpServer = createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'ece-drone-lab-secret-key-12345';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const ADMIN_EMAIL = '25pr0161@iitism.ac.in';

// ── Socket.IO ────────────────────────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: { origin: FRONTEND_URL, methods: ['GET', 'POST'], credentials: true }
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

// ── Auth Helpers ─────────────────────────────────────────────────────────────
const makeToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, avatar_url: user.avatar_url || null },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

const authenticateToken = (req, res, next) => {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token missing' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

// ── AUTH: Email/Password ─────────────────────────────────────────────────────

app.post('/api/auth/signup', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'Please fill in all fields' });

  try {
    const trimmedEmail = email.toLowerCase().trim();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail))
      return res.status(400).json({ error: 'Email already registered' });

    const role = trimmedEmail === ADMIN_EMAIL ? 'admin' : 'user';
    const password_hash = bcrypt.hashSync(password, 10);
    const result = db
      .prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(trimmedEmail, password_hash, name.trim(), role);

    const user = { id: result.lastInsertRowid, email: trimmedEmail, name: name.trim(), role, avatar_url: null };
    res.status(201).json({ token: makeToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Please fill in all fields' });

  try {
    const trimmedEmail = email.toLowerCase().trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(trimmedEmail);
    if (!user || !user.password_hash)
      return res.status(400).json({ error: 'Invalid credentials' });

    if (!bcrypt.compareSync(password, user.password_hash))
      return res.status(400).json({ error: 'Invalid credentials' });

    res.json({ token: makeToken(user), user: { id: user.id, email: user.email, name: user.name, role: user.role, avatar_url: user.avatar_url } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/firebase-login', (req, res) => {
  const { uid, email, name, avatar } = req.body;
  if (!uid || !email || !name) {
    return res.status(400).json({ error: 'Missing Firebase user details' });
  }

  try {
    const trimmedEmail = email.toLowerCase().trim();
    const role = trimmedEmail === ADMIN_EMAIL ? 'admin' : 'user';

    // Upsert user
    let dbUser = db.prepare('SELECT * FROM users WHERE email = ?').get(trimmedEmail);
    if (!dbUser) {
      const result = db
        .prepare('INSERT INTO users (email, name, role, google_id, avatar_url) VALUES (?, ?, ?, ?, ?)')
        .run(trimmedEmail, name.trim(), role, uid, avatar || null);
      dbUser = { id: result.lastInsertRowid, email: trimmedEmail, name: name.trim(), role, avatar_url: avatar || null };
    } else {
      // Update google_id / avatar if missing or changed
      db.prepare('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?')
        .run(uid, avatar || null, dbUser.id);
      dbUser.google_id = uid;
      dbUser.avatar_url = avatar || null;
    }

    res.json({ token: makeToken(dbUser), user: { id: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role, avatar_url: dbUser.avatar_url } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── AUTH: Google OAuth 2.0 ───────────────────────────────────────────────────
// Step 1: redirect browser to Google consent screen
app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2: Google redirects back here
app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}/login?error=google_failed`);

  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Token exchange failed');

    // Get user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userInfoRes.json();

    const email = googleUser.email.toLowerCase().trim();
    const role = email === ADMIN_EMAIL ? 'admin' : 'user';

    // Upsert user
    let dbUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!dbUser) {
      const result = db
        .prepare('INSERT INTO users (email, name, role, google_id, avatar_url) VALUES (?, ?, ?, ?, ?)')
        .run(email, googleUser.name, role, googleUser.sub, googleUser.picture || null);
      dbUser = { id: result.lastInsertRowid, email, name: googleUser.name, role, avatar_url: googleUser.picture || null };
    } else {
      // Update google_id / avatar if missing
      db.prepare('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?')
        .run(googleUser.sub, googleUser.picture || null, dbUser.id);
      dbUser.avatar_url = googleUser.picture || null;
    }

    const token = makeToken(dbUser);
    // Redirect to frontend with token in URL fragment (handled by frontend)
    res.redirect(`${FRONTEND_URL}/auth/callback#token=${token}`);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect(`${FRONTEND_URL}/login?error=google_failed`);
  }
});

// ── USER: Self info + stats ───────────────────────────────────────────────────
app.get('/api/user/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, avatar_url FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const attempts = db
      .prepare('SELECT score, time_taken_seconds, completed_at FROM quiz_attempts WHERE user_id = ? ORDER BY completed_at DESC LIMIT 10')
      .all(req.user.id);

    const bestScore = attempts.length ? Math.max(...attempts.map((a) => a.score)) : 0;

    // Calculate rank — find position in best-attempt leaderboard
    const leaderboard = db.prepare(`
      WITH BestAttempts AS (
        SELECT user_id, score, time_taken_seconds,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, time_taken_seconds ASC) as rn
        FROM quiz_attempts
      )
      SELECT user_id FROM BestAttempts WHERE rn = 1
      ORDER BY score DESC, time_taken_seconds ASC
    `).all();

    const rank = leaderboard.findIndex((r) => r.user_id === req.user.id) + 1 || null;

    const session = db.prepare('SELECT is_ended, question_count FROM quiz_session WHERE id = 1').get();

    res.json({
      user,
      stats: { bestScore, quizzesAttempted: attempts.length, rank },
      recentAttempts: attempts,
      quizSession: session,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── QUIZ: Get questions ───────────────────────────────────────────────────────
app.get('/api/quiz/questions', authenticateToken, (req, res) => {
  try {
    const session = db.prepare('SELECT question_count FROM quiz_session WHERE id = 1').get();
    const count = session?.question_count || 10;

    const all = db.prepare('SELECT id, question_text, option_a, option_b, option_c, option_d, category FROM questions').all();
    const shuffled = all.sort(() => Math.random() - 0.5).slice(0, count);
    res.json(shuffled);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// ── QUIZ: Submit answers ──────────────────────────────────────────────────────
app.post('/api/quiz/submit', authenticateToken, (req, res) => {
  const { answers, timeTakenSeconds } = req.body;
  if (!answers || typeof timeTakenSeconds !== 'number')
    return res.status(400).json({ error: 'Invalid submission data' });

  try {
    const questionIds = Object.keys(answers).map(Number);
    if (!questionIds.length) return res.status(400).json({ error: 'No answers submitted' });

    const placeholders = questionIds.map(() => '?').join(',');
    const dbQuestions = db
      .prepare(`SELECT id, correct_option, question_text, option_a, option_b, option_c, option_d, category FROM questions WHERE id IN (${placeholders})`)
      .all(...questionIds);

    let score = 0;
    const evaluation = dbQuestions.map((q) => {
      const userAnswer = answers[q.id];
      const isCorrect = userAnswer === q.correct_option;
      if (isCorrect) score++;
      return { id: q.id, question_text: q.question_text, option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d, category: q.category, userAnswer, correctAnswer: q.correct_option, isCorrect };
    });

    db.prepare('INSERT INTO quiz_attempts (user_id, score, time_taken_seconds) VALUES (?, ?, ?)').run(req.user.id, score, timeTakenSeconds);

    res.json({ score, total: questionIds.length, timeTakenSeconds, evaluation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during submission' });
  }
});

// ── QUIZ: Status (is ended? question count?) ──────────────────────────────────
app.get('/api/quiz/status', (req, res) => {
  try {
    const session = db.prepare('SELECT is_ended, question_count, ended_at FROM quiz_session WHERE id = 1').get();
    res.json(session || { is_ended: 0, question_count: 10, ended_at: null });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── ADMIN: Get leaderboard ────────────────────────────────────────────────────
app.get('/api/admin/leaderboard', authenticateToken, requireAdmin, (req, res) => {
  try {
    const leaderboard = db.prepare(`
      WITH BestAttempts AS (
        SELECT user_id, score, time_taken_seconds, completed_at,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, time_taken_seconds ASC, completed_at ASC) as rn
        FROM quiz_attempts
      )
      SELECT u.name, u.email, u.avatar_url, ba.score, ba.time_taken_seconds, ba.completed_at
      FROM BestAttempts ba
      JOIN users u ON u.id = ba.user_id
      WHERE ba.rn = 1
      ORDER BY ba.score DESC, ba.time_taken_seconds ASC, ba.completed_at ASC
    `).all();

    const session = db.prepare('SELECT is_ended, question_count FROM quiz_session WHERE id = 1').get();
    res.json({ leaderboard, session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ── ADMIN: End quiz — broadcasts result to all connected clients ───────────────
app.post('/api/admin/end-quiz', authenticateToken, requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE quiz_session SET is_ended = 1, ended_at = CURRENT_TIMESTAMP WHERE id = 1').run();

    // Fetch final leaderboard to broadcast
    const leaderboard = db.prepare(`
      WITH BestAttempts AS (
        SELECT user_id, score, time_taken_seconds, completed_at,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, time_taken_seconds ASC, completed_at ASC) as rn
        FROM quiz_attempts
      )
      SELECT u.name, u.email, u.avatar_url, ba.score, ba.time_taken_seconds, ba.completed_at
      FROM BestAttempts ba
      JOIN users u ON u.id = ba.user_id
      WHERE ba.rn = 1
      ORDER BY ba.score DESC, ba.time_taken_seconds ASC, ba.completed_at ASC
    `).all();

    // Emit to ALL connected socket clients
    io.emit('quiz_ended', { leaderboard });

    res.json({ success: true, leaderboard });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end quiz' });
  }
});

// ── ADMIN: Reset quiz session (start fresh) ───────────────────────────────────
app.post('/api/admin/reset-quiz', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { questionCount } = req.body;
    const count = Number(questionCount) || 10;
    db.prepare('UPDATE quiz_session SET is_ended = 0, question_count = ?, ended_at = NULL WHERE id = 1').run(count);
    io.emit('quiz_reset', { questionCount: count });
    res.json({ success: true, questionCount: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset quiz' });
  }
});

// ── ADMIN: Stats summary ──────────────────────────────────────────────────────
app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
  try {
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user'").get().count;
    const totalAttempts = db.prepare('SELECT COUNT(*) as count FROM quiz_attempts').get().count;
    const avgScore = db.prepare('SELECT AVG(score) as avg FROM quiz_attempts').get().avg || 0;
    const session = db.prepare('SELECT is_ended, question_count FROM quiz_session WHERE id = 1').get();
    res.json({ totalUsers, totalAttempts, avgScore: Math.round(avgScore * 10) / 10, session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── START ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`✅ Drone Quiz Server running on http://localhost:${PORT}`);
  if (!GOOGLE_CLIENT_ID) console.warn('⚠️  GOOGLE_CLIENT_ID not set — Google OAuth disabled');
});
