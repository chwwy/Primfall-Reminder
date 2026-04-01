const { REST, Routes } = require('discord.js');
const { BOSSES } = require('./config');

const ADMIN = '32'; // MANAGE_SERVER permission flag

async function registerCommands() {
  const bossChoices   = Object.keys(BOSSES).map(b => ({ name: b, value: b }));
  const tzChoices     = ['ET', 'CT', 'MT', 'PT'].map(t => ({ name: t, value: t }));

  const commands = [
    {
      name: 'setup',
      description: 'Configure bot channels and deploy persistent panels',
      default_member_permissions: ADMIN,
      options: [
        { type: 7, name: 'notifications_toggle', description: 'Channel for the notification toggle button', required: true },
        { type: 7, name: 'control_panel',         description: 'Channel for admin control panels',          required: true },
        { type: 7, name: 'status_channel',         description: 'Channel for boss status embeds & alerts',   required: true },
      ],
    },
    {
      name: 'setboss',
      description: 'Set a repeating spawn interval for a boss',
      default_member_permissions: ADMIN,
      options: [
        { type: 3, name: 'boss_name',      description: 'Boss',               required: true, choices: bossChoices },
        { type: 4, name: 'interval_hours',  description: 'Repeat every N hrs', required: true },
        { type: 3, name: 'timezone',        description: 'Timezone',           required: true, choices: tzChoices },
      ],
    },
    {
      name: 'override',
      description: 'Override next spawn to a fixed time',
      default_member_permissions: ADMIN,
      options: [
        { type: 3, name: 'boss_name',  description: 'Boss',                             required: true, choices: bossChoices },
        { type: 3, name: 'spawn_time',  description: '24h time (e.g. 15:00 or 23:00)',   required: true },
        { type: 3, name: 'timezone',    description: 'Timezone',                         required: true, choices: tzChoices },
        { type: 3, name: 'spawn_date',  description: 'Date (MM/DD/YYYY) - optional',     required: false },
      ],
    },
    {
      name: 'setstatus',
      description: 'Re-assign the status channel and re-post all boss embeds',
      default_member_permissions: ADMIN,
      options: [
        { type: 7, name: 'channel', description: 'New status channel', required: true },
      ],
    },
    {
      name: 'canceltimer',
      description: 'Cancel all timers for a boss on a specific channel',
      default_member_permissions: ADMIN,
      options: [
        { type: 3, name: 'boss_name', description: 'Boss',         required: true, choices: bossChoices },
      ],
    },
    {
      name: 'status',
      description: 'View a summary of all boss timers',
    },
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('[commands] Registering global slash commands…');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('[commands] Done.');
  } catch (err) {
    console.error('[commands] Failed:', err);
  }
}

module.exports = { registerCommands };
