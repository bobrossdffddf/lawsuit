'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

/**
 * Slash command definitions, shared by the runtime handler and the
 * registration script (`npm run deploy`).
 */
const definitions = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the public lawsuit panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

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
    .setName('caseinfo')
    .setDescription('Show the docket entry for this case')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('exhibits')
    .setDescription('List every exhibit filed in this case')
    .setDMPermission(false),
].map((c) => c.toJSON());

module.exports = { definitions };
