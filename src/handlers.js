const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const moment = require('moment-timezone');
const { db, seedDatabase, getOrCreateRole } = require('./database');
const { renderStatusEmbed, renderAllStatusEmbeds, updateControlPanels } = require('./ui');
const { THEME_COLOR } = require('./config');

async function handleCommand(interaction) {
    const { commandName } = interaction;
    const guildId = interaction.guildId;

    if (commandName === 'setup') {
        await interaction.deferReply({ ephemeral: true });
        
        const notificationsToggle = interaction.options.getChannel('notifications_toggle');
        const controlPanel = interaction.options.getChannel('control_panel');
        const statusChannel = interaction.options.getChannel('status_channel');

        const channels = [notificationsToggle, controlPanel, statusChannel];
        for (const ch of channels) {
            const perms = ch.permissionsFor(interaction.guild.members.me);
            if (!perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ManageMessages'])) {
                return interaction.editReply(`I need View Channel, Send Messages, Embed Links, Attach Files, and Manage Messages in <#${ch.id}>.`);
            }
        }

        const wipeChannels = [notificationsToggle, controlPanel, statusChannel];
        for (const ch of wipeChannels) {
            try {
                const fetched = await ch.messages.fetch({ limit: 100 });
                if (fetched.size > 0) {
                    await ch.bulkDelete(fetched, true);
                }
            } catch (err) {}
        }

        await seedDatabase(guildId);

        db.prepare(`
            UPDATE server_settings SET
                toggle_channel_id = ?, control_panel_channel_id = ?, 
                status_channel_id = ?
            WHERE guild_id = ?
        `).run(notificationsToggle.id, controlPanel.id, statusChannel.id, guildId);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_role').setLabel('🔔 Toggle Notifications').setStyle(ButtonStyle.Primary)
        );

        const embedToggle = new EmbedBuilder()
            .setTitle('Quinfall Boss Notifications')
            .setDescription('Click the button below to toggle the **Boss Reminder** role.\nUsers with this role will be pinged whenever a World Boss or Zenith Conquest spawns.')
            .setColor(THEME_COLOR);
            
        const toggleMsg = await notificationsToggle.send({ embeds: [embedToggle], components: [row] });
        db.prepare('UPDATE server_settings SET toggle_message_id = ? WHERE guild_id = ?').run(toggleMsg.id, guildId);

        await updateControlPanels(guildId, interaction.client);
        
        db.prepare('UPDATE bosses SET status_message_id = NULL WHERE guild_id = ?').run(guildId);
        await renderAllStatusEmbeds(guildId, interaction.client);
        
        await interaction.editReply('Setup complete! Channels configured and persistent panels published.');

    } else if (commandName === 'setstatus') {
        await interaction.deferReply({ ephemeral: true });
        const channel = interaction.options.getChannel('channel');

        await seedDatabase(guildId);
        db.prepare('UPDATE server_settings SET status_channel_id = ? WHERE guild_id = ?').run(channel.id, guildId);
        db.prepare('UPDATE bosses SET status_message_id = NULL WHERE guild_id = ?').run(guildId);
        
        try {
            const fetched = await channel.messages.fetch({ limit: 100 });
            if (fetched.size > 0) await channel.bulkDelete(fetched, true);
        } catch (err) {}

        await renderAllStatusEmbeds(guildId, interaction.client);
        await interaction.editReply(`Status channel successfully mapped to <#${channel.id}>. Embedded profiles posted.`);

    } else if (commandName === 'setboss') {
        const bossName = interaction.options.getString('boss_name');
        const channel = interaction.options.getString('channel');
        const intervalHours = interaction.options.getInteger('interval_hours');
        
        await seedDatabase(guildId);
        const intervalMs = intervalHours * 60 * 60 * 1000;
        
        const row = db.prepare('SELECT last_spawn_utc FROM boss_timers WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').get(guildId, bossName, channel);
        const nextSpawn = row && row.last_spawn_utc ? row.last_spawn_utc + intervalMs : Date.now() + intervalMs;
        db.prepare('UPDATE boss_timers SET interval_ms = ?, next_spawn_utc = ? WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').run(intervalMs, nextSpawn, guildId, bossName, channel);

        await renderStatusEmbed(guildId, bossName, interaction.client);
        await interaction.reply({ content: `Successfully configured **${bossName}** on Channel **${channel}** to repeat every ${intervalHours} hours.`, ephemeral: true });

    } else if (commandName === 'override') {
        const bossName = interaction.options.getString('boss_name');
        const channel = interaction.options.getString('channel');
        const timeStr = interaction.options.getString('spawn_time');
        const tz = interaction.options.getString('timezone');
        
        await seedDatabase(guildId);

        let tzName = 'UTC';
        if (tz === 'ET') tzName = 'America/New_York';
        else if (tz === 'CT') tzName = 'America/Chicago';
        else if (tz === 'MT') tzName = 'America/Denver';
        else if (tz === 'PT') tzName = 'America/Los_Angeles';

        const [hh, mm, ss] = timeStr.split(':').map(Number);
        if (isNaN(hh) || isNaN(mm)) return interaction.reply({ content: 'Invalid time format.', ephemeral: true });
        
        const nowMoment = moment().tz(tzName);
        let targetMoment = moment.tz({ year: nowMoment.year(), month: nowMoment.month(), date: nowMoment.date(), hour: hh, minute: mm, second: ss || 0 }, tzName);
        if (targetMoment.isBefore(nowMoment)) targetMoment.add(1, 'days');

        const overrideSpawn = targetMoment.valueOf();
        const row = db.prepare('SELECT interval_ms FROM boss_timers WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').get(guildId, bossName, channel);
        const nextSpawnUpdate = row && row.interval_ms ? overrideSpawn + row.interval_ms : null;

        db.prepare('UPDATE boss_timers SET override_utc = ?, last_spawn_utc = ?, next_spawn_utc = COALESCE(?, next_spawn_utc) WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').run(overrideSpawn, overrideSpawn, nextSpawnUpdate, guildId, bossName, channel);

        await renderStatusEmbed(guildId, bossName, interaction.client);
        await interaction.reply({ content: `Successfully overridden **${bossName} (Channel ${channel})** time to **${timeStr} ${tz}** (<t:${Math.floor(overrideSpawn/1000)}:R>).`, ephemeral: true });

    } else if (commandName === 'canceltimer') {
        const bossName = interaction.options.getString('boss_name');
        const channel = interaction.options.getString('channel');
        db.prepare('UPDATE boss_timers SET override_utc = NULL, interval_ms = NULL, next_spawn_utc = NULL, reminder_sent = 0 WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').run(guildId, bossName, channel);
        
        await renderStatusEmbed(guildId, bossName, interaction.client);
        await interaction.reply({ content: `Cancelled active timers for **${bossName}** on Channel **${channel}**.`, ephemeral: true });

    } else if (commandName === 'setreminder' || commandName === 'setalertcleanup') {
        // Redundant safely covered by UI
        await interaction.reply({ content: `Use the UI buttons to configure these!`, ephemeral: true });

    } else if (commandName === 'status') {
        const timers = db.prepare('SELECT * FROM boss_timers WHERE guild_id = ?').all(guildId);
        if (!timers.length) return interaction.reply({ content: 'No boss tracking found. Run /setup first.', ephemeral: true });

        const embed = new EmbedBuilder().setTitle('All Bosses Summarized').setColor(THEME_COLOR);

        let desc = '';
        const now = Date.now();
        for (const t of timers) {
            const statusIcon = t.enabled ? '✅' : '❌';
            const targetMs = t.override_utc || t.next_spawn_utc;
            let nextText = targetMs ? (targetMs <= now ? 'Spawning/Waiting' : `<t:${Math.floor(targetMs / 1000)}:R>`) : 'Not Set';
            desc += `${statusIcon} **${t.boss_name}** | Ch ${t.game_channel} | Next: ${nextText}\n`;
        }
        embed.setDescription(desc);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

// Global Memory State mapping for the persistent dropdowns
const userSelectionState = {};

async function handleSelectMenu(interaction) {
    if (!userSelectionState[interaction.guildId]) userSelectionState[interaction.guildId] = { timerBoss: null, timerChannel: null };

    if (interaction.customId === 'cp_toggle_select') {
        const bossName = interaction.values[0].replace('toggle_', '');
        db.prepare('UPDATE boss_timers SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE guild_id = ? AND boss_name = ?').run(interaction.guildId, bossName);
        await interaction.deferUpdate();
        await updateControlPanels(interaction.guildId, interaction.client);
    } else if (interaction.customId === 'cp_timer_boss') {
        userSelectionState[interaction.guildId].timerBoss = interaction.values[0];
        await interaction.deferUpdate();
        await interaction.followUp({ content: `Target **${interaction.values[0]}** selected. Now select channel to configure.`, ephemeral: true });
    } else if (interaction.customId === 'cp_timer_channel') {
        userSelectionState[interaction.guildId].timerChannel = interaction.values[0];
        await interaction.deferUpdate();
        await interaction.followUp({ content: `Target **Channel ${interaction.values[0]}** selected. Use buttons below to config.`, ephemeral: true });
    }
}

async function handleButton(interaction) {
    if (interaction.customId === 'toggle_role') {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const member = interaction.member;

        const role = await getOrCreateRole(guild);
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
            await interaction.editReply('🔕 Notifications disabled.');
        } else {
            await member.roles.add(role);
            await interaction.editReply('🔔 Notifications enabled.');
        }
        return;
    }

    if (interaction.customId === 'cp_set_reminder') {
        const modal = new ModalBuilder().setCustomId(`modal_global_reminder`).setTitle(`Global Pre-Spawn Reminder`);
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('minutes').setLabel("Minutes before spawn to Ping").setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }
    
    if (interaction.customId === 'cp_set_cleanup') {
        const modal = new ModalBuilder().setCustomId(`modal_global_cleanup`).setTitle(`Global Alert Cleanup`);
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('minutes').setLabel("Minutes to keep spawn alerts").setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    if (!userSelectionState[interaction.guildId]) userSelectionState[interaction.guildId] = { timerBoss: null, timerChannel: null };
    const state = userSelectionState[interaction.guildId];
    
    if (!state.timerBoss || !state.timerChannel) {
        return interaction.reply({ content: '⚠️ Please select **BOTH** a Boss and a Game Channel from the menus first before clicking this button.', ephemeral: true });
    }

    if (interaction.customId === 'cp_set_interval') {
        const modal = new ModalBuilder().setCustomId(`modal_interval_${state.timerBoss}_${state.timerChannel}`).setTitle(`Set Interval (${state.timerBoss} Ch${state.timerChannel})`);
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('interval_hours').setLabel("Interval in Hours").setStyle(TextInputStyle.Short).setRequired(true)
        ));
        await interaction.showModal(modal);
    } else if (interaction.customId === 'cp_set_override') {
        const modal = new ModalBuilder().setCustomId(`modal_override_${state.timerBoss}_${state.timerChannel}`).setTitle(`Override Spawn (${state.timerBoss} Ch${state.timerChannel})`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('spawn_time').setLabel("24h Time (e.g. 15:00 or 23:00)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('timezone').setLabel("Timezone (ET/CT/MT/PT)").setStyle(TextInputStyle.Short).setRequired(true).setValue("ET"))
        );
        await interaction.showModal(modal);
    } else if (interaction.customId === 'cp_cancel_timer') {
        db.prepare('UPDATE boss_timers SET override_utc = NULL, interval_ms = NULL, next_spawn_utc = NULL, reminder_sent = 0 WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').run(interaction.guildId, state.timerBoss, state.timerChannel);
        await renderStatusEmbed(interaction.guildId, state.timerBoss, interaction.client);
        await interaction.reply({ content: `✅ Timers cancelled for **${state.timerBoss}** on **Channel ${state.timerChannel}**.`, ephemeral: true });
    }
}

