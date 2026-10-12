'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  phone          TEXT NOT NULL UNIQUE,
  nick           TEXT NOT NULL,
  password_hash  TEXT NOT NULL DEFAULT '',
  avatar         TEXT NOT NULL DEFAULT '',
  district       TEXT NOT NULL DEFAULT 'Другой район',
  about          TEXT NOT NULL DEFAULT '',
  telegram       TEXT NOT NULL DEFAULT '',
  viber          TEXT NOT NULL DEFAULT '',
  settings       TEXT NOT NULL DEFAULT '{}',
  created_at     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS verify_codes (
  phone      TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reg_tokens (
  token      TEXT PRIMARY KEY,
  phone      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  icon  TEXT NOT NULL DEFAULT '📦'
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL DEFAULT 0,
  category    TEXT NOT NULL,
  district    TEXT NOT NULL DEFAULT '',
  images      TEXT NOT NULL DEFAULT '[]',
  views       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

const DISTRICTS = [
  'Салтовка', 'Северная Салтовка', 'Академгородок', 'Павловка',
  'ХТЗ', 'Рогань', 'Основа', 'Немышля', 'Холодная гора',
  'Киевский', 'Московский', 'Шевченковский', 'Индустриальный',
  'Слободской', 'Пушкинский', 'Алексеевка', 'Дегтяри',
  'Заикино', 'Боровая', 'Малая Даниловка', 'Центр', 'Другой район'
];

const CATEGORIES = [
  { slug: 'electronics', title: 'Электроника', icon: '📱' },
  { slug: 'transport', title: 'Транспорт', icon: '🚗' },
  { slug: 'clothes', title: 'Одежда и обувь', icon: '👕' },
  { slug: 'home', title: 'Дом и мебель', icon: '🛋️' },
  { slug: 'kids', title: 'Детские товары', icon: '🧸' },
  { slug: 'hobby', title: 'Хобби и отдых', icon: '🎸' },
  { slug: 'sport', title: 'Спорт', icon: '🏋️' },
  { slug: 'books', title: 'Книги', icon: '📚' },
  { slug: 'pets', title: 'Животные', icon: '🐶' },
  { slug: 'services', title: 'Услуги', icon: '🛠️' },
  { slug: 'food', title: 'Продукты', icon: '🍎' },
  { slug: 'other', title: 'Другое', icon: '📦' }
];

function seed() {
  const now = Date.now();
  const insCat = db.prepare('INSERT OR IGNORE INTO categories (slug, title, icon) VALUES (?, ?, ?)');
  for (const c of CATEGORIES) insCat.run(c.slug, c.title, c.icon);

  db.exec('CREATE TABLE IF NOT EXISTS districts_meta (name TEXT PRIMARY KEY)');
  const insDist = db.prepare('INSERT OR IGNORE INTO districts_meta (name) VALUES (?)');
  for (const d of DISTRICTS) insDist.run(d);

  const n = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (n === 0) seedDemo(now);
}

function seedDemo(now) {
  const demo = [
    { nick: 'Андрей_Khv', phone: '+380501112233', district: 'Салтовка', tg: '@andrey_hv', vib: '+380501112233',
      items: [
        ['iPhone 13 128GB', 'Состояние отличное, полный комплект, аккумулятор 89%. Самовывоз Салтовка.', 14500, 'electronics'],
        ['Пылесос Dyson V8', 'Мощный, 2 насадки, батарея держит 30 минут.', 4200, 'home']
      ] },
    { nick: 'Оксана_М', phone: '+380631234567', district: 'Академгородок', tg: '@oksana_ak', vib: '+380631234567',
      items: [
        ['Детская коляска 2-в-1', 'Лёгкая, разрешена в самолёт, зимний конверт в подарок.', 5600, 'kids'],
        ['Кроссовки Nike 38', 'Носила 2 раза, размер не подошёл.', 1800, 'clothes']
      ] },
    { nick: 'Максим_ХТЗ', phone: '+380951122334', district: 'ХТЗ', tg: '@max_khz', vib: '+380951122334',
      items: [
        ['Велосипед Stels Navigator', '21 скорость, рама 18", после ТО.', 6900, 'sport'],
        ['Набор инструментов 128 предметов', 'В кейсе, почти не пользовался.', 2400, 'home']
      ] },
    { nick: 'Ирина_Центр', phone: '+380991555666', district: 'Центр', tg: '@ira_center', vib: '+380991555666',
      items: [
        ['Услуги маникюра на дому', 'Аппарат + покрытие гель-лак, выезд по Центру и Шевченковскому.', 450, 'services'],
        ['Диван-кровать', 'Механизм еврокнижка, велюр, цвет графит.', 7800, 'home']
      ] },
    { nick: 'Дмитрий_Рогань', phone: '+380731777888', district: 'Рогань', tg: '@dima_rogan', vib: '+380731777888',
      items: [
        ['PlayStation 5 Slim + 2 геймпада', 'Дисковая версия, гарантия до весны.', 21500, 'electronics'],
        ['Гитара акустическая Fender', 'Отличный звук, чехол в комплекте.', 5200, 'hobby']
      ] }
  ];

  const catBySlug = db.prepare('SELECT slug FROM categories WHERE slug = ?');
  for (const u of demo) {
    const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(u.phone);
    if (exists) continue;
    const userId = db.prepare(
      'INSERT INTO users (phone, nick, password_hash, district, telegram, viber, about, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(u.phone, u.nick, '', u.district, u.tg, u.vib, 'Продаю своё, торг у места. Харьков.', now, now).lastInsertRowid;

    for (const [i, it] of u.items.entries()) {
      const slug = catBySlug.get(it[3]) ? it[3] : 'other';
      db.prepare(
        'INSERT INTO products (user_id, title, description, price, category, district, images, created_at, views) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(userId, it[0], it[1], it[2], slug, u.district, '[]', now - i * 3600e3 - Math.floor(Math.random() * 5) * 900e3, 10 + i * 7);
    }
  }
}

seed();

module.exports = { db, DISTRICTS, CATEGORIES, DATA_DIR, DB_PATH };
