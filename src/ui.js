const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, AttachmentBuilder,
} = require('discord.js');
const { db } = require('./database');
const { BOSSES, GAME_CHANNELS, THEME_COLOR } = require('./config');

// ── Helpers ─────────────────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/['\s]+/g, '-');
}

function discordTimestamp(ms, style = 'F') {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function formatSpawnField(rows, field) {
  return GAME_CHANNELS.map(ch => {
    const row = rows.find(r => r.game_channel === ch) || {};

    if (field === 'last') {
      if (!row.last_spawn_utc) return `**Ch ${ch}:** —`;
      return `**Ch ${ch}:** ${discordTimestamp(row.last_spawn_utc)} (${discordTimestamp(row.last_spawn_utc, 'R')})`;
    }

    const target = row.override_utc || row.next_spawn_utc;
    if (!target) return `**Ch ${ch}:** —`;
    if (target <= Date.now()) return `**Ch ${ch}:** Spawning…`;
    return `**Ch ${ch}:** ${discordTimestamp(target)} (${discordTimestamp(target, 'R')})`;
  }).join('\n');
}

// ── Status Embeds ───────────────────────────────────────────────────────────────

async function renderStatusEmbed(guildId, bossName, client) {
  const settings = db.prepare('SELECT status_channel_id FROM server_settings WHERE guild_id = ?').get(guildId);
  if (!settings?.status_channel_id) return;

  const guild   = await client.guilds.fetch(guildId).catch(() => null);
  const channel = guild && await guild.channels.fetch(settings.status_channel_id).catch(() => null);
  if (!channel) return;

  const boss = db.prepare('SELECT status_message_id FROM bosses WHERE guild_id = ? AND name = ?').get(guildId, bossName);
  if (!boss) return;

  const timers = db.prepare('SELECT * FROM boss_timers WHERE guild_id = ? AND boss_name = ? ORDER BY game_channel ASC').all(guildId, bossName);

  const slug = slugify(bossName);
  const file = new AttachmentBuilder(`./assets/bosses/${slug}.png`, { name: `${slug}.png` });

  const embed = new EmbedBuilder()
    .setTitle(`${bossName}`)
    .setThumbnail(`attachment://${slug}.png`)
    .setColor(THEME_COLOR)
    .addFields(
      { name: 'Last Spawn',  value: formatSpawnField(timers, 'last'), inline: true },
      { name: 'Next Spawn',  value: formatSpawnField(timers, 'next'), inline: true },
    )
    .setFooter({ text: 'Primfall Reminder' });

  if (boss.status_message_id) {
    try {
      const msg = await channel.messages.fetch(boss.status_message_id);
      await msg.edit({ embeds: [embed], files: [file] });
      return;
    } catch (_) { /* message was deleted, re-send below */ }
  }

  const sent = await channel.send({ embeds: [embed], files: [file] });
  db.prepare('UPDATE bosses SET status_message_id = ? WHERE guild_id = ? AND name = ?').run(sent.id, guildId, bossName);
}

async function renderAllStatusEmbeds(guildId, client) {
  for (const name of Object.keys(BOSSES)) {
    await renderStatusEmbed(guildId, name, client);
  }
}

// ── Control Panels ──────────────────────────────────────────────────────────────

async function updateControlPanels(guildId, client) {
  const settings = db.prepare('SELECT * FROM server_settings WHERE guild_id = ?').get(guildId);
  if (!settings?.control_panel_channel_id) return;

  const guild   = await client.guilds.fetch(guildId).catch(() => null);
  const channel = guild && await guild.channels.fetch(settings.control_panel_channel_id).catch(() => null);
  if (!channel) return;

  try {
    await postSettingsPanel(channel, settings, guildId);
    await postTimerPanel(channel, settings, guildId);
  } catch (err) {
    console.error('[ui] Control panel update failed:', err);
  }
}

async function postSettingsPanel(channel, settings, guildId) {
  const counts = db.prepare(
    'SELECT boss_name, SUM(enabled) as total FROM boss_timers WHERE guild_id = ? GROUP BY boss_name'
  ).all(guildId);

  const enabled = {};
  for (const c of counts) enabled[c.boss_name] = c.total > 0;

  const statusList = Object.keys(BOSSES)
    .map(b => `${enabled[b] ? '✅' : '❌'}  ${b}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('⚙️  Settings & Boss Toggles')
    .setColor(THEME_COLOR)
    .addFields(
      { name: 'Pre-Spawn Reminder', value: settings.reminder_minutes ? `${settings.reminder_minutes} min` : 'Off', inline: true },
      { name: 'Alert Auto-Cleanup',  value: settings.alert_cleanup_minutes ? `${settings.alert_cleanup_minutes} min` : 'Off', inline: true },
      { name: '\u200B', value: statusList },
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cp_set_reminder').setLabel('Pre-Spawn Reminder').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cp_set_cleanup').setLabel('Alert Cleanup').setStyle(ButtonStyle.Secondary),
  );

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cp_toggle_select')
      .setPlaceholder('Toggle a boss on/off…')
      .addOptions(Object.keys(BOSSES).map(b => ({
        label: b,
        description: enabled[b] ? 'Enabled' : 'Disabled',
        value: `toggle_${b}`,
      }))),
  );

  const payload = { embeds: [embed], components: [buttons, menu] };
  await upsertMessage(channel, settings.control_panel_message_id, payload, (id) => {
    db.prepare('UPDATE server_settings SET control_panel_message_id = ? WHERE guild_id = ?').run(id, guildId);
  });
}

async function postTimerPanel(channel, settings, guildId) {
  const embed = new EmbedBuilder()
    .setTitle('⏱️  Schedules & Timers')
    .setColor(THEME_COLOR)
    .setDescription('Select a boss and channel, then use the action buttons.');

  const bossMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cp_timer_boss')
      .setPlaceholder('1 — Select a boss')
      .addOptions(Object.keys(BOSSES).map(b => ({ label: b, value: b }))),
  );

  const channelMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cp_timer_channel')
      .setPlaceholder('2 — Select a channel')
      .addOptions(GAME_CHANNELS.map(c => ({ label: `Channel ${c}`, value: c }))),
  );

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cp_set_interval').setLabel('Set Interval').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cp_set_override').setLabel('Set Spawn Time').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cp_cancel_timer').setLabel('Cancel Timer').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [embed], components: [bossMenu, channelMenu, actions] };
  await upsertMessage(channel, settings.timer_panel_message_id, payload, (id) => {
    db.prepare('UPDATE server_settings SET timer_panel_message_id = ? WHERE guild_id = ?').run(id, guildId);
  });
}

async function upsertMessage(channel, existingId, payload, onNew) {
  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit(payload);
      return;
    } catch (_) { /* deleted or missing — fall through to send */ }
  }
  const sent = await channel.send(payload);
  onNew(sent.id);
}

// ─────────────────────────────────────────────────────────────────────────────────

module.exports = { renderStatusEmbed, renderAllStatusEmbeds, updateControlPanels };
