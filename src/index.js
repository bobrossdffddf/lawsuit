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

  const pruned = store.pruneDrafts();
  if (pruned) console.log(`[ready] cleared ${pruned} abandoned government-claim draft(s)`);

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

client.on(Events.GuildMemberAdd, (member) => {
  handleMemberJoin(member).catch((err) => console.error('[member] error:', err));
});

client.on(Events.Error, (err) => console.error('[client] error:', err));
process.on('unhandledRejection', (err) => console.error('[process] unhandled rejection:', err));

client.login(config.token);
