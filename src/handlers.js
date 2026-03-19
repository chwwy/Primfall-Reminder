const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const moment = require('moment-timezone');
const { db, seed, getOrCreateRole } = require('./database');
const { renderStatusEmbed, renderAllStatusEmbeds, updateControlPanels } = require('./ui');
const { THEME_COLOR, TIMEZONE_MAP, BOSS_ORDER } = require('./config');

// In-memory selection state per guild (for the timer panel dropdowns)
const selections = {};

function getSelection(guildId) {
  if (!selections[guildId]) selections[guildId] = { boss: null, channel: null };
  return selections[guildId];
}

function resolveTimezone(input) {
  return TIMEZONE_MAP[input.toUpperCase()] || 'UTC';
}

function parseSpawnTime(timeStr, tzName, dateStr) {
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;

  const now = moment().tz(tzName);
  let target;

  if (dateStr) {
    const parts = dateStr.split(/[-/]/).map(Number);
    if (parts.length < 2) return null;
    const [month, day, yearStr] = parts;
    let year = yearStr || now.year();
    if (year < 100) year += 2000;

    target = moment.tz(
      { year, month: month - 1, date: day, hour: hh, minute: mm, second: ss || 0 },
      tzName,
    );
  } else {
    target = moment.tz(
      { year: now.year(), month: now.month(), date: now.date(), hour: hh, minute: mm, second: ss || 0 },
      tzName,
    );
    if (target.isBefore(now)) target.add(1, 'day');
  }

  return target.valueOf();
}

// ── Slash Commands ──────────────────────────────────────────────────────────────

async function onCommand(interaction) {
  const { commandName, guildId } = interaction;

  switch (commandName) {
    case 'setup':    return cmdSetup(interaction, guildId);
    case 'setstatus': return cmdSetStatus(interaction, guildId);
    case 'setboss':   return cmdSetBoss(interaction, guildId);
    case 'override':  return cmdOverride(interaction, guildId);
    case 'canceltimer': return cmdCancelTimer(interaction, guildId);
    case 'status':    return cmdStatus(interaction, guildId);
  }
}

async function cmdSetup(interaction, guildId) {
  await interaction.deferReply({ ephemeral: true });

  const toggleCh  = interaction.options.getChannel('notifications_toggle');
  const panelCh   = interaction.options.getChannel('control_panel');
  const statusCh  = interaction.options.getChannel('status_channel');

  const required = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ManageMessages'];
  for (const ch of [toggleCh, panelCh, statusCh]) {
    if (!ch.permissionsFor(interaction.guild.members.me).has(required)) {
      return interaction.editReply(`Missing permissions in <#${ch.id}>.`);
    }
  }

  // Wipe previously tracked messages
  const oldSettings = db.prepare('SELECT * FROM server_settings WHERE guild_id = ?').get(guildId);
  if (oldSettings) {
    const toDelete = [
      { ch: oldSettings.toggle_channel_id, msg: oldSettings.toggle_message_id },
      { ch: oldSettings.control_panel_channel_id, msg: oldSettings.control_panel_message_id },
      { ch: oldSettings.control_panel_channel_id, msg: oldSettings.timer_panel_message_id }
    ];
    const oldBosses = db.prepare('SELECT status_message_id FROM bosses WHERE guild_id = ? AND status_message_id IS NOT NULL').all(guildId);
    for (const b of oldBosses) toDelete.push({ ch: oldSettings.status_channel_id, msg: b.status_message_id });

    for (const item of toDelete) {
      if (!item.ch || !item.msg) continue;
      try {
        const chan = await interaction.guild.channels.fetch(item.ch).catch(() => null);
        if (chan) {
          const m = await chan.messages.fetch(item.msg).catch(() => null);
          if (m) await m.delete().catch(() => null);
        }
      } catch (err) {}
    }
  }

  await seed(guildId);

  db.prepare(`UPDATE server_settings SET toggle_channel_id = ?, control_panel_channel_id = ?, status_channel_id = ? WHERE guild_id = ?`)
    .run(toggleCh.id, panelCh.id, statusCh.id, guildId);

  // Notification toggle button
  const embed = new EmbedBuilder()
    .setTitle('Boss Notifications')
    .setDescription('Toggle the **Boss Reminder** role to get pinged for World Boss and Zenith Conquest spawns.')
    .setColor(THEME_COLOR);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('toggle_role').setLabel('🔔 Toggle Notifications').setStyle(ButtonStyle.Primary),
  );

  const msg = await toggleCh.send({ embeds: [embed], components: [row] });
  db.prepare('UPDATE server_settings SET toggle_message_id = ? WHERE guild_id = ?').run(msg.id, guildId);

  await updateControlPanels(guildId, interaction.client);
  db.prepare('UPDATE bosses SET status_message_id = NULL WHERE guild_id = ?').run(guildId);
  await renderAllStatusEmbeds(guildId, interaction.client);

  await interaction.editReply('Setup complete.');
}

