'use strict';

const { SlashCommandBuilder } = require('discord.js');

/**
 * Slash command definitions, shared by the runtime handler and the
 * registration script (`npm run deploy`).
 */
const definitions = [
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add a user to this case channel (clerks and up)')
    .addUserOption((o) => o.setName('user').setDescription('Who to add').setRequired(true))
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('addjudge')
    .setDescription('Appoint a judge to this case')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close this case and lock the channel (clerks only)')
    .setDMPermission(false),
].map((c) => c.toJSON());

module.exports = { definitions };
