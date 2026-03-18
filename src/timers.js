const { EmbedBuilder } = require('discord.js');
const { db, getOrCreateRole } = require('./database');
const { renderStatusEmbed } = require('./ui');
const { BOSSES } = require('./config');

// ── Alert Cleanup ───────────────────────────────────────────────────────────────

async function cleanupExpiredAlerts(client) {
  const now = Date.now();
  const expired = db.prepare('SELECT * FROM alert_messages WHERE delete_at_utc <= ?').all(now);

  for (const row of expired) {
    try {
      const guild   = await client.guilds.fetch(row.guild_id).catch(() => null);
      const channel = guild && await guild.channels.fetch(row.channel_id).catch(() => null);
      const message = channel && await channel.messages.fetch(row.message_id).catch(() => null);
      if (message) await message.delete();
    } catch (_) {
      // message already gone — ignore
    } finally {
      db.prepare('DELETE FROM alert_messages WHERE id = ?').run(row.id);
    }
  }
}

// ── Timer Tick ──────────────────────────────────────────────────────────────────

async function tick(client) {
  await cleanupExpiredAlerts(client);

  const now = Date.now();
  const active = db.prepare(
    'SELECT * FROM boss_timers WHERE enabled = 1 AND (next_spawn_utc IS NOT NULL OR override_utc IS NOT NULL)'
  ).all();

  for (const timer of active) {
    const target = timer.override_utc || timer.next_spawn_utc;
    if (!target) continue;

    const settings = db.prepare('SELECT * FROM server_settings WHERE guild_id = ?').get(timer.guild_id);
    if (!settings?.status_channel_id) continue;

    try {
      const guild   = await client.guilds.fetch(timer.guild_id).catch(() => null);
      if (!guild) continue;
      const channel = await guild.channels.fetch(settings.status_channel_id).catch(() => null);
      if (!channel) continue;
      const role    = await getOrCreateRole(guild);

      const category = BOSSES[timer.boss_name];
      const label    = category === 'world_boss' ? 'World Boss' : 'Event';

      // Pre-spawn reminder
      const reminderMs = settings.reminder_minutes * 60_000;
      if (reminderMs > 0 && now >= target - reminderMs && now < target && !timer.reminder_sent) {
        const timestamp = `<t:${Math.floor(target / 1000)}:R>`;
        const content = `⚠️ **${timer.boss_name} ${timer.game_channel}** is spawning **${timestamp}**! <@&${role.id}>`;

        const sent = await channel.send(content);
        db.prepare('UPDATE boss_timers SET reminder_sent = 1 WHERE id = ?').run(timer.id);
        scheduleCleanup(settings, timer.guild_id, channel.id, sent.id, now);
      }

      // Spawn
      if (now >= target) {
        const content = `🚨 **${timer.boss_name} ${timer.game_channel}** is spawning **NOW**! <@&${role.id}>`;

        const sent = await channel.send(content);
        scheduleCleanup(settings, timer.guild_id, channel.id, sent.id, now);

        db.prepare('UPDATE boss_timers SET override_utc = NULL, last_spawn_utc = ?, reminder_sent = 0 WHERE id = ?').run(now, timer.id);

        if (timer.interval_ms) {
          db.prepare('UPDATE boss_timers SET next_spawn_utc = ? WHERE id = ?').run(now + timer.interval_ms, timer.id);
        } else {
          db.prepare('UPDATE boss_timers SET next_spawn_utc = NULL WHERE id = ?').run(timer.id);
        }

        await renderStatusEmbed(timer.guild_id, timer.boss_name, client);
      }
    } catch (err) {
      console.error(`[timers] ${timer.boss_name} Ch${timer.game_channel}:`, err.message);
    }
  }
}

function scheduleCleanup(settings, guildId, channelId, messageId, now) {
  if (settings.alert_cleanup_minutes > 0) {
    const deleteAt = now + settings.alert_cleanup_minutes * 60_000;
    db.prepare('INSERT INTO alert_messages (guild_id, channel_id, message_id, delete_at_utc) VALUES (?, ?, ?, ?)').run(guildId, channelId, messageId, deleteAt);
  }
}

module.exports = { tick };
