require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { db } = require('./src/database');
const { registerSlashCommands } = require('./src/slash');
const { handleCommand, handleButton, handleSelectMenu, handleModalSubmit } = require('./src/handlers');
const { checkTimers } = require('./src/timers');
const { renderAllStatusEmbeds, updateControlPanels } = require('./src/ui');

// Ensure token is present
if (!process.env.DISCORD_TOKEN) {
    console.error("FATAL ERROR: DISCORD_TOKEN is missing or undefined from environment variables!");
    console.error("Please add it to your .env file or your provider's secrets panel.");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await registerSlashCommands();
    
    // Restore persistent messages on startup
    const guilds = db.prepare('SELECT guild_id FROM server_settings').all();
    for (const g of guilds) {
        await updateControlPanels(g.guild_id, client);
        await renderAllStatusEmbeds(g.guild_id, client);
    }

    await checkTimers(client); // Start intervals
    setInterval(() => checkTimers(client), 60 * 1000); // Check every minute
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            await handleCommand(interaction);
        } else if (interaction.isButton()) {
            await handleButton(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
        }
    } catch (err) {
        console.error("Interaction error:", err);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'An error occurred while executing this component.', ephemeral: true }).catch(()=>{});
        } else {
            await interaction.reply({ content: 'An error occurred while executing this component.', ephemeral: true }).catch(()=>{});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
