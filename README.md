# Quinfall Boss Reminder Bot

This is a Discord bot built with Node.js and discord.js v14. It uses better-sqlite3 to store application state.

## Setup Instructions

1.  **Clone the repository** (or download the code).
2.  **Install dependencies**:
    \`\`\`bash
    npm install
    \`\`\`
3.  **Environment Variables**: Create a \`.env\` file in the root directory (or use variables on your Railway dashboard):
    \`\`\`env
    DISCORD_TOKEN=your_bot_token_here
    CLIENT_ID=your_bot_client_id_here
    GUILD_ID=your_development_server_id (optional, forces quick command registration for dev)
    \`\`\`

## Running Locally

Run:
\`\`\`bash
node index.js
\`\`\`
The bot will connect to \`database.sqlite\` in the root directory by default.

## Deployment on Railway

1. Provide the \`DISCORD_TOKEN\` and \`CLIENT_ID\` in Railway's Variables section.
2. Under your Railway service **Volumes**, add a volume with the mount path \`/app/data\`.
3. The codebase comes natively with a \`railway.toml\` to configure the NIXPACKS build correctly and start up the bot immediately via \`node index.js\`.

## Using the Bot

As a user with **Manage Server** permissions, run \`/setup\` in your Discord server. Designate the relevant channels when prompted. The bot will deploy persistent embeds automatically. Next, use \`/setboss\` to configure spawn intervals, and use the Control Panel to start tracking!
