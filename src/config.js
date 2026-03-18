const BOSSES = {
  'Kraken':           'world_boss',
  'Titanseal':        'world_boss',
  'Aero-Forge':       'world_boss',
  'Draconarch':       'world_boss',
  'Doomcaller':       'world_boss',
  "Vel'khurath":      'world_boss',
  'Seraphiel':        'world_boss',
  'Zenith Conquest':  'zenith',
};

const BOSS_ORDER = Object.keys(BOSSES);

const GAME_CHANNELS = ['1', '2', '4'];

const THEME_COLOR = '#FFD700';

const TIMEZONE_MAP = {
  ET: 'America/New_York',
  CT: 'America/Chicago',
  MT: 'America/Denver',
  PT: 'America/Los_Angeles',
};

module.exports = { BOSSES, BOSS_ORDER, GAME_CHANNELS, THEME_COLOR, TIMEZONE_MAP };
