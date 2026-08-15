'use strict';

const { MessageFlags } = require('discord.js');

const config = require('../config');
const store = require('../db');
const perms = require('../lib/perms');
const { IDS, FIELDS, parse } = require('../lib/ids');
const { STAGES } = require('../stages');
const F = require('./fields');
const cases = require('../services/caseService');

const EPHEMERAL = MessageFlags.Ephemeral;

async function handleModal(interaction) {
  const { base, arg } = parse(interaction.customId);

  switch (base) {
    /* ── filing a new case ────────────────────────────────── */

    case IDS.MODAL_INTAKE:
    case IDS.MODAL_DEPT: {
      await interaction.deferReply({ flags: EPHEMERAL });

      const isDept = base === IDS.MODAL_DEPT;
      const reason = F.textOf(interaction, FIELDS.REASON);
      if (!reason.trim()) return interaction.editReply('You must explain why you are suing.');

      const department = isDept ? F.stringSelectOf(interaction, FIELDS.DEPARTMENT) : null;
      const defendantRaw = isDept ? null : F.textOf(interaction, FIELDS.DEFENDANT);

      if (isDept && !department) return interaction.editReply('You must pick a department.');
      if (!isDept && !defendantRaw.trim()) return interaction.editReply('You must name who you are suing.');

      const { c, channel } = await cases.createCase(interaction, {
        kind: isDept ? 'department' : 'person',
        defendantRaw,
        department,
        reason,
        links: F.textOf(interaction, FIELDS.LINKS),
        files: F.filesOf(interaction, FIELDS.EVIDENCE),
      });

      return interaction.editReply(
        `Your case **${c.case_number}** has been filed: <#${channel.id}>\n` +
          'A clerk will review it shortly. You will not be able to type in that channel until it is opened.',
      );
    }

    /* ── clerk denies intake ──────────────────────────────── */

    case IDS.MODAL_CASE_DENY: {
      if (!perms.isClerk(interaction.member)) {
        return interaction.reply({ content: 'Clerks only.', flags: EPHEMERAL });
      }
      await interaction.deferReply({ flags: EPHEMERAL });

      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.editReply('This channel is not a tracked case.');
      if (c.status !== 'intake') return interaction.editReply(`This case is already ${c.status}.`);

      const reason = F.textOf(interaction, FIELDS.DENY_REASON) || 'No reason provided.';
      const result = await cases.denyCase(interaction, c, reason);
      if (!result) return interaction.editReply('Another clerk just handled this case.');

      return interaction.editReply(
        result.dmed
          ? `Case \`${c.case_number}\` denied and the plaintiff has been DMed.`
          : `Case \`${c.case_number}\` denied. Their DMs are closed, so the notice was posted in-channel.`,
      );
    }

    /* ── party submits a step ─────────────────────────────── */

    case IDS.MODAL_STEP: {
      await interaction.deferReply({ flags: EPHEMERAL });

      const stage = arg;
      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.editReply('This channel is not a tracked case.');
      if (!STAGES[stage]) return interaction.editReply('Unknown step.');
      if (c.stage !== stage) return interaction.editReply('That step is no longer current.');
      if (store.hasPendingSubmission(c.id, stage)) {
        return interaction.editReply(
          'A submission for this step is already waiting on a clerk — nothing was sent twice.',
        );
      }

      const files = F.filesOf(interaction, FIELDS.UPLOAD);
      if (!files.length) return interaction.editReply('You need to attach at least one file.');

      const payload = {};
      if (stage === 'service') {
        payload.defendantUser = F.textOf(interaction, FIELDS.DEFENDANT_USER);
        payload.defendantId = F.textOf(interaction, FIELDS.DEFENDANT_ID).replace(/\D/g, '');
      }

      await cases.submitStage(interaction, c, stage, files, payload);
      return interaction.editReply('Submitted. A clerk will review it shortly.');
    }

    /* ── clerk denies a step ──────────────────────────────── */

    case IDS.MODAL_REVIEW_DENY: {
      if (!perms.isClerk(interaction.member)) {
        return interaction.reply({ content: 'Clerks only.', flags: EPHEMERAL });
      }
      await interaction.deferReply({ flags: EPHEMERAL });

      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.editReply('This channel is not a tracked case.');

      const sub = store.getSubmission(Number(arg));
      if (!sub || sub.case_id !== c.id) return interaction.editReply('That submission no longer exists.');
      if (sub.status !== 'pending') return interaction.editReply(`Already ${sub.status}.`);

      const reason = F.textOf(interaction, FIELDS.DENY_REASON) || 'No reason provided.';
      const denied = await cases.denySubmission(interaction, c, sub, reason);
      return interaction.editReply(
        denied ? 'Denied. The filer has been asked to resubmit.' : 'Another clerk just handled this.',
      );
    }

    /* ── clerk approves service and names the defendant ───── */

    case IDS.MODAL_SERVICE_OK: {
      if (!perms.isClerk(interaction.member)) {
        return interaction.reply({ content: 'Clerks only.', flags: EPHEMERAL });
      }
      await interaction.deferReply({ flags: EPHEMERAL });

      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.editReply('This channel is not a tracked case.');

      const sub = store.getSubmission(Number(arg));
      if (!sub || sub.case_id !== c.id) return interaction.editReply('That submission no longer exists.');
      if (sub.status !== 'pending') return interaction.editReply(`Already ${sub.status}.`);

      const defendantId = F.userIdOf(interaction, FIELDS.DEFENDANT_SELECT) || c.defendant_id;
      if (!defendantId) {
        return interaction.editReply(
          'You need to select the defendant so they can be added to the case. Press Approve again.',
        );
      }
      if (defendantId === c.plaintiff_id) {
        return interaction.editReply('The defendant cannot be the same person as the plaintiff.');
      }

      if (c.stage !== 'service') return interaction.editReply('That step is no longer current.');
      if (!store.resolveSubmission(sub.id, 'approved', null, interaction.user.id)) {
        return interaction.editReply('Another clerk just handled this.');
      }

      await cases.sealReview(interaction, c, sub, 'approved');
      store.updateCase(c.id, { defendant_username: sub.payload?.defendantUser ?? null });

      const attached = await cases.attachDefendant(interaction, store.getCaseById(c.id), defendantId);
      return interaction.editReply(
        attached
          ? `<@${defendantId}> has been added to \`${c.case_number}\`.`
          : 'Another clerk just handled this.',
      );
    }

    /* ── /addjudge ────────────────────────────────────────── */

    case IDS.MODAL_ADD_JUDGE: {
      if (!perms.isStaff(interaction.member)) {
        return interaction.reply({ content: 'Clerks and judges only.', flags: EPHEMERAL });
      }
      await interaction.deferReply({ flags: EPHEMERAL });

      const c = store.getCaseByChannel(interaction.channelId);
      if (!c) return interaction.editReply('Run this inside a case channel.');

      const judgeId = F.userIdOf(interaction, FIELDS.JUDGE_SELECT);
      if (!judgeId) return interaction.editReply('No judge selected.');

      await cases.appointJudge(interaction, c, judgeId);
      return interaction.editReply(`<@${judgeId}> has been appointed to \`${c.case_number}\`.`);
    }

    default:
      return undefined;
  }
}

module.exports = { handleModal };
