const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'data', 'state.json');
const TASKS_FILE = path.join(__dirname, 'data', 'tasks.json');
const REWARDS_FILE = path.join(__dirname, 'data', 'rewards.json');

// Helpers
function readJson(filePath, fallback) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (_) {
    return fallback;
  }
}
function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

// Separação por usuário (usando email)
function sanitizeEmail(email) {
  return String(email || '').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}
function getUserDir(email) {
  const dir = path.join(__dirname, 'data', 'users', sanitizeEmail(email));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function readUserJson(email, baseName, fallback) {
  const filePath = path.join(getUserDir(email), `${baseName}.json`);
  return readJson(filePath, fallback);
}
function writeUserJson(email, baseName, obj) {
  const filePath = path.join(getUserDir(email), `${baseName}.json`);
  writeJson(filePath, obj);
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
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(__dirname));

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
app.get('/api/tasks', ensureAuth, (req, res) => {
  const email = req.user.email;
  const tasks = readUserJson(email, 'tasks', []);
  res.json(tasks);
});
app.post('/api/tasks', ensureAuth, (req, res) => {
  const email = req.user.email;
  const tasks = Array.isArray(req.body) ? req.body : [];
  writeUserJson(email, 'tasks', tasks);
  res.json({ ok: true });
});

app.get('/api/rewards', ensureAuth, (req, res) => {
  const email = req.user.email;
  const rewards = readUserJson(email, 'rewards', []);
  res.json(rewards);
});
app.post('/api/rewards', ensureAuth, (req, res) => {
  const email = req.user.email;
  const rewards = Array.isArray(req.body) ? req.body : [];
  writeUserJson(email, 'rewards', rewards);
  res.json({ ok: true });
});

// Estado do usuário (saldoAnterior e checks)
app.get('/api/state', ensureAuth, (req, res) => {
  const email = req.user.email;
  const state = readUserJson(email, 'state', { saldoAnterior: 0, taskChecks: {} });
  res.json(state);
});
app.post('/api/state', ensureAuth, (req, res) => {
  const email = req.user.email;
  const { saldoAnterior = 0, taskChecks = {} } = req.body || {};
  writeUserJson(email, 'state', { saldoAnterior, taskChecks });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});