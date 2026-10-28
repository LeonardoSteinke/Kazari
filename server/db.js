import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(path.join(DATA_DIR, 'media'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
export const db = new Database(path.join(DATA_DIR, 'kazari.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_login_at TEXT, disabled_at TEXT
);
CREATE TABLE IF NOT EXISTS invites (
 id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_audit (
 id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), target_id INTEGER REFERENCES users(id),
 action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS spaces (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS space_members (
 space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('editor','reader')),
 added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(space_id,user_id)
);
CREATE TABLE IF NOT EXISTS categories (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, name TEXT NOT NULL, icon TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tags (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL COLLATE NOCASE, UNIQUE(space_id,name)
);
CREATE TABLE IF NOT EXISTS locations (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 parent_id INTEGER REFERENCES locations(id) ON DELETE SET NULL, name TEXT NOT NULL, icon TEXT
);
CREATE TABLE IF NOT EXISTS custom_fields (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('text','number','date','currency','select','boolean')),
 options TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
 id INTEGER PRIMARY KEY, space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
 purchase_url TEXT NOT NULL DEFAULT '', purchase_label TEXT NOT NULL DEFAULT '',
 custom_values TEXT NOT NULL DEFAULT '{}', image_id TEXT, image_format TEXT NOT NULL DEFAULT 'webp', image_mode TEXT NOT NULL DEFAULT 'optimized',
 sync_id TEXT UNIQUE,
 created_by INTEGER NOT NULL REFERENCES users(id), updated_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS item_categories (
 item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
 PRIMARY KEY(item_id,category_id)
);
CREATE TABLE IF NOT EXISTS item_tags (
 item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
 PRIMARY KEY(item_id,tag_id)
);
CREATE INDEX IF NOT EXISTS idx_items_space_active ON items(space_id,deleted_at,updated_at);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(space_id,parent_id);
`);
// Migração incremental para instalações criadas antes da chave idempotente offline.
if (!db.prepare('PRAGMA table_info(items)').all().some(column => column.name === 'sync_id')) {
  db.exec('ALTER TABLE items ADD COLUMN sync_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_items_sync_id ON items(sync_id) WHERE sync_id IS NOT NULL');
}
if (!db.prepare('PRAGMA table_info(items)').all().some(column => column.name === 'image_format')) {
  db.exec("ALTER TABLE items ADD COLUMN image_format TEXT NOT NULL DEFAULT 'webp'");
}
if (!db.prepare('PRAGMA table_info(spaces)').all().some(column => column.name === 'deleted_at')) {
  db.exec('ALTER TABLE spaces ADD COLUMN deleted_at TEXT');
}
for (const column of ['last_login_at', 'disabled_at']) {
  if (!db.prepare('PRAGMA table_info(users)').all().some(entry => entry.name === column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT`);
}
if (!db.prepare('PRAGMA table_info(users)').all().some(entry => entry.name === 'session_version')) db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
for (const table of ['categories','locations']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'icon')) db.exec(`ALTER TABLE ${table} ADD COLUMN icon TEXT`);
}

export function snapshot() {
 const stamp = new Date().toISOString().replace(/[:.]/g, '-');
 const file = path.join(DATA_DIR, 'backups', `kazari-${stamp}.db`);
 return db.backup(file).then(async () => {
  const dir=path.join(DATA_DIR,'backups');
  const backups=fs.readdirSync(dir).filter(name=>name.startsWith('kazari-')&&name.endsWith('.db')).sort().reverse();
  for(const old of backups.slice(7)) fs.unlinkSync(path.join(dir,old));
 });
}
