require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { db } = require('./src/database');
const { registerCommands } = require('./src/commands');
const { onCommand, onButton, onSelectMenu, onModalSubmit } = require('./src/handlers');
const { tick } = require('./src/timers');
const { renderAllStatusEmbeds, updateControlPanels } = require('./src/ui');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is not set. Add it to .env or your host\'s secrets.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.once('ready', async () => {
  console.log(`[bot] Online as ${client.user.tag}`);
  await registerCommands();

  // Restore persistent panels for every configured guild
  const guilds = db.prepare('SELECT guild_id FROM server_settings').all();
  for (const { guild_id } of guilds) {
    await updateControlPanels(guild_id, client);
    await renderAllStatusEmbeds(guild_id, client);
  }

  // Start the timer loop
  await tick(client);
  setInterval(() => tick(client), 60_000);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return onCommand(interaction);
    if (interaction.isButton())           return onButton(interaction);
    if (interaction.isStringSelectMenu()) return onSelectMenu(interaction);
    if (interaction.isModalSubmit())       return onModalSubmit(interaction);
  } catch (err) {
    console.error('[interaction]', err);
    const reply = { content: 'Something went wrong.', ephemeral: true };
    (interaction.replied || interaction.deferred)
      ? interaction.followUp(reply).catch(() => {})
      : interaction.reply(reply).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