async function cmdSetStatus(interaction, guildId) {
  await interaction.deferReply({ ephemeral: true });
  const ch = interaction.options.getChannel('channel');

  const oldSettings = db.prepare('SELECT * FROM server_settings WHERE guild_id = ?').get(guildId);
  if (oldSettings && oldSettings.status_channel_id) {
    const oldBosses = db.prepare('SELECT status_message_id FROM bosses WHERE guild_id = ? AND status_message_id IS NOT NULL').all(guildId);
    for (const b of oldBosses) {
      try {
        const chan = await interaction.guild.channels.fetch(oldSettings.status_channel_id).catch(() => null);
        if (chan) {
          const m = await chan.messages.fetch(b.status_message_id).catch(() => null);
          if (m) await m.delete().catch(() => null);
        }
      } catch (err) {}
    }
  }

  await seed(guildId);
  db.prepare('UPDATE server_settings SET status_channel_id = ? WHERE guild_id = ?').run(ch.id, guildId);
  db.prepare('UPDATE bosses SET status_message_id = NULL WHERE guild_id = ?').run(guildId);

  await renderAllStatusEmbeds(guildId, interaction.client);
  await interaction.editReply(`Status channel set to <#${ch.id}>.`);
}

async function cmdSetBoss(interaction, guildId) {
  const boss    = interaction.options.getString('boss_name');
  const channel = interaction.options.getString('channel');
  const hours   = interaction.options.getInteger('interval_hours');

  await seed(guildId);

  const ms   = hours * 3_600_000;
  const next = Date.now() + ms;

  db.prepare('UPDATE boss_timers SET interval_ms = ?, next_spawn_utc = ?, reminder_sent = 0 WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').run(ms, next, guildId, boss, channel);
  await renderStatusEmbed(guildId, boss, interaction.client);
  await interaction.reply({ content: `**${boss}** Ch${channel} → every ${hours}h.`, ephemeral: true });
}

async function cmdOverride(interaction, guildId) {
  const boss    = interaction.options.getString('boss_name');
  const channel = interaction.options.getString('channel');
  const time    = interaction.options.getString('spawn_time');
  const tz      = interaction.options.getString('timezone');
  const dateStr = interaction.options.getString('spawn_date');

  await seed(guildId);

  const tzName   = resolveTimezone(tz);
  const spawnMs  = parseSpawnTime(time, tzName, dateStr);
  if (!spawnMs) return interaction.reply({ content: 'Invalid time format.', ephemeral: true });

  const row  = db.prepare('SELECT interval_ms FROM boss_timers WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').get(guildId, boss, channel);
  const next = row?.interval_ms ? spawnMs + 3_600_000 + row.interval_ms : null;

  db.prepare('UPDATE boss_timers SET override_utc = ?, last_spawn_utc = ?, next_spawn_utc = COALESCE(?, next_spawn_utc), reminder_sent = 0 WHERE guild_id = ? AND boss_name = ? AND game_channel = ?')
    .run(spawnMs, spawnMs, next, guildId, boss, channel);

  await renderStatusEmbed(guildId, boss, interaction.client);
  await interaction.reply({ content: `**${boss}** Ch${channel} overridden to ${time} ${tz}.`, ephemeral: true });
}

async function cmdCancelTimer(interaction, guildId) {
  const boss    = interaction.options.getString('boss_name');
  const channel = interaction.options.getString('channel');

  db.prepare('UPDATE boss_timers SET override_utc = NULL, interval_ms = NULL, next_spawn_utc = NULL, reminder_sent = 0 WHERE guild_id = ? AND boss_name = ? AND game_channel = ?')
    .run(guildId, boss, channel);

  await renderStatusEmbed(guildId, boss, interaction.client);
  await interaction.reply({ content: `Timers cancelled for **${boss}** Ch${channel}.`, ephemeral: true });
}

