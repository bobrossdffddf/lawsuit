'use strict';

const { MessageFlags } = require('discord.js');

const store = require('../db');
const perms = require('../lib/perms');
const modals = require('../ui/modals');
const M = require('../ui/messages');
const L = require('../ui/lawyers');
const bar = require('../services/barService');
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

    /* ── lawyer reviews ───────────────────────────────────── */

    case 'review': {
      // deferReply makes it ephemeral; the edit must not resend that flag.
      await interaction.deferReply({ flags: EPHEMERAL });
      return interaction.editReply(L.reviewPanel(await bar.roll(interaction.guild)));
    }

    case 'lawyeradd': {
      if (!perms.isClerk(interaction.member)) {
        return interaction.reply({ content: 'Only clerks may register clients.', flags: EPHEMERAL });
      }
      const lawyer = interaction.options.getUser('lawyer', true);
      const client = interaction.options.getUser('client', true);
      if (lawyer.id === client.id) {
        return interaction.reply({ content: 'An attorney cannot be their own client.', flags: EPHEMERAL });
      }

      // Acknowledge first — the member fetch below can be an uncached HTTP
      // round trip, which would otherwise eat the 3-second reply window.
      await interaction.deferReply({ flags: EPHEMERAL });

      const member = await interaction.guild.members.fetch(lawyer.id).catch(() => null);
      if (!perms.isLawyer(member)) {
        return interaction.editReply(
          `<@${lawyer.id}> is not bar certified — give them the bar role first.`,
        );
      }

      const c = store.getCaseByChannel(interaction.channelId);
      store.seeLawyer(lawyer.id, member?.joinedTimestamp);
      store.addClient(lawyer.id, client.id, c?.id ?? null, interaction.user.id);
      if (c) store.addMember(c.id, lawyer.id, 'attorney', interaction.user.id);

      return interaction.editReply(
        `<@${client.id}> is now on record as a client of <@${lawyer.id}>` +
          `${c ? ` for \`${c.case_number}\`` : ''}. They can leave a review.`,
      );
    }

    /* ── requesting counsel ───────────────────────────────── */

    case 'lawreq': {
      if (!perms.isClerk(interaction.member)) {
        return interaction.reply({ content: 'Only clerks may request an attorney.', flags: EPHEMERAL });
      }
      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.reply({ content: 'Run this inside a case channel.', flags: EPHEMERAL });

      const user = interaction.options.getUser('user', true);
      const details =
        interaction.options.getString('details') ||
        `Case ${c.case_number}. ${M.STAGE_LABEL[c.stage] ?? c.stage}.`;

      await interaction.deferReply({ flags: EPHEMERAL });
      const { broadcast } = await cases.requestLawyer(interaction, c, user.id, details);
      return interaction.editReply(
        broadcast
          ? `Counsel requested for <@${user.id}>. Attorneys have been notified.`
          : `Counsel requested for <@${user.id}>, but LAWYER_REQUEST_CHANNEL_ID is not set, ` +
              'so no broadcast went out.',
      );
    }

    /* ── summoning someone to the courtroom ───────────────── */

    case 'request': {
      if (!perms.isStaff(interaction.member) && !perms.isLawyer(interaction.member)) {
        return interaction.reply({
          content: 'Only court staff and attorneys may summon someone.',
          flags: EPHEMERAL,
        });
      }
      const user = interaction.options.getUser('user', true);
      await interaction.deferReply({ flags: EPHEMERAL });

      try {
        await user.send(L.presenceRequestDM(user.id, interaction.user.id));
      } catch {
        return interaction.editReply(
          `Could not DM <@${user.id}> — their DMs are closed. Ping them in a channel instead.`,
        );
      }
      return interaction.editReply(`<@${user.id}> has been asked to join the courtroom.`);
    }

    default:
      return undefined;
  }
}

module.exports = { handleCommand };
