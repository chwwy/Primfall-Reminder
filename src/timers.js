const { EmbedBuilder } = require('discord.js');
const { db, getOrCreateRole } = require('./database');
const { renderStatusEmbed } = require('./ui');


// ── Alert Cleanup ───────────────────────────────────────────────────────────────

async function cleanupExpiredAlerts(client) {
  const now = Date.now();
  const expired = db.prepare('SELECT * FROM alert_messages WHERE delete_at_utc <= ?').all(now);

  for (const row of expired) {
    let successOrGone = false;

    try {
      const channel = await client.channels.fetch(row.channel_id);
      const message = await channel.messages.fetch(row.message_id);
      await message.delete();
      successOrGone = true;
    } catch (err) {
      // 10008 = Unknown Message, 10003 = Unknown Channel, 50001 = Missing Access (bot kicked from channel)
      if (err.code === 10008 || err.code === 10003 || err.code === 50001) {
        successOrGone = true;
      } else {
        console.error(`[cleanup] Keeping row for ${row.message_id} due to API error:`, err.message);
      }
    }

    if (successOrGone) {
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

  const pendingActions = {};

  for (const timer of active) {
    const target = timer.override_utc || timer.next_spawn_utc;
    if (!target) continue;

    const settings = db.prepare('SELECT * FROM server_settings WHERE guild_id = ?').get(timer.guild_id);
    if (!settings?.status_channel_id) continue;

    const reminderMs = settings.reminder_minutes * 60_000;
    let type = null;

    if (now >= target) {
      type = 'spawn';
    } else if (reminderMs > 0 && now >= target - reminderMs && now < target && !timer.reminder_sent) {
      type = 'reminder';
    }

    if (!type) continue;

    const key = `${timer.guild_id}_${target}_${type}`;
    if (!pendingActions[key]) {
      pendingActions[key] = {
        guildId: timer.guild_id,
        target,
        type,
        settings,
        bossMap: {},
        timers: []
      };
    }
    
    if (!pendingActions[key].bossMap[timer.boss_name]) {
      pendingActions[key].bossMap[timer.boss_name] = [];
    }
    pendingActions[key].bossMap[timer.boss_name].push(timer.game_channel);
    pendingActions[key].timers.push(timer);
  }

  for (const group of Object.values(pendingActions)) {
    try {
      const guild = await client.guilds.fetch(group.guildId).catch(() => null);
      if (!guild) continue;
      const channel = await guild.channels.fetch(group.settings.status_channel_id).catch(() => null);
      if (!channel) continue;
      const role = await getOrCreateRole(guild);

      const bossEntries = [];
      for (const b of Object.keys(group.bossMap).sort()) {
        const sortedChans = group.bossMap[b].sort((a, b) => a.localeCompare(b));
        const chansLabel = sortedChans.length > 1 ? `Ch ${sortedChans.join(', ')}` : `Ch ${sortedChans[0]}`;
        bossEntries.push(`**${b}** ${chansLabel}`);
      }

      const combinedLabel = bossEntries.join(' | ');
      const verb = group.timers.length > 1 ? 'are' : 'is';

      if (group.type === 'reminder') {
        const timestamp = `<t:${Math.floor(group.target / 1000)}:R>`;
        const content = `⚠️ ${combinedLabel} ${verb} spawning **${timestamp}**! <@&${role.id}>`;

        const sent = await channel.send(content);
        scheduleCleanup(group.settings, group.guildId, channel.id, sent.id, now);

        for (const t of group.timers) {
          db.prepare('UPDATE boss_timers SET reminder_sent = 1 WHERE id = ?').run(t.id);
        }
      } else if (group.type === 'spawn') {
        const content = `🚨 ${combinedLabel} ${verb} spawning **NOW**! <@&${role.id}>`;

        const sent = await channel.send(content);
        scheduleCleanup(group.settings, group.guildId, channel.id, sent.id, now);

        for (const t of group.timers) {
          db.prepare('UPDATE boss_timers SET override_utc = NULL, last_spawn_utc = ?, reminder_sent = 0 WHERE id = ?').run(now, t.id);
          if (t.interval_ms) {
            db.prepare('UPDATE boss_timers SET next_spawn_utc = ? WHERE id = ?').run(now + 3_600_000 + t.interval_ms, t.id);
          } else {
            db.prepare('UPDATE boss_timers SET next_spawn_utc = NULL WHERE id = ?').run(t.id);
          }
        }
        // Update embeds for ALL bosses that spawned
        const uniqueBosses = Object.keys(group.bossMap);
        for (const b of uniqueBosses) {
          await renderStatusEmbed(group.guildId, b, client);
        }
      }
    } catch (err) {
      console.error(`[timers] Grouped action error:`, err.message);
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
