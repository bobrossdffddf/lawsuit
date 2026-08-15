'use strict';

const { MessageFlags } = require('discord.js');

const store = require('../db');
const perms = require('../lib/perms');
const fmt = require('../lib/format');
const M = require('../ui/messages');
const modals = require('../ui/modals');
const cases = require('../services/caseService');
const U = require('../ui/common');

const EPHEMERAL = MessageFlags.Ephemeral;

async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case 'panel': {
      if (!perms.canPostPanel(interaction.member)) {
        return interaction.reply({ content: 'You cannot post the panel.', flags: EPHEMERAL });
      }
      // Acknowledge first: a rate-limited send would otherwise blow the
      // three-second interaction window and surface as "interaction failed".
      await interaction.deferReply({ flags: EPHEMERAL });
      await interaction.channel.send(M.lawsuitPanel());
      return interaction.editReply('Panel posted.');
    }

    case 'add': {
      if (!perms.isStaff(interaction.member)) {
        return interaction.reply({ content: 'Clerks and judges only.', flags: EPHEMERAL });
      }
      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.reply({ content: 'Run this inside a case channel.', flags: EPHEMERAL });

      const user = interaction.options.getUser('user', true);
      await interaction.deferReply({ flags: EPHEMERAL });
      await cases.addParty(interaction, c, user.id);
      await interaction.channel.send({
        content: `<@${user.id}> has been added to \`${c.case_number}\` by <@${interaction.user.id}>.`,
        allowedMentions: { users: [user.id] },
      });
      return interaction.editReply(`Added <@${user.id}>.`);
    }

    case 'addjudge': {
      if (!perms.isStaff(interaction.member)) {
        return interaction.reply({ content: 'Clerks and judges only.', flags: EPHEMERAL });
      }
      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.reply({ content: 'Run this inside a case channel.', flags: EPHEMERAL });
      return interaction.showModal(modals.addJudgeModal());
    }

    case 'caseinfo': {
      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.reply({ content: 'Run this inside a case channel.', flags: EPHEMERAL });

      const defendant = c.defendant_id
        ? `<@${c.defendant_id}>`
        : fmt.clean(c.kind === 'department' ? c.department : c.defendant_raw, 100);

      const lines = [
        `${U.title(c.case_number)}`,
        `> **Plaintiff:** <@${c.plaintiff_id}>`,
        `> **Defendant:** ${defendant}`,
        `> **Status:** ${c.status} · **Stage:** ${M.STAGE_LABEL[c.stage] ?? c.stage}`,
        c.judge_id ? `> **Judge:** <@${c.judge_id}>` : '> **Judge:** not yet assigned',
        c.discovery_thread_id ? `> **Discovery:** <#${c.discovery_thread_id}>` : '> **Discovery:** not open',
        `> **Filed:** ${fmt.timestamp(c.created_at)}`,
        `> **Exhibits:** ${c.exhibit_seq}`,
        '',
        `**Reason**\n>>> ${fmt.clean(c.reason, 900)}`,
      ];

      return interaction.reply({
        flags: U.V2 | EPHEMERAL,
        components: [U.container([U.text(lines.join('\n'))])],
        allowedMentions: { parse: [] },
      });
    }

    case 'exhibits': {
      const c =
        store.getCaseByChannel(interaction.channelId) ?? store.getCaseByThread(interaction.channelId);
      if (!c) return interaction.reply({ content: 'Run this inside a case channel.', flags: EPHEMERAL });

      const rows = store.getExhibits(c.id);
      const body = rows.length
        ? rows
            .map(
              (e) =>
                `> **Exhibit ${e.letter}** — [${fmt.clean(e.filename, 60)}](${e.url})\n` +
                `> -# filed by <@${e.uploader_id}> · ${fmt.timestamp(e.created_at, 'f')}`,
            )
            .join('\n')
        : 'No exhibits have been filed yet.';

      return interaction.reply({
        flags: U.V2 | EPHEMERAL,
        components: [
          U.container([U.text(`${U.title(`${c.case_number} — Exhibits`)}\n${fmt.truncate(body, 3400)}`)]),
        ],
        allowedMentions: { parse: [] },
      });
    }

    default:
      return undefined;
  }
}

module.exports = { handleCommand };
