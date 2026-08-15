'use strict';

const { REST, Routes } = require('discord.js');
const config = require('./config');
const { definitions } = require('./commands');

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    console.log(`Registering ${definitions.length} slash commands to guild ${config.guildId}...`);
    const data = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: definitions },
    );
    console.log(`Done. Registered: ${data.map((d) => `/${d.name}`).join(', ')}`);
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exitCode = 1;
  }
})();
