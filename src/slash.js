const { REST, Routes } = require('discord.js');
const { BOSSES, CHANNELS } = require('./config');

async function registerSlashCommands() {
    const channelChoices = CHANNELS.map(c => ({ name: `Channel ${c}`, value: c }));
    const bossChoices = Object.keys(BOSSES).map(b => ({ name: b, value: b }));
    const tzChoices = ['ET', 'CT', 'MT', 'PT'].map(t => ({ name: t, value: t }));

    const commands = [
        {
            name: 'setup',
            description: 'Set up the reminder channels and persistent panels (Admin only)',
            default_member_permissions: '32',
            options: [
                { type: 7, name: 'notifications_toggle', description: 'Global Notifications Toggle Channel', required: true },
                { type: 7, name: 'control_panel', description: 'Control Panel Channel', required: true },
                { type: 7, name: 'status_channel', description: 'Status Channel (Posts all 8 boss embeds and alerts)', required: true }
            ]
        },
        {
            name: 'setboss',
            description: 'Set repeating interval for a boss on a specific channel (Admin only)',
            default_member_permissions: '32',
            options: [
                { type: 3, name: 'boss_name', description: 'Select a boss', required: true, choices: bossChoices },
                { type: 3, name: 'channel', description: 'Select a channel', required: true, choices: channelChoices },
                { type: 4, name: 'interval_hours', description: 'Interval in hours', required: true },
                { type: 3, name: 'timezone', description: 'Timezone for logging/display', required: true, choices: tzChoices }
            ]
        },
        {
            name: 'override',
            description: 'Set a one-time countdown for a boss on a specific channel (Admin only)',
            default_member_permissions: '32',
            options: [
                { type: 3, name: 'boss_name', description: 'Select a boss', required: true, choices: bossChoices },
                { type: 3, name: 'channel', description: 'Select a channel', required: true, choices: channelChoices },
                { type: 3, name: 'spawn_time', description: '24H Military Time (e.g. 15:00 or 23:00)', required: true },
                { type: 3, name: 'timezone', description: 'Timezone', required: true, choices: tzChoices }
            ]
        },
        {
            name: 'setstatus',
            description: 'Designates the status channel explicitly and re-posts all 8 embeds',
            default_member_permissions: '32',
            options: [
                { type: 7, name: 'channel', description: 'Channel to map the Status embeds to', required: true }
            ]
        },
        {
            name: 'status',
            description: 'Shows ephemeral summary across all 3 channels',
            default_member_permissions: '32'
        },
        {
            name: 'canceltimer',
            description: 'Cancel timer for a boss on a specific channel (Admin only)',
            default_member_permissions: '32',
            options: [
                { type: 3, name: 'boss_name', description: 'Select a boss', required: true, choices: bossChoices },
                { type: 3, name: 'channel', description: 'Select a channel', required: true, choices: channelChoices }
            ]
        },
        {
            name: 'setreminder',
            description: 'Set global reminder interval (x minutes before timestamp) (Admin only)',
            default_member_permissions: '32',
            options: [
                { type: 4, name: 'minutes', description: 'Minutes before spawn to ping (0 to disable)', required: true }
            ]
        },
        {
            name: 'setalertcleanup',
            description: 'Set auto-cleanup for alert messages in minutes. (0 to disable)',
            default_member_permissions: '32',
            options: [
                { type: 4, name: 'minutes', description: 'Minutes to keep alert messages before deleting (0 to disable)', required: true }
            ]
        }
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Refreshing global slash commands... (Pushing to all servers)');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('Successfully reloaded global slash commands.');
    } catch (error) {
        console.error('Error refreshing commands:', error);
    }
}

module.exports = { registerSlashCommands };
