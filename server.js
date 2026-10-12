'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { loadEnv } = require('./lib/env');
loadEnv();
const express = require('express');
const { db, DISTRICTS, CATEGORIES } = require('./db');
const { sendSms } = require('./lib/sms');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DEV_MODE = (process.env.SMS_PROVIDER || 'dev').toLowerCase() === 'dev';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '14mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));

/* ---------------------------------- utils --------------------------------- */

const now = () => Date.now();
const rand = (n) => crypto.randomBytes(n).toString('hex');
const normalizePhone = (raw) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 && d[0] === '0') return '+380' + d.slice(1);
  if (d.length === 12 && d.startsWith('380')) return '+' + d;
  if (d.length === 11 && d.startsWith('80')) return '+3' + d;
  if (d.length === 9 && d.startsWith('0')) return '+38' + d;
  return null;
};
const hashPassword = (pass) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  return `${salt}:${h}`;
};
const checkPassword = (pass, stored) => {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const cand = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(cand, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const esc = (s) => String(s ?? '').trim();

function publicUser(u) {
  if (!u) return null;
  let settings = {};
  try { settings = JSON.parse(u.settings || '{}'); } catch { settings = {}; }
  return {
    id: u.id, nick: u.nick, avatar: u.avatar, district: u.district, about: u.about,
    telegram: u.telegram, viber: u.viber, phone: u.phone, created_at: u.created_at,
    settings, last_seen: u.last_seen
  };
}

// Публичная карточка — без номера телефона
function publicUserSafe(u) {
  const p = publicUser(u);
  if (!p) return p;
  delete p.phone;
  delete p.last_seen;
  return p;
}

function productRow(p) {
  return {
    id: p.id, title: p.title, description: p.description, price: p.price,
    category: p.category, category_title: p.cat_title || '', category_icon: p.cat_icon || '📦',
    district: p.district, images: JSON.parse(p.images || '[]'), views: p.views,
    created_at: p.created_at,
    seller: {
      id: p.uid, nick: p.nick, avatar: p.avatar, district: p.udistrict,
      telegram: p.telegram, viber: p.viber, created_at: p.ucreated
    }
  };
}

const P_SELECT = `
  SELECT p.*, c.title AS cat_title, c.icon AS cat_icon,
         u.id AS uid, u.nick AS nick, u.avatar AS avatar, u.district AS udistrict,
         u.telegram AS telegram, u.viber AS viber, u.created_at AS ucreated
  FROM products p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN categories c ON c.slug = p.category`;

/* --------------------------------- session -------------------------------- */

function setSession(res, userId) {
  const token = rand(32);
  const exp = now() + SESSION_DAYS * 86400e3;
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, now(), exp);
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; ${process.env.COOKIE_SECURE === '1' ? 'Secure; ' : ''}`);
  return token;
}

function getUser(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  if (!m) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(m[1]);
  if (!s || s.expires_at < now()) return null;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!u) return null;
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(now() + SESSION_DAYS * 86400e3, m[1]);
  return u;
}

function auth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Требуется вход' });
  req.user = u;
  next();
}

/* ------------------------------- meta / home ------------------------------ */

app.get('/api/meta', (req, res) => {
  res.json({
    categories: db.prepare('SELECT slug, title, icon FROM categories ORDER BY id').all(),
    districts: DISTRICTS,
    city: 'Харьков'
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    products: db.prepare("SELECT COUNT(*) n FROM products WHERE status='active'").get().n,
    districts: DISTRICTS.length
  });
});

/* ----------------------------- Rate limit (SMS) -------------------------- */

const smsHits = new Map(); // phone -> массив timestamp'ов
function allowSms(phone) {
  const now = Date.now();
  const hits = (smsHits.get(phone) || []).filter((t) => now - t < 3600e3);
  if (hits.some((t) => now - t < 60e3)) return false;   // не чаще 1 в минуту
  if (hits.length >= 5) return false;                    // не более 5 в час
  hits.push(now);
  smsHits.set(phone, hits);
  return true;
}

/* ---------------------------------- auth ---------------------------------- */

app.post('/api/auth/register/start', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'Некорректный номер телефона' });
  if (!phone.startsWith('+380')) return res.status(400).json({ error: 'Поддерживаются номера Украины +380' });
  if (!allowSms(phone)) return res.status(429).json({ error: 'Слишком часто. Подождите минуту' });

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (existing) return res.status(409).json({ error: 'Номер уже зарегистрирован — войдите' });

  const code = String(crypto.randomInt(100000, 999999));
  db.prepare(`INSERT INTO verify_codes (phone, code, attempts, expires_at) VALUES (?,?,0,?)
              ON CONFLICT(phone) DO UPDATE SET code=excluded.code, attempts=0, expires_at=excluded.expires_at`)
    .run(phone, code, now() + 5 * 60e3);

  const r = await sendSms(phone, `Kharkiv Market: ваш код подтверждения — ${code}. Действует 5 минут.`);
  res.json({ sent: true, ...(DEV_MODE && r.ok !== false ? { devCode: code } : {}) });
});

app.post('/api/auth/register/verify', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = esc(req.body.code);
  const row = phone && db.prepare('SELECT * FROM verify_codes WHERE phone = ?').get(phone);
  if (!row || row.expires_at < now()) return res.status(400).json({ error: 'Код устарел, запросите новый' });
  if (row.attempts >= 5) return res.status(429).json({ error: 'Слишком много попыток, запросите новый код' });
  if (row.code !== code) {
    db.prepare('UPDATE verify_codes SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    return res.status(400).json({ error: 'Неверный код' });
  }
  db.prepare('DELETE FROM verify_codes WHERE phone = ?').run(phone);
  const token = rand(24);
  db.prepare('INSERT INTO reg_tokens (token, phone, expires_at) VALUES (?,?,?)')
    .run(token, phone, now() + 15 * 60e3);
  res.json({ regToken: token, phone });
});

app.post('/api/auth/register/finish', (req, res) => {
  const { regToken, nick, password, district, telegram, viber, about, avatar } = req.body || {};
  const t = regToken && db.prepare('SELECT * FROM reg_tokens WHERE token = ?').get(String(regToken));
  if (!t || t.expires_at < now()) return res.status(400).json({ error: 'Сессия регистрации истекла, начните заново' });

  const n = esc(nick);
  if (n.length < 3 || n.length > 32) return res.status(400).json({ error: 'Ник должен быть 3–32 символа' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Пароль от 6 символов' });
  if (db.prepare('SELECT id FROM users WHERE nick = ? COLLATE NOCASE').get(n)) {
    return res.status(409).json({ error: 'Такой ник уже занят' });
  }
  const dist = DISTRICTS.includes(district) ? district : 'Другой район';

  const info = db.prepare(`
    INSERT INTO users (phone, nick, password_hash, avatar, district, about, telegram, viber, created_at, last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(t.phone, n, hashPassword(password), esc(avatar).slice(0, 400000), dist,
      esc(about).slice(0, 500), esc(telegram).slice(0, 64), esc(viber).slice(0, 32), now(), now());

  db.prepare('DELETE FROM reg_tokens WHERE token = ?').run(String(regToken));
  setSession(res, Number(info.lastInsertRowid));
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/login', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const u = phone && db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!u || !checkPassword(req.body.password, u.password_hash)) {
    return res.status(400).json({ error: 'Неверный номер или пароль' });
  }
  setSession(res, u.id);
  res.json({ user: publicUser(u) });
});

