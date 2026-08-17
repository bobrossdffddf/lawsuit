'use strict';

const { Client, GatewayIntentBits, Partials, Events, MessageFlags } = require('discord.js');

const config = require('./config');
require('./db'); // opens + migrates the database on boot
const { handleButton, handleSelect } = require('./handlers/buttons');
const { handleModal } = require('./handlers/modals');
const { handleCommand } = require('./handlers/commands');
const { handleMessage, handleMemberJoin } = require('./handlers/messages');
const { hasPoppler } = require('./lib/pdf');
const store = require('./db');
const bar = require('./services/barService');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed for the `$lawsuits` prefix command
    GatewayIntentBits.GuildMembers, // needed for welcome messages + discovery invites
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[ready] logged in as ${c.user.tag}`);
  console.log(`[ready] guild=${config.guildId} category=${config.channels.civilCategory}`);
  await hasPoppler();

  const missing = config.missingForms();
  if (missing.length) {
    console.error('[ready] MISSING COURT FORMS — any message that attaches these will fail:');
    for (const m of missing) console.error(`          assets/forms/${m}`);
  }

  // A stale .env silently switches features off. Say so on boot.
  const off = [];
  if (!config.roles.lawyer) off.push('LAWYER_ROLE_ID — /review lists nobody, /lawreq pings nobody');
  if (!config.channels.lawyerRequests) off.push('LAWYER_REQUEST_CHANNEL_ID — /lawreq will not broadcast');
  if (!config.channels.courtVoice) off.push('COURT_VOICE_CHANNEL_ID — /request omits the channel link');
  if (!config.channels.welcome) off.push('WELCOME_CHANNEL_ID — no welcome message on join');
  if (!config.channels.support) off.push('SUPPORT_CHANNEL_ID — "get support in #..." has no link');
  if (off.length) {
    console.warn('[ready] these features are OFF because their .env keys are unset:');
    for (const line of off) console.warn(`          ${line}`);
  }
  console.log(
    `[ready] clerk-only decisions: ${config.adminOverride ? 'NO (ADMIN_OVERRIDE=true)' : 'yes'}`,
  );

  // Any channel that looks like a case but has no row is a leftover from a
  // failed filing. Name them so they can be deleted rather than lingering.
  try {
    const guild = await c.guilds.fetch(config.guildId);
    const channels = await guild.channels.fetch();
    const orphans = [...channels.values()].filter(
      (ch) =>
        ch &&
        /^\d{2}-(cc|cr)-\d{6}$/i.test(ch.name) &&
        !store.getCaseByChannel(ch.id),
    );
    if (orphans.length) {
      console.warn(
        `[ready] ${orphans.length} case channel(s) have no docket entry — safe to delete: ` +
          orphans.map((ch) => `#${ch.name}`).join(', '),
      );
    }
  } catch (err) {
    console.warn('[ready] could not scan for orphaned case channels:', err.message);
  }

  const pruned = store.pruneDrafts();
  if (pruned) console.log(`[ready] cleared ${pruned} abandoned government-claim draft(s)`);

  // One member fetch at boot fills the cache, so /review never has to make a
  // rate-limited gateway request on demand.
  if (config.roles.lawyer) {
    try {
      const guild = await c.guilds.fetch(config.guildId);
      await guild.members.fetch();
      console.log(`[ready] bar roll cached: ${(await bar.roll(guild)).length} attorney(s)`);
    } catch (err) {
      console.warn('[ready] could not warm the member cache:', err.message);
    }
  }

  c.user.setPresence({ activities: [{ name: 'the docket' }], status: 'online' });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isStringSelectMenu()) return await handleSelect(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (err) {
    console.error('[interaction] unhandled error:', err);
    const body = {
      content: 'Something went wrong handling that. A log entry was written — tell an admin.',
      flags: MessageFlags.Ephemeral,
    };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(body);
      else await interaction.reply(body);
    } catch { /* interaction already expired */ }
  }
  return undefined;
});

client.on(Events.MessageCreate, (message) => {
  handleMessage(message).catch((err) => console.error('[message] error:', err));
});

client.on(Events.GuildMemberUpdate, (before, after) => {
  const had = before.roles.cache.has(config.roles.lawyer);
  const has = after.roles.cache.has(config.roles.lawyer);
  if (had !== has) {
    bar.invalidateRoll();
    if (has) store.seeLawyer(after.id, Date.now());
  }
});

client.on(Events.GuildMemberAdd, (member) => {
  handleMemberJoin(member).catch((err) => console.error('[member] error:', err));
});

client.on(Events.Error, (err) => console.error('[client] error:', err));
process.on('unhandledRejection', (err) => console.error('[process] unhandled rejection:', err));

client.login(config.token);
