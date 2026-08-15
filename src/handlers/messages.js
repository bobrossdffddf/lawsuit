'use strict';

const config = require('../config');
const store = require('../db');
const perms = require('../lib/perms');
const M = require('../ui/messages');
const cases = require('../services/caseService');

/**
 * Handles plain messages:
 *  - `$lawsuits` posts the public panel
 *  - any file dropped in a discovery thread is docketed as an exhibit
 */
async function handleMessage(message) {
  if (message.author.bot || !message.guild) return;

  // 1. Discovery exhibits
  const discoveryCase = store.getCaseByThread(message.channelId);
  if (discoveryCase && message.attachments.size > 0) {
    try {
      await cases.fileExhibits(message, discoveryCase);
    } catch (err) {
      console.error('[discovery] could not file exhibit:', err);
    }
    return;
  }

  // 2. Prefix commands
  if (!message.content.startsWith(config.prefix)) return;
  const [command] = message.content.slice(config.prefix.length).trim().toLowerCase().split(/\s+/);

  if (command === 'lawsuits' || command === 'lawsuit' || command === 'panel') {
    if (!perms.canPostPanel(message.member)) {
      const warn = await message.reply('You do not have permission to post the lawsuit panel.');
      setTimeout(() => warn.delete().catch(() => {}), 8000);
      return;
    }
    await message.channel.send(M.lawsuitPanel());
    await message.delete().catch(() => {});
  }
}

/** Optional welcome message for new members. */
async function handleMemberJoin(member) {
  if (!config.channels.welcome) return;
  try {
    const channel = await member.client.channels.fetch(config.channels.welcome);
    await channel.send(M.welcomeMessage(member));
  } catch (err) {
    console.error('[welcome] failed:', err.message);
  }
}

module.exports = { handleMessage, handleMemberJoin };