// Вход по SMS-коду (пароль не нужен)
app.post('/api/auth/login/code/start', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const u = phone && db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!u) return res.status(404).json({ error: 'Номер не найден' });
  if (!allowSms(phone)) return res.status(429).json({ error: 'Слишком часто. Подождите минуту' });
  const code = String(crypto.randomInt(100000, 999999));
  db.prepare(`INSERT INTO verify_codes (phone, code, attempts, expires_at) VALUES (?,?,0,?)
              ON CONFLICT(phone) DO UPDATE SET code=excluded.code, attempts=0, expires_at=excluded.expires_at`)
    .run(phone, code, now() + 5 * 60e3);
  const r = await sendSms(phone, `Kharkiv Market: код входа — ${code}`);
  res.json({ sent: true, ...(DEV_MODE && r.ok !== false ? { devCode: code } : {}) });
});

app.post('/api/auth/login/code/verify', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = esc(req.body.code);
  const row = phone && db.prepare('SELECT * FROM verify_codes WHERE phone = ?').get(phone);
  if (!row || row.expires_at < now()) return res.status(400).json({ error: 'Код устарел' });
  if (row.code !== code) {
    db.prepare('UPDATE verify_codes SET attempts = attempts + 1 WHERE phone = ?').run(phone);
    return res.status(400).json({ error: 'Неверный код' });
  }
  const u = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  db.prepare('DELETE FROM verify_codes WHERE phone = ?').run(phone);
  setSession(res, u.id);
  res.json({ user: publicUser(u) });
});

