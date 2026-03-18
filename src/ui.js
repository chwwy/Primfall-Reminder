const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const { db } = require('./database');
const { BOSSES, CHANNELS, THEME_COLOR } = require('./config');

function getBossSlug(name) {
    return name.toLowerCase().replace(/['\s]+/g, '-');
}

async function renderStatusEmbed(guildId, bossName, client) {
    const serverSettings = db.prepare('SELECT status_channel_id FROM server_settings WHERE guild_id = ?').get(guildId);
    if (!serverSettings || !serverSettings.status_channel_id) return;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const channel = await guild.channels.fetch(serverSettings.status_channel_id).catch(() => null);
    if (!channel) return;

    const bossData = db.prepare('SELECT status_message_id FROM bosses WHERE guild_id = ? AND name = ?').get(guildId, bossName);
    if (!bossData) return;

    const channelsData = db.prepare('SELECT * FROM boss_timers WHERE guild_id = ? AND boss_name = ? ORDER BY game_channel ASC').all(guildId, bossName);
    
    let lastSpawnText = '';
    let nextSpawnText = '';

    CHANNELS.forEach(ch => {
        const row = channelsData.find(x => x.game_channel === ch) || {};
        
        if (row.last_spawn_utc) {
            lastSpawnText += `**Channel ${ch}:** <t:${Math.floor(row.last_spawn_utc/1000)}:F> ( <t:${Math.floor(row.last_spawn_utc/1000)}:R> )\n`;
        } else {
            lastSpawnText += `**Channel ${ch}:** Not recorded\n`;
        }

        const nextTarget = row.override_utc || row.next_spawn_utc;
        if (nextTarget) {
            const now = Date.now();
            if (nextTarget <= now) {
                nextSpawnText += `**Channel ${ch}:** Spawning/Waiting...\n`;
            } else {
                nextSpawnText += `**Channel ${ch}:** <t:${Math.floor(nextTarget/1000)}:F> ( <t:${Math.floor(nextTarget/1000)}:R> )\n`;
            }
        } else {
            nextSpawnText += `**Channel ${ch}:** Not scheduled\n`;
        }
    });

    const slug = getBossSlug(bossName);
    const attachment = new AttachmentBuilder(`./assets/bosses/${slug}.png`, { name: `${slug}.png` });

    const embed = new EmbedBuilder()
        .setTitle(`${bossName} Status`)
        .setThumbnail(`attachment://${slug}.png`)
        .setColor(THEME_COLOR)
        .addFields(
            { name: 'Last Spawn', value: lastSpawnText, inline: true },
            { name: 'Next Spawn', value: nextSpawnText, inline: true }
        )
        .setFooter({ text: 'Times mathematically derived | Quinfall Notify' });

    if (bossData.status_message_id) {
        try {
            const msg = await channel.messages.fetch(bossData.status_message_id);
            if (msg) {
                await msg.edit({ embeds: [embed], files: [attachment] });
                return;
            }
        } catch (e) { }
    }

    const newMsg = await channel.send({ embeds: [embed], files: [attachment] });
    db.prepare('UPDATE bosses SET status_message_id = ? WHERE guild_id = ? AND name = ?').run(newMsg.id, guildId, bossName);
}

async function renderAllStatusEmbeds(guildId, client) {
    for (const bossName of Object.keys(BOSSES)) {
        await renderStatusEmbed(guildId, bossName, client);
    }
}

async function updateControlPanels(guildId, client) {
    const settings = db.prepare('SELECT * FROM server_settings WHERE guild_id = ?').get(guildId);
    if (!settings || !settings.control_panel_channel_id) return;

    try {
        const guild = await client.guilds.fetch(guildId).catch(()=>null);
        if(!guild) return;
        const channel = await guild.channels.fetch(settings.control_panel_channel_id).catch(()=>null);
        if(!channel) return;

        // ---------- PANEL 1: Global Settings & Toggles ----------
        const counts = db.prepare('SELECT boss_name, SUM(enabled) as en_count FROM boss_timers WHERE guild_id = ? GROUP BY boss_name').all(guildId);
        const enabledState = {};
        for(const c of counts) {
            enabledState[c.boss_name] = c.en_count > 0;
        }

        const embedSettings = new EmbedBuilder()
            .setTitle('⚙️ Global Settings & Boss Toggles')
            .setColor(THEME_COLOR)
            .setDescription('Manage your server-wide bot parameters and globally disable/enable boss tracking below.')
            .addFields(
                { name: 'Pre-Spawn Reminder', value: settings.reminder_minutes ? `${settings.reminder_minutes} mins before` : 'Disabled', inline: true },
                { name: 'Alert Auto-Cleanup', value: settings.alert_cleanup_minutes ? `${settings.alert_cleanup_minutes} mins after` : 'Disabled', inline: true }
            );

        let toggleDesc = '**Boss Tracking Status:**\n';
        Object.keys(BOSSES).forEach(b => {
             toggleDesc += `${enabledState[b] ? '✅' : '❌'} **${b}**\n`;
        });
        embedSettings.addFields({ name: '\u200B', value: toggleDesc });

        const selectBossToggle = new StringSelectMenuBuilder()
            .setCustomId('cp_toggle_select')
            .setPlaceholder('Select a Boss to Enable/Disable...')
            .addOptions(Object.keys(BOSSES).map(b => ({ label: b, description: enabledState[b] ? 'Currently Enabled' : 'Currently Disabled', value: `toggle_${b}` })));

        const rowSettings1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cp_set_reminder').setLabel('Set Pre-Spawn Reminder').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cp_set_cleanup').setLabel('Set Alert Cleanup').setStyle(ButtonStyle.Secondary)
        );
        const rowSettings2 = new ActionRowBuilder().addComponents(selectBossToggle);

        if (settings.control_panel_message_id) {
            try {
                const msg = await channel.messages.fetch(settings.control_panel_message_id);
                if (msg) await msg.edit({ embeds: [embedSettings], components: [rowSettings1, rowSettings2] });
            } catch(e) {
                const newMsg = await channel.send({ embeds: [embedSettings], components: [rowSettings1, rowSettings2] });
                db.prepare('UPDATE server_settings SET control_panel_message_id = ? WHERE guild_id = ?').run(newMsg.id, guildId);
            }
        } else {
            const newMsg = await channel.send({ embeds: [embedSettings], components: [rowSettings1, rowSettings2] });
            db.prepare('UPDATE server_settings SET control_panel_message_id = ? WHERE guild_id = ?').run(newMsg.id, guildId);
        }

        // ---------- PANEL 2: Schedules & Timers ----------
        const embedTimers = new EmbedBuilder()
            .setTitle('⏱️ Boss Schedules & Timers')
            .setColor(THEME_COLOR)
            .setDescription('Select the target Boss and Game Channel below, then use the buttons to modify their timers.');

        const rowTimers1 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('cp_timer_boss')
                .setPlaceholder('1. Select Boss...')
                .addOptions(Object.keys(BOSSES).map(b => ({ label: b, value: b })))
        );

        const rowTimers2 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('cp_timer_channel')
                .setPlaceholder('2. Select Channel...')
                .addOptions(CHANNELS.map(c => ({ label: `Channel ${c}`, value: String(c) })))
        );

        const rowTimers3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cp_set_interval').setLabel('Set Interval').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cp_set_override').setLabel('Set Override Timer').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cp_cancel_timer').setLabel('Cancel Timer').setStyle(ButtonStyle.Danger)
        );

        let activeTimerMsgId = null;
        try {
            const col = db.prepare("SELECT name FROM pragma_table_info('server_settings') WHERE name='timer_panel_message_id'").get();
            if (!col) db.prepare("ALTER TABLE server_settings ADD COLUMN timer_panel_message_id TEXT").run();
            const res = db.prepare('SELECT timer_panel_message_id FROM server_settings WHERE guild_id = ?').get(guildId);
            activeTimerMsgId = res ? res.timer_panel_message_id : null;
        } catch(e) {}

        if (activeTimerMsgId) {
            try {
                const msg = await channel.messages.fetch(activeTimerMsgId);
                if (msg) {
                    await msg.edit({ embeds: [embedTimers], components: [rowTimers1, rowTimers2, rowTimers3] });
                    return; 
                }
            } catch(e) { }
        }
        
        try {
            const newMsg2 = await channel.send({ embeds: [embedTimers], components: [rowTimers1, rowTimers2, rowTimers3] });
            db.prepare('UPDATE server_settings SET timer_panel_message_id = ? WHERE guild_id = ?').run(newMsg2.id, guildId);
        } catch(e) {};

    } catch(err) {
        console.error("updateControlPanels error", err);
    }
}

module.exports = {
    renderStatusEmbed,
    renderAllStatusEmbeds,
    updateControlPanels
};
