# Primfall Reminder

Discord bot for tracking Quinfall world boss and Zenith Conquest spawn timers. Pings a configurable role when spawns are imminent or happening.

## Features

- Tracks 7 world bosses + Zenith Conquest across game channels 1, 2, and 4
- Repeating interval timers and one-time spawn overrides (24h military time)
- Pre-spawn reminders (configurable minutes before spawn)
- Auto-cleanup of alert messages after a set duration
- Persistent control panels — settings and timer management live in-channel 24/7
- Per-server isolation — works across multiple Discord guilds independently

## Setup

1. Copy `.env.example` to `.env` and fill in your bot token and client ID
2. `npm install`
3. `node index.js`
4. Run `/setup` in your Discord server to assign channels

## Project Structure

```
index.js            Entry point
src/
  config.js         Boss list, game channels, theme color, timezone map
  database.js       SQLite schema, seeding, role helper
  commands.js       Slash command registration
  handlers.js       Interaction routing (commands, buttons, menus, modals)
  timers.js         Spawn checking loop and alert cleanup
  ui.js             Status embeds and control panel rendering
assets/bosses/      Boss thumbnail images (lowercase-hyphenated.png)
```

## Deployment (Railway)

1. Push to GitHub
2. Create a Railway project from the repo
3. Add `DISCORD_TOKEN` and `CLIENT_ID` as variables
4. Add a volume mounted at `/app/data` for database persistence

The included `railway.toml` handles build configuration automatically.