app.post('/api/auth/logout', (req, res) => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const u = getUser(req);
  if (!u) return res.json({ user: null });
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), u.id);
  res.json({ user: publicUser(u) });
});

/* --------------------------------- profile -------------------------------- */

app.patch('/api/me', auth, (req, res) => {
  const b = req.body || {};
  const u = req.user;
  const patch = {};
  if (typeof b.nick === 'string') {
    const n = esc(b.nick);
    if (n.length < 3 || n.length > 32) return res.status(400).json({ error: 'Ник 3–32 символа' });
    const dup = db.prepare('SELECT id FROM users WHERE nick = ? COLLATE NOCASE AND id != ?').get(n, u.id);
    if (dup) return res.status(409).json({ error: 'Ник занят' });
    patch.nick = n;
  }
  if (typeof b.district === 'string') patch.district = DISTRICTS.includes(b.district) ? b.district : u.district;
  if (typeof b.about === 'string') patch.about = b.about.slice(0, 500);
  if (typeof b.telegram === 'string') patch.telegram = b.telegram.slice(0, 64);
  if (typeof b.viber === 'string') patch.viber = b.viber.slice(0, 32);
  if (typeof b.avatar === 'string') patch.avatar = b.avatar.slice(0, 400000);
  if (typeof b.password === 'string' && b.password.length >= 6) patch.password_hash = hashPassword(b.password);

  if (b.settings && typeof b.settings === 'object') {
    let cur = {};
    try { cur = JSON.parse(u.settings || '{}'); } catch { cur = {}; }
    patch.settings = JSON.stringify({ ...cur, ...b.settings });
  }

  const keys = Object.keys(patch);
  if (!keys.length) return res.json({ user: publicUser(u) });
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), u.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

app.get('/api/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'Продавец не найден' });
  const items = db.prepare(`${P_SELECT} WHERE p.user_id = ? AND p.status = 'active' ORDER BY p.created_at DESC`).all(u.id).map(productRow);
  const me = getUser(req);
  res.json({ seller: publicUserSafe(u), products: items, is_me: !!me && me.id === u.id });
});

app.get('/api/sellers', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const district = req.query.district && req.query.district !== 'all' ? String(req.query.district) : null;
  const where = district ? 'WHERE u.district = ?' : '';
  const rows = db.prepare(`
    SELECT u.*, COUNT(p.id) AS items_count
    FROM users u
    LEFT JOIN products p ON p.user_id = u.id AND p.status = 'active'
    ${where}
    GROUP BY u.id
    ORDER BY items_count DESC, u.created_at DESC
    LIMIT ?`).all(...(district ? [district] : []), limit);
  res.json({ items: rows.map((u) => ({ ...publicUserSafe(u), items_count: u.items_count })) });
});