async function cmdStatus(interaction, guildId) {
  const timers = db.prepare('SELECT * FROM boss_timers WHERE guild_id = ?').all(guildId);
  if (!timers.length) return interaction.reply({ content: 'Nothing tracked yet — run /setup first.', ephemeral: true });

  // Sort by custom boss order, then channel
  timers.sort((a, b) => {
    const aOrder = BOSS_ORDER.indexOf(a.boss_name);
    const bOrder = BOSS_ORDER.indexOf(b.boss_name);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a.game_channel).localeCompare(String(b.game_channel));
  });

  const now  = Date.now();
  const lines = timers
    .filter(t => BOSS_ORDER.includes(t.boss_name))
    .map(t => {
      const icon   = t.enabled ? '✅' : '❌';
    const target = t.override_utc || t.next_spawn_utc;
    const next   = target ? (target <= now ? 'Now' : `<t:${Math.floor(target / 1000)}:R>`) : '—';
    return `${icon} **${t.boss_name}** Ch${t.game_channel} → ${next}`;
  });

  const embed = new EmbedBuilder().setTitle('Timer Summary').setColor(THEME_COLOR).setDescription(lines.join('\n'));
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ── Buttons ─────────────────────────────────────────────────────────────────────

async function onButton(interaction) {
  const id = interaction.customId;

  if (id === 'toggle_role') {
    await interaction.deferReply({ ephemeral: true });
    const role = await getOrCreateRole(interaction.guild);
    const has  = interaction.member.roles.cache.has(role.id);

    if (has) {
      await interaction.member.roles.remove(role);
      return interaction.editReply('🔕 Notifications off.');
    }
    await interaction.member.roles.add(role);
    return interaction.editReply('🔔 Notifications on.');
  }

  if (id === 'cp_set_reminder') return showModal(interaction, 'modal_global_reminder', 'Pre-Spawn Reminder', 'minutes', 'Minutes before spawn');
  if (id === 'cp_set_cleanup')  return showModal(interaction, 'modal_global_cleanup',  'Alert Cleanup',       'minutes', 'Minutes to keep alerts');

  // Timer panel buttons require a boss + channel selection
  const state = getSelection(interaction.guildId);
  if (!state.boss || !state.channel) {
    return interaction.reply({ content: 'Select a boss and channel first.', ephemeral: true });
  }

  if (id === 'cp_set_interval') {
    return showModal(interaction, `modal_interval_${state.boss}_${state.channel}`, `Interval — ${state.boss} Ch${state.channel}`, 'interval_hours', 'Interval in hours');
  }

  if (id === 'cp_set_override') {
    const modal = new ModalBuilder()
      .setCustomId(`modal_override_${state.boss}_${state.channel}`)
      .setTitle(`Spawn Time — ${state.boss} Ch${state.channel}`)
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawn_time').setLabel('24h time (e.g. 15:00)').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('timezone').setLabel('Timezone (ET / CT / MT / PT)').setStyle(TextInputStyle.Short).setRequired(true).setValue('ET')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawn_date').setLabel('Date MM/DD/YYYY (Optional)').setStyle(TextInputStyle.Short).setRequired(false)),
      );
    return interaction.showModal(modal);
  }

  if (id === 'cp_cancel_timer') {
    db.prepare('UPDATE boss_timers SET override_utc = NULL, interval_ms = NULL, next_spawn_utc = NULL, reminder_sent = 0 WHERE guild_id = ? AND boss_name = ? AND game_channel = ?')
      .run(interaction.guildId, state.boss, state.channel);
    await renderStatusEmbed(interaction.guildId, state.boss, interaction.client);
    return interaction.reply({ content: `Cancelled **${state.boss}** Ch${state.channel}.`, ephemeral: true });
  }
}

function showModal(interaction, customId, title, fieldId, label) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(fieldId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true)),
  );
  return interaction.showModal(modal);
}

// ── Select Menus ────────────────────────────────────────────────────────────────

