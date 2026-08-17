'use strict';

const { MessageFlags } = require('discord.js');

const store = require('../db');
const perms = require('../lib/perms');
const { IDS, parse } = require('../lib/ids');
const { STAGES, partyLabel, actorId } = require('../stages');
const M = require('../ui/messages');
const modals = require('../ui/modals');
const W = require('../ui/govWizard');
const L = require('../ui/lawyers');
const bar = require('../services/barService');
const { startCountdown, cancelCountdown } = require('../lib/countdown');
const cases = require('../services/caseService');

const EPHEMERAL = MessageFlags.Ephemeral;

/**
 * A bare one-line V2 message. No ephemeral flag: every use is an edit of an
 * already-ephemeral message, and Discord rejects that bit on an edit.
 */
const note = (content) => ({
  flags: MessageFlags.IsComponentsV2,
  components: [{ type: 10, content }],
  allowedMentions: { parse: [] },
});

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

    case IDS.PANEL_DEPT: {
      const draftId = store.createDraft(interaction.user.id, interaction.guildId, 'department');

      // Acknowledge before rendering. Panel 1 carries no attachments today,
      // but every other panel does, and an unacknowledged upload is a 10062.
      // Deferring here means adding a form to panel 1 can never break it.
      await interaction.deferReply({ flags: EPHEMERAL });

      const render = (n) => W.govPanel(1, draftId, n);
      await interaction.editReply(W.govPanel(1, draftId, W.READ_SECONDS, true));
      startCountdown(draftId, interaction, render, W.READ_SECONDS);
      return undefined;
    }

    /* ── government-claim wizard ──────────────────────────── */

    case IDS.GOV_NEXT: {
      const [stepRaw, draftRaw] = String(arg).split('.');
      const step = Number(stepRaw);
      const draftId = Number(draftRaw);

      const draft = store.getDraft(draftId);
      if (!draft) {
        cancelCountdown(draftId);
        return interaction.update(W.govCancelled());
      }
      if (draft.user_id !== interaction.user.id) {
        return nope(interaction, 'This is not your form.');
      }

      // Steps 3 and 4 collect data, so they open a modal instead of advancing.
      if (step === 3) return interaction.showModal(modals.govFilesModal(draftId));
      if (step === 4) return interaction.showModal(modals.govDetailsModal(draftId));

      // Acknowledge FIRST. Panels 2 and 3 attach court PDFs, and pushing a
      // multipart upload through the interaction callback blows the
      // three-second window — that is a 10062 Unknown interaction, and the
      // filer sees "This interaction failed" with the wizard stuck.
      // deferUpdate() is an empty ack, so the upload happens afterwards with
      // a fifteen-minute budget instead of three seconds.
      await interaction.deferUpdate();

      const render = (n) => W.govPanel(step + 1, draftId, n);
      await interaction.editReply(W.govPanel(step + 1, draftId, W.READ_SECONDS, true));
      startCountdown(draftId, interaction, render, W.READ_SECONDS);
      return undefined;
    }

    case IDS.GOV_CANCEL: {
      const draftId = Number(arg);
      const draft = store.getDraft(draftId);
      if (draft && draft.user_id !== interaction.user.id) {
        return nope(interaction, 'This is not your form.');
      }
      // Stop the running countdown first, or a second later it would redraw the
      // live panel on top of the "Cancelled" message.
      cancelCountdown(draftId);
      store.deleteDraft(draftId);
      return interaction.update(W.govCancelled());
    }

    /* ── /close confirmation chain ────────────────────────── */

    case IDS.CLOSE_NO:
      return interaction.update(note('Cancelled. The case is untouched.'));

    case IDS.CLOSE_YES: {
      if (!perms.isClerk(interaction.member)) {
        return nope(interaction, 'Only clerks may close a case.');
      }
      const c = await caseHere(interaction);
      if (!c) return undefined;
      if (c.status === 'closed') return nope(interaction, 'This case is already closed.');

      const step = Number(arg);
      if (step < 3) return interaction.update(M.closeConfirm(c, step + 1));

      await interaction.update(note(`Closing \`${c.case_number}\`...`));
      const closed = await cases.closeCase(interaction, c);
      return interaction.editReply(
        note(
          closed
            ? `\`${c.case_number}\` is closed and the channel is locked.`
            : 'Another clerk just closed this case.',
        ),
      );
    }

    case IDS.PANEL_ACTIVE:
      return interaction.reply(M.activeCasesList(store.getActiveCases()));

    case IDS.PANEL_CRIMINAL:
      return interaction.showModal(modals.criminalModal());

    /* ── lawyer reviews ───────────────────────────────────── */

    case IDS.REVIEW_BACK: {
      await interaction.deferUpdate();
      return interaction.editReply(L.reviewPanel(await bar.roll(interaction.guild)));
    }

    case IDS.REVIEW_PAGE: {
      const [lawyerId, pageRaw] = String(arg).split('.');
      await interaction.deferUpdate();
      return interaction.editReply(
        await bar.profilePayload(interaction, lawyerId, Number(pageRaw) || 0),
      );
    }

    case IDS.REVIEW_LEAVE: {
      const lawyerId = String(arg);
      if (!store.isClientOf(lawyerId, interaction.user.id)) {
        return nope(interaction, 'Only clients of this attorney can leave a review.');
      }
      return interaction.showModal(modals.reviewModal(lawyerId));
    }

    /* ── an attorney takes a request ──────────────────────── */

    case IDS.LAWYER_ACCEPT: {
      if (!perms.isLawyer(interaction.member)) {
        return nope(interaction, 'Only bar-certified attorneys can accept a request.');
      }
      const request = store.getRequest(Number(arg));
      if (!request) return nope(interaction, 'That request no longer exists.');
      if (request.accepted_by) {
        return nope(interaction, `Already taken by <@${request.accepted_by}>.`);
      }
      const c = store.getCaseById(request.case_id);
      if (!c) return nope(interaction, 'That case no longer exists.');
      if (request.for_user_id === interaction.user.id) {
        return nope(interaction, 'You cannot represent yourself through a request.');
      }

      await interaction.deferUpdate();
      const taken = await cases.acceptLawyerRequest(interaction, request, c);
      if (!taken) {
        return interaction.followUp({ content: 'Another attorney just took it.', flags: EPHEMERAL });
      }
      return interaction.editReply(
        L.lawyerRequestBroadcast(
          c,
          request.id,
          request.for_user_id,
          request.details ?? '',
          interaction.user.id,
        ),
      );
    }

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

      // No admin bypass: only the actual party may file on their own case.
      // The wording comes from the case kind — a criminal filer is the
      // defendant, so "only the plaintiff" would be flatly wrong there.
      const expectedActor = actorId(c, STAGES[stage].actor);
      if (interaction.user.id !== expectedActor) {
        return nope(
          interaction,
          `Only the ${partyLabel(c.kind, STAGES[stage].actor).toLowerCase()} can complete this step.`,
        );
      }

      // Some stages are just an acknowledgement — no upload, no clerk review.
      if (STAGES[stage].noSubmission) {
        await interaction.deferReply({ flags: EPHEMERAL });
        const moved = await cases.advanceWithoutSubmission(interaction, c);
        return interaction.editReply(moved ? 'Moved to the next step.' : 'That step is no longer current.');
      }

      if (store.hasPendingSubmission(c.id, stage)) {
        return nope(
          interaction,
          'You already have a submission waiting on a clerk for this step. ' +
            'Wait for it to be approved or denied before sending another.',
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

      // Stages that bring in the other side need the clerk to identify them
      // first — civil service picks the defendant, criminal notify the State.
      if (STAGES[sub.stage]?.picksCounterparty) {
        return interaction.showModal(
          modals.serviceApproveModal(sub.id, sub.payload?.defendantId, c.kind),
        );
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

/** The two attorney dropdowns on the /review panel. */
async function handleSelect(interaction) {
  const { base } = parse(interaction.customId);
  if (base !== IDS.REVIEW_PICK_AM && base !== IDS.REVIEW_PICK_NZ) return undefined;

  const lawyerId = interaction.values?.[0];
  if (!lawyerId) return undefined;

  await interaction.deferUpdate();
  return interaction.editReply(await bar.profilePayload(interaction, lawyerId, 0));
}

module.exports = { handleButton, handleSelect };
