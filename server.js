const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const sqlite3 = require('sqlite3').verbose();
const SQLiteStore = require('connect-sqlite3')(session);
const DB_FILE = path.join(__dirname, 'data', 'app.db');
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run('PRAGMA journal_mode=WAL');
  db.run('CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, name TEXT NOT NULL, points INTEGER NOT NULL)');
  db.run('CREATE TABLE IF NOT EXISTS rewards (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, name TEXT NOT NULL, points INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 0)');
  db.run('CREATE TABLE IF NOT EXISTS states (user_email TEXT PRIMARY KEY, saldoAnterior INTEGER NOT NULL DEFAULT 0, taskChecks TEXT NOT NULL DEFAULT "{}")');
});

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function getTasksDB(email) {
  const rows = await allAsync('SELECT name, points FROM tasks WHERE user_email = ?', [email]);
  return rows.map(r => ({ name: r.name, points: r.points }));
}
async function saveTasksDB(email, tasks) {
  await runAsync('BEGIN');
  await runAsync('DELETE FROM tasks WHERE user_email = ?', [email]);
  for (const t of Array.isArray(tasks) ? tasks : []) {
    await runAsync('INSERT INTO tasks (user_email, name, points) VALUES (?, ?, ?)', [email, t.name, Number(t.points) || 0]);
  }
  await runAsync('COMMIT');
}

async function getRewardsDB(email) {
  const rows = await allAsync('SELECT name, points, quantity FROM rewards WHERE user_email = ?', [email]);
  return rows.map(r => ({ name: r.name, points: r.points, quantity: r.quantity }));
}
async function saveRewardsDB(email, rewards) {
  await runAsync('BEGIN');
  await runAsync('DELETE FROM rewards WHERE user_email = ?', [email]);
  for (const r of Array.isArray(rewards) ? rewards : []) {
    await runAsync('INSERT INTO rewards (user_email, name, points, quantity) VALUES (?, ?, ?, ?)', [email, r.name, Number(r.points) || 0, Number(r.quantity) || 0]);
  }
  await runAsync('COMMIT');
}

async function getStateDB(email) {
  const rows = await allAsync('SELECT saldoAnterior, taskChecks FROM states WHERE user_email = ?', [email]);
  if (!rows.length) return { saldoAnterior: 0, taskChecks: {} };
  const row = rows[0];
  let checks = {};
  try { checks = JSON.parse(row.taskChecks || '{}'); } catch (_) { checks = {}; }
  return { saldoAnterior: row.saldoAnterior || 0, taskChecks: checks };
}
async function saveStateDB(email, { saldoAnterior = 0, taskChecks = {} }) {
  await runAsync('INSERT INTO states (user_email, saldoAnterior, taskChecks) VALUES (?, ?, ?) ON CONFLICT(user_email) DO UPDATE SET saldoAnterior=excluded.saldoAnterior, taskChecks=excluded.taskChecks', [email, Number(saldoAnterior) || 0, JSON.stringify(taskChecks || {})]);
}

function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret',
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: 'sessions.sqlite3', dir: path.join(__dirname, 'data') })
}));
app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`
  }, (accessToken, refreshToken, profile, done) => {
    const user = {
      id: profile.id,
      displayName: profile.displayName,
      email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
      photo: profile.photos && profile.photos[0] ? profile.photos[0].value : null
    };
    return done(null, user);
  }));
}

// Auth routes
app.get('/auth/google', (req, res, next) => {
  if (!passport._strategies.google) {
    return res.status(500).send('Google OAuth não configurado. Defina GOOGLE_CLIENT_ID/SECRET.');
  }
  next();
}, passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/?login=failed' }), (req, res) => {
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) console.error(err);
    req.session.destroy(() => res.redirect('/'));
  });
});

// Session info
app.get('/api/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.json({ user: req.user });
  }
  res.status(401).json({ user: null });
});

// Data APIs (separadas)
app.get('/api/tasks', ensureAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const tasks = await getTasksDB(email);
    res.json(tasks);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});
app.post('/api/tasks', ensureAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const tasks = Array.isArray(req.body) ? req.body : [];
    await saveTasksDB(email, tasks);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/rewards', ensureAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const rewards = await getRewardsDB(email);
    res.json(rewards);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});
app.post('/api/rewards', ensureAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const rewards = Array.isArray(req.body) ? req.body : [];
    await saveRewardsDB(email, rewards);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Estado do usuário (saldoAnterior e checks)
app.get('/api/state', ensureAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const state = await getStateDB(email);
    res.json(state);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});
app.post('/api/state', ensureAuth, async (req, res) => {
  try {
    const email = req.user.email;
    const { saldoAnterior = 0, taskChecks = {} } = req.body || {};
    await saveStateDB(email, { saldoAnterior, taskChecks });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});