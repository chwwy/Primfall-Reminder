const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { BOSSES, GAME_CHANNELS } = require('./config');

// Resolve database directory — persistent volume on Railway, project root locally
const dbDir = process.env.RAILWAY_PROJECT_NAME
  ? '/app/data'
  : path.join(__dirname, '..');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, 'database.sqlite'));
db.pragma('journal_mode = WAL');

// ── Schema ──────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS server_settings (
    guild_id                TEXT PRIMARY KEY,
    toggle_channel_id       TEXT,
    control_panel_channel_id TEXT,
    status_channel_id       TEXT,
    toggle_message_id       TEXT,
    control_panel_message_id TEXT,
    timer_panel_message_id  TEXT,
    reminder_minutes        INTEGER DEFAULT 0,
    alert_cleanup_minutes   INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bosses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id          TEXT,
    name              TEXT,
    category          TEXT,
    status_message_id TEXT,
    UNIQUE(guild_id, name)
  );

  CREATE TABLE IF NOT EXISTS boss_timers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id        TEXT,
    boss_name       TEXT,
    game_channel    TEXT,
    enabled         INTEGER DEFAULT 1,
    interval_ms     INTEGER,
    last_spawn_utc  INTEGER,
    next_spawn_utc  INTEGER,
    override_utc    INTEGER,
    reminder_sent   INTEGER DEFAULT 0,
    UNIQUE(guild_id, boss_name, game_channel)
  );

  CREATE TABLE IF NOT EXISTS alert_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT,
    channel_id    TEXT,
    message_id    TEXT,
    delete_at_utc INTEGER
  );
`);

// ── Helpers ─────────────────────────────────────────────────────────────────────

function seed(guildId) {
  db.prepare('INSERT OR IGNORE INTO server_settings (guild_id) VALUES (?)').run(guildId);

  for (const [name, category] of Object.entries(BOSSES)) {
    db.prepare('INSERT OR IGNORE INTO bosses (guild_id, name, category) VALUES (?, ?, ?)').run(guildId, name, category);
    for (const ch of GAME_CHANNELS) {
      db.prepare('INSERT OR IGNORE INTO boss_timers (guild_id, boss_name, game_channel, enabled) VALUES (?, ?, ?, 1)').run(guildId, name, ch);
    }
  }
}

async function getOrCreateRole(guild) {
  let role = guild.roles.cache.find(r => r.name === 'Boss Reminder');
  if (!role) {
    role = await guild.roles.create({
      name: 'Boss Reminder',
      colors: 0xFF0000,
      reason: 'Auto-created by Primfall Reminder for boss notifications',
    });
  }
  return role;
}

module.exports = { db, seed, getOrCreateRole };