async function onSelectMenu(interaction) {
  const id = interaction.customId;
  const state = getSelection(interaction.guildId);

  if (id === 'cp_toggle_select') {
    const boss = interaction.values[0].replace('toggle_', '');
    db.prepare('UPDATE boss_timers SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE guild_id = ? AND boss_name = ?').run(interaction.guildId, boss);
    await interaction.deferUpdate();
    return updateControlPanels(interaction.guildId, interaction.client);
  }

  if (id === 'cp_timer_boss') {
    state.boss = interaction.values[0];
    await interaction.deferUpdate();
    return interaction.followUp({ content: `Boss: **${state.boss}**. Now pick a channel.`, ephemeral: true });
  }

  if (id === 'cp_timer_channel') {
    state.channel = interaction.values[0];
    await interaction.deferUpdate();
    return interaction.followUp({ content: `Channel: **${state.channel}**. Use the buttons below.`, ephemeral: true });
  }
}

// ── Modal Submits ───────────────────────────────────────────────────────────────

async function onModalSubmit(interaction) {
  const id = interaction.customId;

  if (id === 'modal_global_reminder') {
    const val = parseInt(interaction.fields.getTextInputValue('minutes'), 10);
    if (isNaN(val)) return interaction.reply({ content: 'Enter a number.', ephemeral: true });
    db.prepare('UPDATE server_settings SET reminder_minutes = ? WHERE guild_id = ?').run(val, interaction.guildId);
    await interaction.deferUpdate();
    await updateControlPanels(interaction.guildId, interaction.client);
    return interaction.followUp({ content: `Reminder set to ${val} min.`, ephemeral: true });
  }

  if (id === 'modal_global_cleanup') {
    const val = parseInt(interaction.fields.getTextInputValue('minutes'), 10);
    if (isNaN(val)) return interaction.reply({ content: 'Enter a number.', ephemeral: true });
    db.prepare('UPDATE server_settings SET alert_cleanup_minutes = ? WHERE guild_id = ?').run(val, interaction.guildId);
    await interaction.deferUpdate();
    await updateControlPanels(interaction.guildId, interaction.client);
    return interaction.followUp({ content: `Cleanup set to ${val} min.`, ephemeral: true });
  }

  if (id.startsWith('modal_interval_')) {
    const { boss, channel } = parseModalId(id);
    const hours = parseFloat(interaction.fields.getTextInputValue('interval_hours'));
    if (isNaN(hours)) return interaction.reply({ content: 'Enter a number.', ephemeral: true });

    const ms  = hours * 3_600_000;
    const next = Date.now() + ms;

    db.prepare('UPDATE boss_timers SET interval_ms = ?, next_spawn_utc = ?, reminder_sent = 0 WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').run(ms, next, interaction.guildId, boss, channel);
    await interaction.deferUpdate();
    await renderStatusEmbed(interaction.guildId, boss, interaction.client);
    return interaction.followUp({ content: `**${boss}** Ch${channel} → every ${hours}h.`, ephemeral: true });
  }

  if (id.startsWith('modal_override_')) {
    const { boss, channel } = parseModalId(id);
    const timeStr = interaction.fields.getTextInputValue('spawn_time');
    const tzName  = resolveTimezone(interaction.fields.getTextInputValue('timezone'));
    const dateStr = interaction.fields.fields.has('spawn_date') ? interaction.fields.getTextInputValue('spawn_date') : null;
    const spawnMs = parseSpawnTime(timeStr, tzName, dateStr);
    if (!spawnMs) return interaction.reply({ content: 'Invalid time.', ephemeral: true });

    const row  = db.prepare('SELECT interval_ms FROM boss_timers WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').get(interaction.guildId, boss, channel);
    const next = row?.interval_ms ? spawnMs + 3_600_000 + row.interval_ms : null;

    db.prepare('UPDATE boss_timers SET override_utc = ?, last_spawn_utc = ?, next_spawn_utc = COALESCE(?, next_spawn_utc), reminder_sent = 0 WHERE guild_id = ? AND boss_name = ? AND game_channel = ?')
      .run(spawnMs, spawnMs, next, interaction.guildId, boss, channel);

    await interaction.deferUpdate();
    await renderStatusEmbed(interaction.guildId, boss, interaction.client);
    return interaction.followUp({ content: `**${boss}** Ch${channel} → ${timeStr}.`, ephemeral: true });
  }
}

function parseModalId(customId) {
  const parts   = customId.split('_');
  const channel = parts.pop();
  const boss    = parts.slice(2).join('_');
  return { boss, channel };
}

// ─────────────────────────────────────────────────────────────────────────────────

module.exports = { onCommand, onButton, onSelectMenu, onModalSubmit };
