'use strict';

const { MessageFlags } = require('discord.js');

const { IDS, withArg } = require('../lib/ids');
const U = require('./common');

const { V2, STYLE } = U;

/** Added only on the very first reply — never on an edit. */
const EPHEMERAL = MessageFlags.Ephemeral;

/** How long the Continue button stays greyed out on each panel. */
const READ_SECONDS = 5;

/* ── panel copy ──────────────────────────────────────────────── */

const PANELS = [
  {
    // 1 — the ground rules
    forms: [],
    body:
      `${U.title('Suing a Department')}\n` +
      'To sue a department you must follow the directions below. Please read each panel thoroughly. ' +
      'Failure to follow the directions will result in a rejection of your claim. Please note these ' +
      'things before we continue\n\n' +
      '> 1. The state limits payouts to a maximum of $200,000 per person and $300,000 per incident.\n' +
      '> 2. Individual government employees, officers, and agents cannot be held personally liable or ' +
      'named as defendants in a lawsuit for actions taken within the scope of their employment. ' +
      '(exeption in section 3)\n' +
      '> 3. An employee can only be sued individually if they acted in bad faith, with malicious ' +
      'purpose, or in a manner showing wanton and willful disregard for human rights, safety, or ' +
      'property.\n' +
      '> 4. No one can sue the state for damages if their injuries arose while they were unlawfully ' +
      'participating in a riot, mob violence, or civil disobedience.\n\n',
  },
  {
    // 2 — the two optional forms
    forms: ['AD05', 'AD03'],
    blocks: () => [
      U.text(
        `${U.title('Suing a Department')}\n` +
          'To begin we recommend that you fill out these 2 forms. This part is NOT mandatory but is ' +
          'highly recommended. The first form is an Internal Affairs complaint. It is not required, ' +
          'but it creates a written record and forces the agency to investigate. Its findings become ' +
          'evidence later.',
      ),
      U.formRef('AD05'),
      U.text(
        'The next recommended form is a Public Records Request form. You do not have to say why you ' +
          'want records and you do not have to give your real identity. Remeber this form is not ' +
          'required but it can help ',
      ),
      U.formRef('AD03'),
    ],
  },
  {
    // 3 — the mandatory notice of claim; Continue opens the upload modal
    forms: ['CV04'],
    opensModal: true,
    blocks: () => [
      U.text(
        `${U.title('Suing a Department')}\n` +
          'Now you must serve a Notice of Claim this part is mandatory. The agency gets 45 days to ' +
          'investigate and respond. To avoid stalling if the agency does not provide some sort of ' +
          'update every 7 days you will be allowed to continue. Please fill this out, you will then ' +
          'be asked to submit it. A clerk will then review it and approve or deny it. After you will ' +
          'be instructed to create a ticket in the department that you are suing and send it there. ' +
          'Please ask for the clerk to be added to the ticket.',
      ),
      U.formRef('CV04'),
    ],
  },
  {
    // 4 — collect the claim details; Continue opens the details modal
    forms: [],
    opensModal: true,
    body:
      `${U.title('Suing a Department')}\n` +
      'You are close to being done! All you need now is to fill out some information to give to the ' +
      'clerk. Please do not do anything until a clerk instructs you to do so. Please press the ' +
      'continue button and fill out all necessary information.',
  },
];

/* ── rendering ───────────────────────────────────────────────── */

/**
 * Builds one wizard panel.
 * @param {number} step   1-based panel number
 * @param {number} draftId
 * @param {number} remaining seconds left on the Continue button (0 = enabled)
 * @param {boolean} withFiles attach the court PDFs. Only the first render needs
 *   them — an edit that omits `files` leaves the existing attachments in place,
 *   so the countdown ticks do not re-upload the same PDFs once per second.
 */
function govPanel(step, draftId, remaining = READ_SECONDS, withFiles = false) {
  const panel = PANELS[step - 1];
  if (!panel) throw new Error(`unknown government wizard step ${step}`);

  const locked = remaining > 0;
  const inner = panel.blocks ? panel.blocks() : [U.text(panel.body)];

  inner.push(
    U.sep(2),
    U.row(
      U.button(
        withArg(IDS.GOV_NEXT, `${step}.${draftId}`),
        locked ? `Continue (${remaining})` : 'Continue',
        STYLE.SECONDARY,
        locked ? { disabled: true } : {},
      ),
      U.button(withArg(IDS.GOV_CANCEL, draftId), 'Cancel', STYLE.DANGER),
    ),
  );

  const payload = {
    flags: V2,
    components: [U.container(inner)],
    allowedMentions: { parse: [] },
  };
  if (withFiles) payload.files = U.formAttachments(panel.forms);
  return payload;
}

/** Terminal panel shown when the filer backs out. */
function govCancelled() {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Suing a Department')}\n` +
            'Cancelled. Nothing was filed. Press **Sue a Department** on the panel whenever you want ' +
            'to start again.',
        ),
      ]),
    ],
    allowedMentions: { parse: [] },
  };
}

/** Shown while the case channel is being created — no buttons to double-press. */
function govFiling() {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Suing a Department')}\n` +
            'Filing your claim and opening your case channel. This takes a moment while your ' +
            'documents are archived with the clerk of court...',
        ),
      ]),
    ],
    allowedMentions: { parse: [] },
  };
}

/** Terminal panel shown once the case channel exists. */
function govFiled(caseNumber, channelId, opts = {}) {
  const lines = [
    `${U.title('Suing a Department')}\n` +
      `Your claim **${caseNumber}** has been filed: <#${channelId}>\n\n` +
      '> A clerk will review your notice of claim package shortly. You will not be able to type ' +
      'in that channel until the claim is opened.',
  ];
  if (opts.attorneyRejected) {
    lines.push(
      '-# The person you named as your attorney is not bar certified, so they were not added. ' +
        'Ask a clerk to request counsel for you.',
    );
  }

  return {
    flags: V2,
    components: [U.container([U.text(lines.join('\n'))])],
    allowedMentions: { parse: [] },
  };
}

/** Wraps any wizard payload for its one-and-only initial reply. */
const ephemeral = (payload) => ({ ...payload, flags: payload.flags | EPHEMERAL });

module.exports = {
  govPanel,
  govCancelled,
  govFiling,
  govFiled,
  ephemeral,
  READ_SECONDS,
  PANEL_COUNT: PANELS.length,
};
