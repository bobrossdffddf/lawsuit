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

  new SlashCommandBuilder()
    .setName('review')
    .setDescription('Look up an attorney and read or leave a review')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('lawyeradd')
    .setDescription('Register a user as a client of an attorney (clerks only)')
    .addUserOption((o) => o.setName('lawyer').setDescription('The attorney').setRequired(true))
    .addUserOption((o) => o.setName('client').setDescription('Their client').setRequired(true))
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('lawreq')
    .setDescription('Request an attorney for a party in this case (clerks only)')
    .addUserOption((o) => o.setName('user').setDescription('Who needs counsel').setRequired(true))
    .addStringOption((o) =>
      o.setName('details').setDescription('What attorneys should know before accepting').setRequired(false),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current step and move the case forward (clerks only)')
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a user from this case and clear their role on it (clerks only)')
    .addUserOption((o) => o.setName('user').setDescription('Who to remove').setRequired(true))
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName('request')
    .setDescription('DM someone asking them to join the courtroom')
    .addUserOption((o) => o.setName('user').setDescription('Who to summon').setRequired(true))
    .setDMPermission(false),
].map((c) => c.toJSON());

module.exports = { definitions };
