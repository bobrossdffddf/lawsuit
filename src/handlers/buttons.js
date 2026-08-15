'use strict';

const { MessageFlags } = require('discord.js');

const store = require('../db');
const perms = require('../lib/perms');
const { IDS, parse } = require('../lib/ids');
const { STAGES } = require('../stages');
const M = require('../ui/messages');
const modals = require('../ui/modals');
const cases = require('../services/caseService');

const EPHEMERAL = MessageFlags.Ephemeral;

const nope = (interaction, content) =>
  interaction.reply({ content, flags: EPHEMERAL }).catch(() => {});

/** Finds the case this interaction belongs to, or replies with an error. */
async function caseHere(interaction) {
  const c = store.getCaseByChannel(interaction.channelId);
  if (!c) {
    await nope(interaction, 'This channel is not a tracked case.');
    return null;
  }
  return c;
}

async function handleButton(interaction) {
  const { base, arg } = parse(interaction.customId);

  switch (base) {
    /* ── public panel ─────────────────────────────────────── */

    case IDS.PANEL_FILE:
      return interaction.showModal(modals.intakeModal());

    case IDS.PANEL_DEPT:
      return interaction.showModal(modals.departmentModal());

    case IDS.PANEL_ACTIVE:
      return interaction.reply(M.activeCasesList(store.getActiveCases()));

    /* ── intake decision ──────────────────────────────────── */

    case IDS.CASE_OPEN: {
      if (!perms.isClerk(interaction.member)) {
        return nope(interaction, 'Only clerks may open or deny a case.');
      }
      const c = await caseHere(interaction);
      if (!c) return undefined;
      if (c.status !== 'intake') {
        return nope(interaction, `This case has already been ${c.status}.`);
      }

      await interaction.deferReply({ flags: EPHEMERAL });
      const opened = await cases.openCase(interaction, c);
      return interaction.editReply(
        opened
          ? `Case \`${c.case_number}\` is now open. The plaintiff can post.`
          : 'Another clerk just handled this case.',
      );
    }

    case IDS.CASE_DENY: {
      if (!perms.isClerk(interaction.member)) {
        return nope(interaction, 'Only clerks may open or deny a case.');
      }
      const c = await caseHere(interaction);
      if (!c) return undefined;
      if (c.status !== 'intake') {
        return nope(interaction, `This case has already been ${c.status}.`);
      }
      return interaction.showModal(modals.caseDenyModal());
    }

    /* ── stage submissions ────────────────────────────────── */

    case IDS.STEP_NEXT: {
      const c = await caseHere(interaction);
      if (!c) return undefined;

      const stage = arg;
      if (!STAGES[stage]) return nope(interaction, 'Unknown step.');
      if (c.stage !== stage) {
        return nope(
          interaction,
          `This step is no longer current — the case has moved on to **${M.STAGE_LABEL[c.stage] ?? c.stage}**. ` +
            'Use the most recent message in this channel.',
        );
      }

      if (store.hasPendingSubmission(c.id, stage)) {
        return nope(
          interaction,
          'You already have a submission waiting on a clerk for this step. ' +
            'Wait for it to be approved or denied before sending another.',
        );
      }

      const expected = STAGES[stage].actor === 'defendant' ? c.defendant_id : c.plaintiff_id;
      if (interaction.user.id !== expected && !perms.isAdmin(interaction.member)) {
        return nope(
          interaction,
          STAGES[stage].actor === 'defendant'
            ? 'Only the defendant can complete this step.'
            : 'Only the plaintiff can complete this step.',
        );
      }

      return interaction.showModal(modals.stepModal(stage));
    }

    /* ── clerk review of a submission ─────────────────────── */

    case IDS.REVIEW_OK:
    case IDS.REVIEW_NO: {
      if (!perms.isClerk(interaction.member)) {
        return nope(interaction, 'Only clerks may approve or deny submissions.');
      }
      const c = await caseHere(interaction);
      if (!c) return undefined;

      const sub = store.getSubmission(Number(arg));
      if (!sub || sub.case_id !== c.id) return nope(interaction, 'That submission no longer exists.');
      if (sub.status !== 'pending') {
        return nope(interaction, `That submission was already **${sub.status}**.`);
      }

      if (base === IDS.REVIEW_NO) {
        return interaction.showModal(modals.reviewDenyModal(sub.id));
      }

      if (sub.stage !== c.stage) {
        return nope(
          interaction,
          `This card is out of date — the case has moved on to **${M.STAGE_LABEL[c.stage] ?? c.stage}**.`,
        );
      }

      // Approving the proof of service needs the clerk to identify the defendant.
      if (sub.stage === 'service') {
        return interaction.showModal(modals.serviceApproveModal(sub.id, sub.payload?.defendantId));
      }

      await interaction.deferReply({ flags: EPHEMERAL });
      const advanced = await cases.approveSubmission(interaction, c, sub);
      return interaction.editReply(
        advanced ? 'Approved. The next step has been posted.' : 'Another clerk just handled this.',
      );
    }

    default:
      return undefined; // progress pills and anything unknown
  }
}

module.exports = { handleButton };