app.delete('/api/me', auth, (req, res) => {
  const sid = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/)?.[1];
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM products WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

/* -------------------------------- products -------------------------------- */

app.get('/api/products', (req, res) => {
  const { category, q, district, sort } = req.query;
  const limit = Math.min(Number(req.query.limit) || 30, 60);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = ["p.status = 'active'"];
  const args = [];
  if (category && category !== 'all') { where.push('p.category = ?'); args.push(String(category)); }
  if (district && district !== 'all') { where.push('p.district = ?'); args.push(String(district)); }
  if (q) {
    where.push('(p.title LIKE ? OR p.description LIKE ?)');
    args.push(`%${String(q).slice(0, 80)}%`, `%${String(q).slice(0, 80)}%`);
  }
  let order = 'p.created_at DESC';
  if (sort === 'price-asc') order = 'p.price ASC';
  else if (sort === 'price-desc') order = 'p.price DESC';
  else if (sort === 'views') order = 'p.views DESC';

  const sql = `${P_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...args, limit, offset).map(productRow);
  const total = db.prepare(`SELECT COUNT(*) n FROM products p WHERE ${where.join(' AND ')}`).get(...args).n;
  res.json({ items: rows, total, limit, offset });
});

app.get('/api/products/latest', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 8, 24);
  const rows = db.prepare(`${P_SELECT} WHERE p.status = 'active' ORDER BY p.created_at DESC LIMIT ?`)
    .all(limit).map(productRow);
  res.json({ items: rows });
});

app.get('/api/products/featured', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 6, 12);
  const rows = db.prepare(`${P_SELECT} WHERE p.status = 'active' ORDER BY p.views DESC, p.created_at DESC LIMIT ?`)
    .all(limit).map(productRow);
  res.json({ items: rows });
});

app.get('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`${P_SELECT} WHERE p.id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Объявление не найдено' });
  db.prepare('UPDATE products SET views = views + 1 WHERE id = ?').run(id);
  res.json({ product: productRow(row) });
});

app.post('/api/products', auth, (req, res) => {
  const b = req.body || {};
  const title = esc(b.title);
  const desc = esc(b.description).slice(0, 2000);
  const price = Math.max(0, Math.min(Number(b.price) || 0, 100000000));
  const cat = db.prepare('SELECT slug FROM categories WHERE slug = ?').get(String(b.category || ''));
  if (title.length < 4 || title.length > 120) return res.status(400).json({ error: 'Название 4–120 символов' });
  if (!cat) return res.status(400).json({ error: 'Выберите рубрику' });
  const district = DISTRICTS.includes(b.district) ? b.district : req.user.district;
  const images = Array.isArray(b.images) ? b.images.slice(0, 4).filter((i) => typeof i === 'string' && i.startsWith('data:image/')) : [];

  const info = db.prepare(`
    INSERT INTO products (user_id, title, description, price, category, district, images, created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(req.user.id, title, desc, price, cat.slug, district, JSON.stringify(images), now());
  const row = db.prepare(`${P_SELECT} WHERE p.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ product: productRow(row) });
});

app.delete('/api/products/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Объявление не найдено' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваш товар' });
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

app.patch('/api/products/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Объявление не найдено' });
  if (p.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваш товар' });
  const b = req.body || {};
  const title = typeof b.title === 'string' ? esc(b.title) : p.title;
  if (title.length < 4 || title.length > 400) return res.status(400).json({ error: 'Название 4–120 символов' });
  const price = typeof b.price === 'number' ? Math.max(0, Math.min(b.price, 100000000)) : p.price;
  const desc = typeof b.description === 'string' ? b.description.slice(0, 2000) : p.description;
  const district = DISTRICTS.includes(b.district) ? b.district : p.district;
  db.prepare('UPDATE products SET title=?, description=?, price=?, district=? WHERE id=?')
    .run(title, desc, price, district, p.id);
  const row = db.prepare(`${P_SELECT} WHERE p.id = ?`).get(p.id);
  res.json({ product: productRow(row) });
});

/* ----------------------------------- SPA ---------------------------------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, HOST, () => {
  console.log(`Kharkiv Market запущен: http://localhost:${PORT} (host=${HOST}, sms=${process.env.SMS_PROVIDER || 'dev'})`);
});
