'use strict';

const { MessageFlags } = require('discord.js');

const store = require('../db');
const perms = require('../lib/perms');
const modals = require('../ui/modals');
const M = require('../ui/messages');
const cases = require('../services/caseService');

const EPHEMERAL = MessageFlags.Ephemeral;

async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case 'add': {
      if (!perms.isStaff(interaction.member)) {
        return interaction.reply({ content: 'Clerks and judges only.', flags: EPHEMERAL });
      }
      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.reply({ content: 'Run this inside a case channel.', flags: EPHEMERAL });

      const user = interaction.options.getUser('user', true);
      await interaction.deferReply({ flags: EPHEMERAL });
      await cases.addParty(interaction, c, user.id);
      return interaction.editReply(`Added <@${user.id}> to \`${c.case_number}\`.`);
    }

    case 'addjudge': {
      if (!perms.isStaff(interaction.member)) {
        return interaction.reply({ content: 'Clerks and judges only.', flags: EPHEMERAL });
      }
      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.reply({ content: 'Run this inside a case channel.', flags: EPHEMERAL });
      return interaction.showModal(modals.addJudgeModal());
    }

    case 'close': {
      if (!perms.isClerk(interaction.member)) {
        return interaction.reply({ content: 'Only clerks may close a case.', flags: EPHEMERAL });
      }
      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.reply({ content: 'Run this inside a case channel.', flags: EPHEMERAL });
      if (c.status === 'closed') {
        return interaction.reply({ content: 'This case is already closed.', flags: EPHEMERAL });
      }
      // Three confirmations; the buttons walk 1 -> 2 -> 3 before anything happens.
      const first = M.closeConfirm(c, 1);
      return interaction.reply({ ...first, flags: first.flags | EPHEMERAL });
    }

    default:
      return undefined;
  }
}

module.exports = { handleCommand };