async function handleModalSubmit(interaction) {
    if (interaction.customId === 'modal_global_reminder') {
        const minutes = parseFloat(interaction.fields.getTextInputValue('minutes'));
        if (isNaN(minutes)) return interaction.reply({ content: 'Invalid number.', ephemeral: true });
        db.prepare('UPDATE server_settings SET reminder_minutes = ? WHERE guild_id = ?').run(minutes, interaction.guildId);
        await interaction.deferUpdate();
        await updateControlPanels(interaction.guildId, interaction.client);
        await interaction.followUp({ content: `Global Reminder Set to ${minutes} mins!`, ephemeral: true });
    }
    
    else if (interaction.customId === 'modal_global_cleanup') {
        const minutes = parseFloat(interaction.fields.getTextInputValue('minutes'));
        if (isNaN(minutes)) return interaction.reply({ content: 'Invalid number.', ephemeral: true });
        db.prepare('UPDATE server_settings SET alert_cleanup_minutes = ? WHERE guild_id = ?').run(minutes, interaction.guildId);
        await interaction.deferUpdate();
        await updateControlPanels(interaction.guildId, interaction.client);
        await interaction.followUp({ content: `Global File Cleanup Set to ${minutes} mins!`, ephemeral: true });
    }

    else if (interaction.customId.startsWith('modal_interval_')) {
        const parts = interaction.customId.split('_');
        const channel = parts.pop();
        const bossName = parts.slice(2).join('_');
        const hours = parseFloat(interaction.fields.getTextInputValue('interval_hours'));
        
        if (isNaN(hours)) return interaction.reply({ content: 'Invalid number.', ephemeral: true });

        const intervalMs = hours * 60 * 60 * 1000;
        const row = db.prepare('SELECT last_spawn_utc FROM boss_timers WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').get(interaction.guildId, bossName, channel);
        const nextSpawn = row && row.last_spawn_utc ? row.last_spawn_utc + intervalMs : Date.now() + intervalMs;
        db.prepare('UPDATE boss_timers SET interval_ms = ?, next_spawn_utc = ? WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').run(intervalMs, nextSpawn, interaction.guildId, bossName, channel);

        await interaction.deferUpdate();
        await renderStatusEmbed(interaction.guildId, bossName, interaction.client);
        await interaction.followUp({ content: `Interval for **${bossName}** set to ${hours} hrs on CH${channel}.`, ephemeral: true });

    } else if (interaction.customId.startsWith('modal_override_')) {
        const parts = interaction.customId.split('_');
        const channel = parts.pop();
        const bossName = parts.slice(2).join('_');
        const timeStr = interaction.fields.getTextInputValue('spawn_time');
        const tz = interaction.fields.getTextInputValue('timezone').toUpperCase();
        
        let tzName = 'UTC';
        if (tz === 'ET') tzName = 'America/New_York';
        else if (tz === 'CT') tzName = 'America/Chicago';
        else if (tz === 'MT') tzName = 'America/Denver';
        else if (tz === 'PT') tzName = 'America/Los_Angeles';

        const [hh, mm, ss] = timeStr.split(':').map(Number);
        if (isNaN(hh) || isNaN(mm)) return interaction.reply({ content: 'Invalid time format.', ephemeral: true });
        
        const nowMoment = moment().tz(tzName);
        let targetMoment = moment.tz({ year: nowMoment.year(), month: nowMoment.month(), date: nowMoment.date(), hour: hh, minute: mm, second: ss || 0 }, tzName);
        if (targetMoment.isBefore(nowMoment)) targetMoment.add(1, 'days');

        const overrideSpawn = targetMoment.valueOf();
        const row = db.prepare('SELECT interval_ms FROM boss_timers WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').get(interaction.guildId, bossName, channel);
        const nextSpawnUpdate = row && row.interval_ms ? overrideSpawn + row.interval_ms : null;

        db.prepare('UPDATE boss_timers SET override_utc = ?, last_spawn_utc = ?, next_spawn_utc = COALESCE(?, next_spawn_utc) WHERE guild_id = ? AND boss_name = ? AND game_channel = ?').run(overrideSpawn, overrideSpawn, nextSpawnUpdate, interaction.guildId, bossName, channel);

        await interaction.deferUpdate();
        await renderStatusEmbed(interaction.guildId, bossName, interaction.client);
        await interaction.followUp({ content: `Override for **${bossName} CH${channel}** configured!`, ephemeral: true });
    }
}

module.exports = { handleCommand, handleButton, handleSelectMenu, handleModalSubmit };
