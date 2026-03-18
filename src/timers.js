const { EmbedBuilder } = require('discord.js');
const { db, getOrCreateRole } = require('./database');
const { renderStatusEmbed } = require('./ui');
const { BOSSES } = require('./config');

async function processAlertCleanups(client) {
    const now = Date.now();
    const expired = db.prepare('SELECT * FROM alert_messages WHERE delete_at_utc <= ?').all(now);

    for (const msg of expired) {
        try {
            const guild = await client.guilds.fetch(msg.guild_id).catch(() => null);
            if (guild) {
                const channel = await guild.channels.fetch(msg.channel_id).catch(() => null);
                if (channel) {
                    const fetchedMsg = await channel.messages.fetch(msg.message_id).catch(() => null);
                    if (fetchedMsg) {
                        await fetchedMsg.delete();
                    }
                }
            }
        } catch (err) {
            console.error(`Failed to cleanup alert message ${msg.message_id}:`, err);
        } finally {
            db.prepare('DELETE FROM alert_messages WHERE id = ?').run(msg.id);
        }
    }
}

async function checkTimers(client) {
    await processAlertCleanups(client);

    const now = Date.now();
    const timers = db.prepare('SELECT * FROM boss_timers WHERE enabled = 1 AND (next_spawn_utc IS NOT NULL OR override_utc IS NOT NULL)').all();
    
    for (const t of timers) {
        const targetMs = t.override_utc || t.next_spawn_utc;
        if (!targetMs) continue;

        const settings = db.prepare('SELECT * FROM server_settings WHERE guild_id = ?').get(t.guild_id);
        if (!settings || !settings.status_channel_id) continue;

        try {
            const guild = await client.guilds.fetch(t.guild_id).catch(()=>null);
            if (!guild) continue;
            
            const role = await getOrCreateRole(guild);
            const bossCat = BOSSES[t.boss_name];
            const channel = await guild.channels.fetch(settings.status_channel_id).catch(()=>null);
            if (!channel) continue;

            const reminderMin = settings.reminder_minutes || 0;
            const reminderMs = targetMs - (reminderMin * 60 * 1000);
            
            // Check pre-spawn reminder
            if (reminderMin > 0 && now >= reminderMs && now < targetMs && t.reminder_sent === 0) {
                const embed = new EmbedBuilder()
                    .setTitle(`⏳ ${t.boss_name} Spawns in ${reminderMin} minutes! ⏳`)
                    .setDescription(`Attention <@&${role.id}>!\nThe ${bossCat === 'world_boss' ? 'World Boss' : 'Event'} **${t.boss_name}** will spawn on **Channel ${t.game_channel}** in ${reminderMin} minutes!`)
                    .setColor('#FFA500');

                const alertMsg = await channel.send({ content: `<@&${role.id}>`, embeds: [embed] });
                db.prepare('UPDATE boss_timers SET reminder_sent = 1 WHERE id = ?').run(t.id);

                if (settings.alert_cleanup_minutes > 0) {
                    const deleteAt = now + (settings.alert_cleanup_minutes * 60 * 1000);
                    db.prepare('INSERT INTO alert_messages (guild_id, channel_id, message_id, delete_at_utc) VALUES (?, ?, ?, ?)').run(t.guild_id, channel.id, alertMsg.id, deleteAt);
                }
            }

            // Check actual spawn
            if (now >= targetMs) {
                const embed = new EmbedBuilder()
                    .setTitle(`🚨 ${t.boss_name} SPAWNING NOW! 🚨`)
                    .setDescription(`Attention <@&${role.id}>!\nThe ${bossCat === 'world_boss' ? 'World Boss' : 'Event'} **${t.boss_name}** is spawning on **Channel ${t.game_channel}**!`)
                    .setColor('#FF0000');

                const alertMsg = await channel.send({ content: `<@&${role.id}>`, embeds: [embed] });

                if (settings.alert_cleanup_minutes > 0) {
                    const deleteAt = now + (settings.alert_cleanup_minutes * 60 * 1000);
                    db.prepare('INSERT INTO alert_messages (guild_id, channel_id, message_id, delete_at_utc) VALUES (?, ?, ?, ?)').run(t.guild_id, channel.id, alertMsg.id, deleteAt);
                }

                db.prepare('UPDATE boss_timers SET override_utc = NULL, last_spawn_utc = ?, reminder_sent = 0 WHERE id = ?').run(now, t.id);

                if (t.interval_ms) {
                    db.prepare('UPDATE boss_timers SET next_spawn_utc = ? WHERE id = ?').run(now + t.interval_ms, t.id);
                } else {
                    db.prepare('UPDATE boss_timers SET next_spawn_utc = NULL WHERE id = ?').run(t.id);
                }
                
                await renderStatusEmbed(t.guild_id, t.boss_name, client);
            }
            
        } catch (err) {
            console.error(`Failed to process spawn/reminder for ${t.boss_name} Channel ${t.game_channel}`, err);
        }
    }
}

module.exports = { checkTimers };
