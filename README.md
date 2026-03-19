# Primfall Reminder

A highly customizable Discord bot specifically built for tracking World Bosses and Zenith Conquest event timers in Primfall. It provides a permanent, dynamically-updating status board, integrated command panels, and strict ping management to ensure players only get notified exactly when they need to be.

## Core Features

- **Dynamic Status Board**: Maintains a live, constantly updating list of boss embeds indicating tracking status, last spawn, and next spawn across multiple channels.
- **Pre-Spawn Pings**: Customizable reminder intervals (e.g. 10 minutes prior) that ping a designated `Boss Reminder` role.
- **Smart Grouping**: If multiple bosses or channels synchronize, the bot merges them into a single, clean notification ping instead of spamming chat.
- **Auto-Cleanup**: Notifications can be set to automatically delete themselves after a configurable amount of time to keep your channels uncluttered.
- **Interactive Control Panels**: Allow server admins to easily edit timers, tweak settings, or pause specific bosses entirely via dropdowns and buttons, no commands necessary.
- **Multi-Day Support**: Supports overriding spawn times with optional `MM/DD` date parsing for non-daily bosses that span long intervals.

## Commands

All administrative operations are restrict-gated to users with the `Manage Server` permission.

| Command | Description |
|---|---|
| `/setup` | Installs the bot to specific channels. Requires you to designate three channels: one for the user Role Toggle button, one for the Admin Control Panels, and one for the Status Board. |
| `/setstatus` | Moves or resets purely the Status Board embeds to a new designated channel. |
| `/setboss` | Manually configures a repeating interval cycle (in hours) for a boss on a specific channel. Starts the cycle exactly from the moment you execute the command. |
| `/override` | Overrides a boss's next spawn to a hardcoded 24h time and specific timezone. Supports an optional `MM/DD` date parameter if the next spawn spans past 24 hours. |
| `/canceltimer` | Wipes all timer data and history for a specific boss/channel combination. |
| `/status` | Generates a quick, private text summary of all currently tracked and active timers. |

## Timetable Mechanics

- **Cycle Math**: Whenever a boss cycle resets (or an interval is updated), the bot factors in an automatic 1-hour lifespan for the boss itself. The formula applied is `last_spawn_time + 1 hour + interval`.
- **Anchoring**: The bot rigidly follows the intervals you define. If you override a spawn time to exactly `15:00 ET`, all future interval increments will anchor faithfully to that specific cycle point.

## Hosting & Setup

### Prerequisites
- Node.js v16.14+ (or later)
- A Discord Application with the bot token.
- `Message Content`, `Server Members`, and standard Gateway intents enabled in the Developer Portal.

### Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Duplicate `.env.example` as `.env` and fill out your variables:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   CLIENT_ID=your_bot_client_id
   TZ=UTC
   ```

3. Start the application:
   ```bash
   node index.js
   ```

### Railway Deployment

This project natively supports Railway deployment right out of the box with `better-sqlite3`. 
- Ensure your Railway project includes a persistent volume mapped to `/app/data` so the SQLite database doesn't reset on redeploys.
- The repository's `railway.toml` automatically configures the Node build and build/install phases.

## File Organization

- `index.js`: App entry point, Discord client initialization, and global event listeners.
- `src/commands.js`: Slash command definitions and initialization.
- `src/handlers.js`: Logic parsing for UI modals, button interactions, and direct command execution.
- `src/timers.js`: The underlying cron engine that handles expiration, database sweeps, and notification dispatching.
- `src/ui.js`: Presentation layer responsible for generating Discord embeds, control panels, and the status board.
- `src/config.js`: Hardcoded global configuration (Timezones, Boss definitions, Colors).
- `src/database.js`: SQLite schema instantiation and directory resolving.
