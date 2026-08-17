'use strict';

const { MessageFlags } = require('discord.js');

const config = require('../config');
const store = require('../db');
const perms = require('../lib/perms');
const { IDS, FIELDS, parse } = require('../lib/ids');
const { STAGES } = require('../stages');
const F = require('./fields');
const W = require('../ui/govWizard');
const bar = require('../services/barService');
const { startCountdown, cancelCountdown } = require('../lib/countdown');
const cases = require('../services/caseService');

const EPHEMERAL = MessageFlags.Ephemeral;
async function handleModal(interaction) {
  const { base, arg } = parse(interaction.customId);

  switch (base) {
    /* ── filing a new civil case ──────────────────────────── */

    case IDS.MODAL_INTAKE: {
      await interaction.deferReply({ flags: EPHEMERAL });

      const reason = F.textOf(interaction, FIELDS.REASON);
      if (!reason.trim()) return interaction.editReply('You must explain why you are suing.');

      const defendantRaw = F.textOf(interaction, FIELDS.DEFENDANT);
      if (!defendantRaw.trim()) return interaction.editReply('You must name who you are suing.');

      const { c, channel } = await cases.createCase(interaction, {
        kind: 'person',
        defendantRaw,
        department: null,
        reason,
        links: F.textOf(interaction, FIELDS.LINKS),
        files: F.filesOf(interaction, FIELDS.EVIDENCE),
      });

      return interaction.editReply(
        `Your case **${c.case_number}** has been filed: <#${channel.id}>\n` +
          'A clerk will review it shortly. You will not be able to type in that channel until it is opened.',
      );
    }

    /* ── contesting a criminal charge ─────────────────────── */

    case IDS.MODAL_CRIMINAL: {
      await interaction.deferReply({ flags: EPHEMERAL });

      const charge = F.textOf(interaction, FIELDS.CHARGE).trim();
      const reason = F.textOf(interaction, FIELDS.REASON).trim();
      if (!charge) return interaction.editReply('You must say what you are charged with.');
      if (!reason) return interaction.editReply('You must explain why you are contesting.');

      const { c, channel } = await cases.createCriminalCase(interaction, {
        charge,
        agency: F.textOf(interaction, FIELDS.AGENCY).trim(),
        citation: F.textOf(interaction, FIELDS.CITATION).trim(),
        reason,
        links: null,
        files: F.filesOf(interaction, FIELDS.EVIDENCE),
      });

      return interaction.editReply(
        `Your contest **${c.case_number}** has been filed: <#${channel.id}>\n` +
          'A clerk will review it shortly. You will not be able to type in that channel until it is opened.',
      );
    }

    /* ── leaving a lawyer review ──────────────────────────── */

    case IDS.MODAL_REVIEW: {
      const lawyerId = String(arg);
      if (!store.isClientOf(lawyerId, interaction.user.id)) {
        return interaction.reply({
          content: 'Only clients of this attorney can leave a review.',
          flags: EPHEMERAL,
        });
      }

      const rating = Number(F.radioOf(interaction, FIELDS.RATING)) || 0;
      const body = F.textOf(interaction, FIELDS.REVIEW_BODY).trim();
      if (rating < 1 || rating > 5) {
        return interaction.reply({ content: 'Pick a rating from 1 to 5.', flags: EPHEMERAL });
      }
      if (!body) {
        return interaction.reply({ content: 'Write a sentence or two.', flags: EPHEMERAL });
      }

      store.addReview(lawyerId, interaction.user.id, rating, body);

      await interaction.deferUpdate();
      return interaction.editReply(await bar.profilePayload(interaction, lawyerId, 0));
    }

    /* ── government-claim wizard ──────────────────────────── */

    case IDS.MODAL_GOV_FILES: {
      const draftId = Number(arg);
      const draft = store.getDraft(draftId);
      if (!draft) return interaction.reply({ content: 'That form expired. Start again.', flags: EPHEMERAL });
      if (draft.user_id !== interaction.user.id) {
        return interaction.reply({ content: 'This is not your form.', flags: EPHEMERAL });
      }

      const files = F.filesOf(interaction, FIELDS.GOV_FORMS);
      if (!files.length) {
        return interaction.reply({
          content: 'You must attach your completed Notice of Claim before continuing.',
          flags: EPHEMERAL,
        });
      }

      store.saveDraft(draftId, files, draft.payload);

      const render = (n) => W.govPanel(4, draftId, n);
      await interaction.update(W.govPanel(4, draftId, W.READ_SECONDS, true));
      startCountdown(draftId, interaction, render, W.READ_SECONDS);
      return undefined;
    }

    case IDS.MODAL_GOV_DETAILS: {
      const draftId = Number(arg);
      const draft = store.getDraft(draftId);
      if (!draft) return interaction.reply({ content: 'That form expired. Start again.', flags: EPHEMERAL });
      if (draft.user_id !== interaction.user.id) {
        return interaction.reply({ content: 'This is not your form.', flags: EPHEMERAL });
      }

      const department = F.textOf(interaction, FIELDS.GOV_DEPARTMENT).trim();
      const description = F.textOf(interaction, FIELDS.GOV_DESCRIPTION).trim();
      if (!department) return interaction.reply({ content: 'Name the department.', flags: EPHEMERAL });
      if (!description) return interaction.reply({ content: 'Describe what happened.', flags: EPHEMERAL });

      // Only a bar-certified member can be named as counsel. Anyone else is
      // ignored: naming them would hand a stranger access to a private case
      // channel and register the filer as their "client", which is all it
      // takes to post reviews on that person's profile.
      const pickedAttorney = F.userIdOf(interaction, FIELDS.GOV_ATTORNEY);
      let attorneyId = null;
      if (pickedAttorney) {
        const member = await interaction.guild.members.fetch(pickedAttorney).catch(() => null);
        if (perms.isLawyer(member)) attorneyId = pickedAttorney;
      }

      const payload = {
        department,
        description,
        compensation: F.textOf(interaction, FIELDS.GOV_COMPENSATION).trim(),
        employees: F.userIdsOf(interaction, FIELDS.GOV_EMPLOYEES),
        attorneyId,
        attorneyRejected: Boolean(pickedAttorney) && !attorneyId,
      };

      // Consume the draft BEFORE the slow work (channel creation, downloads,
      // PDF rendering). A second submit of the same draft then finds nothing
      // and cannot open a duplicate channel with a second docket number.
      if (!store.claimDraft(draftId)) {
        return interaction.reply({ content: 'That claim is already being filed.', flags: EPHEMERAL });
      }
      cancelCountdown(draftId);

      // Swap the panel out first, so Continue is gone while we work.
      await interaction.update(W.govFiling());

      const { c, channel } = await cases.createDepartmentCase(interaction, { ...draft, payload });

      return interaction.editReply(
        W.govFiled(c.case_number, channel.id, { attorneyRejected: payload.attorneyRejected }),
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
      if (STAGES[stage]?.collectsCounterparty) {
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
        return interaction.editReply('The two sides cannot be the same person.');
      }

      if (!STAGES[c.stage]?.picksCounterparty) {
        return interaction.editReply('That step is no longer current.');
      }
      if (!store.resolveSubmission(sub.id, 'approved', null, interaction.user.id)) {
        return interaction.editReply('Another clerk just handled this.');
      }

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
