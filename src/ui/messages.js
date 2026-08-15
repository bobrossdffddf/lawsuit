'use strict';

const config = require('../config');
const { IDS, withArg } = require('../lib/ids');
const { STAGES } = require('../stages');
const fmt = require('../lib/format');
const U = require('./common');

const { V2, T, STYLE } = U;

/* ══════════════════════════════════════════════════════════════
   1. Public lawsuit panel  ($lawsuits / /panel)
   ══════════════════════════════════════════════════════════════ */

function lawsuitPanel() {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Lawsuit Pannel')}\n` +
            "Do you feel like you have been wronged by the state of Florida or another Floridian? " +
            "Well if thats the case you've came to the correct place, Here in the government server " +
            'you can file lawsuits against the person or department that has wronged you or you can ' +
            'view the active lawsuits that are currently being processed by the government.\n',
        ),
        U.sep(2),
        U.row(
          U.button(IDS.PANEL_FILE, 'File a Lawsuit', STYLE.PRIMARY),
          U.button(IDS.PANEL_DEPT, 'Sue a Department', STYLE.SECONDARY),
          U.button(IDS.PANEL_ACTIVE, 'Active Civil Cases', STYLE.SUCCESS),
        ),
      ]),
    ],
  };
}

/* ══════════════════════════════════════════════════════════════
   2. Intake — first message in a brand new case channel
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {object} c        case row
 * @param {object} media    result of buildMedia() for the intake evidence
 */
function intakeMessage(c, media = { galleryItems: [], fileComponents: [], overflowLinks: [] }) {
  const defendantLabel = c.kind === 'department' ? c.department : c.defendant_raw;
  const body = [
    `${U.title(`${c.case_number} <@${c.plaintiff_id}> V. ${fmt.clean(defendantLabel, 80)}`)}\n` +
      'ㅤ\n' +
      `> Defendant: ${fmt.clean(defendantLabel, 200)}\n` +
      `> Reason: ${fmt.clean(c.reason, 900)}\n` +
      'ㅤ\n' +
      `> Links: ${fmt.hyperlink(c.links)}\n`,
  ];

  if (media.overflowLinks?.length) {
    body.push(
      `-# Attachments too large to mirror: ${media.overflowLinks
        .map((o) => `[${o.name}](${o.url})`)
        .join(' · ')}`,
    );
  }

  const inner = [U.text(body.join('\n'))];
  if (media.galleryItems?.length) inner.push({ type: T.GALLERY, items: media.galleryItems });
  inner.push(...(media.fileComponents ?? []));
  inner.push(
    U.sep(2),
    U.row(
      U.button(IDS.CASE_OPEN, 'Open Case', STYLE.SUCCESS),
      U.button(IDS.CASE_DENY, 'Deny Case', STYLE.DANGER),
    ),
  );

  return {
    flags: V2,
    components: [
      U.text(`<@&${config.roles.clerk}>`),
      U.container(inner),
      U.bareContainer([
        U.text(
          `## Dear <@${c.plaintiff_id}>,\n` +
            '> Please allow our clerks time to review your case. If your case gets denied then feel ' +
            'free to re-file with any changes that the clerk requested. You are not able to type in ' +
            'this channel until your case gets accepted. Please take this time to hire a lawyer or ' +
            'study up if you will be representing yourself pro se. If you have any questions please ' +
            `feel free to visit ${U.channelRef(config.channels.support)}.\n`,
        ),
      ]),
    ],
    allowedMentions: U.mentions([c.plaintiff_id], [config.roles.clerk]),
  };
}

/* ══════════════════════════════════════════════════════════════
   3. Intake denied — DM to the plaintiff
   ══════════════════════════════════════════════════════════════ */

function intakeDenialDM(c, reason, clerkId) {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Florida Lawsuit')}\n` +
            `> ## Dear <@${c.plaintiff_id}>,\n` +
            '>>> \n' +
            'Unfortunately your lawsuit was denied. Please note that this does **not** mean you ' +
            'cannot resubmit your case. Please review the reason for the denial then resubmit if ' +
            'applicable. Please do not DM (Direct Message) the clerk that reviewed your case (or ' +
            'any clerk) about this rejection. If you think a mistake was made then please get ' +
            `support in ${U.channelRef(config.channels.support)}.\n\n` +
            'Thank you for your attention.',
        ),
        U.sep(2),
        U.text(
          `**Case:** \`${c.case_number}\`\n` +
            `**Reason for denial:**\n>>> ${fmt.clean(reason, 900)}`,
        ),
      ]),
    ],
    allowedMentions: U.mentions([c.plaintiff_id]),
  };
}

/** Mirror of the denial posted in-channel, for the record. */
function intakeDeniedNotice(c, reason, clerkId) {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Case Denied')}\n` +
            `\`${c.case_number}\` was denied by <@${clerkId}>.\n\n` +
            `> Reason: ${fmt.clean(reason, 900)}`,
        ),
      ]),
    ],
    allowedMentions: U.mentions([clerkId]),
  };
}

/* ══════════════════════════════════════════════════════════════
   4. Stage prompts — the "do this next" message for each stage
   ══════════════════════════════════════════════════════════════ */

const AI_NOTE =
  'To continue follow the directions given. If you have any questions then please feel free to ping ' +
  'a clerk. If you don’t know what to put don’t be afraid to **ASK** AI. Please don’t send a document ' +
  'entirely of AI. ';

/** Body blocks (text + file components) for each stage, minus the header line. */
function stageBody(stage, c) {
  switch (stage) {
    case 'complaint':
      return [
        U.text(
          '\nTo start please fill out one of these 2 forms:\n\n' +
            'Use this form for disputes from $8,000 or less ',
        ),
        U.fileRef(U.formName('CV05')),
        U.text('Fill out this form for disputes $8,001 - $50,000+'),
        U.fileRef(U.formName('CV01')),
      ];

    case 'summons':
      return [
        U.text(
          '\nTo continue please fill this form. This form is a summons, it is used to notify them ' +
            'that a lawsuit has been filed against them and gives them time to respond. You will ' +
            'need to serve this to them. You can do this by approaching them, informing them that ' +
            'they have been served, and sending them the completed version of this form. You may ' +
            'also hire or ask someone to do this on your behalf. Remember to get a photo or video ' +
            "of you serving them. (You may also send it in their DM's or inform them by joining " +
            'the same VC but they must acknowledge in some way.)\nㅤ\n',
        ),
        U.fileRef(U.formName('CV02')),
      ];

    case 'service':
      return [
        U.text(
          '\nTo continue you must serve the defendant in your case. Please get a video and/or ' +
            'photo of you giving or sending the defendant the summons.\n',
        ),
        U.fileRef(U.formName('CV02')),
      ];

    case 'answer':
      return [
        U.text(
          `\nHello <@${c.defendant_id}>. You have been added to this ticket because you are the ` +
            'subject of a lawsuit. You can find the complaint below. Failure to comply with the ' +
            'courts next steps will result in a default judgment being entered against you for the ' +
            'full amount demanded. We recommend you get an attorney and inform the clerk so that ' +
            'they can be added to the ticket.\nㅤ\n' +
            'Below is the civil complaint. You should have received a summons when you were served. ',
        ),
        U.fileRef(U.formName('CV02')),
        U.text(
          'ㅤ\nNow you must fill out the ANSWER AND AFFIRMATIVE DEFENSES form. This form is your ' +
            'written response to a complaint. ',
        ),
        U.fileRef(U.formName('CV03')),
      ];

    default:
      return [];
  }
}

/** Which court forms must be attached for a stage's `attachment://` refs to resolve. */
const STAGE_FORMS = {
  complaint: ['CV05', 'CV01'],
  summons: ['CV02'],
  service: ['CV02'],
  answer: ['CV02', 'CV03'],
};

/** Header line shown above the body when the stage is entered normally. */
const STAGE_HEADERS = {
  complaint: (c) =>
    `${U.title('Case opened!')}\n` +
    `Congrats <@${c.plaintiff_id}>! Your case has been approved and moved to the next stage. ${AI_NOTE}`,
  summons: () =>
    `${U.title('Step One Completed!')}\n` +
    `Step 1 has been completed and you have been approved to move to the next stage. ${AI_NOTE}`,
  service: () =>
    `${U.title('Step Two Completed!')}\n` +
    `Step 2 has been completed and you have been approved to move to the next stage. ${AI_NOTE}`,
  answer: () => `${U.title('Lawsuit Pending...')}`,
};

/**
 * Builds the prompt message for a stage.
 * @param {string} stage
 * @param {object} c case row
 * @param {{denialReason?: string}} [opts] when set, renders the "denied, try again" variant
 */
function stagePrompt(stage, c, opts = {}) {
  const meta = STAGES[stage];
  const isDenial = Boolean(opts.denialReason);

  const header = isDenial
    ? `${U.title(meta.denyTitle)}\n` +
      'Your submission has been denied. Please review the feedback then resubmit the form. ' +
      'Remember, its okay to **ASK** AI.\n\n' +
      `> Reason for denial: ${fmt.clean(opts.denialReason, 800)}\n`
    : STAGE_HEADERS[stage](c);

  const inner = [U.text(header), ...stageBody(stage, c)];

  inner.push(
    U.sep(2),
    U.row(
      U.button(withArg(IDS.STEP_NEXT, stage), 'Next Step', STYLE.SECONDARY),
      U.pill(meta.pill, stage),
    ),
  );

  if (stage === 'answer') {
    inner.push(U.text('-# Only the defendant is able to do this part.'));
  } else {
    inner.push(U.text('-# Only the plaintiff is able to do this part.'));
  }

  const mentionUsers = [c.plaintiff_id];
  if (c.defendant_id) mentionUsers.push(c.defendant_id);

  return {
    flags: V2,
    components: [U.container(inner)],
    files: STAGE_FORMS[stage].map(U.formAttachment),
    allowedMentions: U.mentions(mentionUsers),
  };
}

/* ══════════════════════════════════════════════════════════════
   5. Clerk review of a submission
   ══════════════════════════════════════════════════════════════ */

function reviewMessage(stage, c, submissionId, media, submitterId, extraLines = []) {
  const meta = STAGES[stage];
  const inner = [
    U.text(`${U.title(meta.reviewTitle)}\n`),
    U.text(
      `Please allow our clerks a moment to review your forms. \n` +
        `-# Submitted by <@${submitterId}> · ${fmt.timestamp()}`,
    ),
  ];

  if (extraLines.length) inner.push(U.text(extraLines.join('\n')));
  if (media.galleryItems?.length) inner.push({ type: T.GALLERY, items: media.galleryItems });
  inner.push(...(media.fileComponents ?? []));

  if (media.overflowLinks?.length) {
    inner.push(
      U.text(
        `-# Files too large to mirror here: ${media.overflowLinks
          .map((o) => `[${o.name}](${o.url})`)
          .join(' · ')}`,
      ),
    );
  }

  inner.push(
    U.sep(2),
    U.row(
      U.button(withArg(IDS.REVIEW_OK, submissionId), 'Approve', STYLE.SUCCESS),
      U.button(withArg(IDS.REVIEW_NO, submissionId), 'Deny', STYLE.DANGER),
    ),
    U.text(`-# Only <@&${config.roles.clerk}> may approve or deny.`),
  );

  return {
    flags: V2,
    components: [U.text(`<@&${config.roles.clerk}>`), U.container(inner)],
    files: media.attachments ?? [],
    allowedMentions: U.mentions([submitterId], [config.roles.clerk]),
  };
}

/** Rewrites a review message after it has been resolved, so the buttons go away. */
function reviewResolved(stage, c, media, submitterId, status, actorId, reason) {
  const meta = STAGES[stage];
  const verdict =
    status === 'approved'
      ? `**Approved** by <@${actorId}> · ${fmt.timestamp()}`
      : `**Denied** by <@${actorId}> · ${fmt.timestamp()}\n> ${fmt.clean(reason, 700)}`;

  const inner = [
    U.text(`${U.title(meta.reviewTitle)}\n${verdict}`),
    U.text(`-# Submitted by <@${submitterId}>`),
  ];
  if (media.galleryItems?.length) inner.push({ type: T.GALLERY, items: media.galleryItems });
  inner.push(...(media.fileComponents ?? []));

  return {
    flags: V2,
    components: [U.container(inner)],
    allowedMentions: U.mentions([submitterId, actorId]),
  };
}

/* ══════════════════════════════════════════════════════════════
   6. Docketed / discovery / exhibits
   ══════════════════════════════════════════════════════════════ */

function lawsuitFiled(c) {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Lawsuit Filed.')}\n` +
            'The lawsuit has been filed. A judge will be assigned to your case soon. In the meantime ' +
            'a discovery thread will be opened. **ANY AND ALL EVIDENCE THAT WILL BE USED IN TRIAL ' +
            'MUST BE SENT IN THAT THREAD.** Any evidence not in the thread cannot be used in trial ' +
            'with minimal exceptions.',
        ),
      ]),
    ],
  };
}

function discoveryHeader(c) {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Discovery')}\n` +
            'Please put any evidence here. In this channel please only put files. Once you submit a ' +
            'file it will be categorized and given a name. This will be how the evidence will ' +
            'referred to. ',
        ),
      ]),
    ],
  };
}

function exhibitFiled(letter, filename) {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title(`Filed - Exhibit ${letter}`)}\n` +
            `${fmt.timestamp()}\n-# ${fmt.clean(filename, 120)}`,
        ),
      ]),
    ],
  };
}

function judgeAppointed(c, judgeId) {
  const parties = [`<@${c.plaintiff_id}>`];
  if (c.defendant_id) parties.push(`<@${c.defendant_id}>`);

  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Lawsuit Status - Judge Appointed')}\n` +
            `Hello ${parties.join(' and ')}\n\n` +
            `> <@${judgeId}> has been appointed to your case. Please allow them some time to review ` +
            'the facts of your case. Once they are ready they will ask the clerk to start the ' +
            'scheduling process. The next steps are: Pretrial Conference → Trial → Final Judgment.',
        ),
      ]),
    ],
    allowedMentions: U.mentions([c.plaintiff_id, c.defendant_id, judgeId].filter(Boolean)),
  };
}

/* ══════════════════════════════════════════════════════════════
   7. Misc
   ══════════════════════════════════════════════════════════════ */

const STAGE_LABEL = {
  intake: 'Awaiting clerk review',
  complaint: 'Complaint',
  summons: 'Summons',
  service: 'Service of process',
  answer: 'Awaiting answer',
  filed: 'Filed — discovery open',
};

function activeCasesList(cases) {
  if (!cases.length) {
    return {
      flags: V2 | 64,
      components: [U.container([U.text(`${U.title('Active Civil Cases')}\nThere are no active civil cases right now.`)])],
    };
  }

  const lines = cases
    .slice(0, 40)
    .map((c) => {
      const def = c.defendant_id
        ? `<@${c.defendant_id}>`
        : fmt.clean(c.kind === 'department' ? c.department : c.defendant_raw, 40);
      return `> \`${c.case_number}\` — <@${c.plaintiff_id}> v. ${def}\n> -# ${STAGE_LABEL[c.stage] ?? c.stage}${c.judge_id ? ` · Judge <@${c.judge_id}>` : ''} · <#${c.channel_id}>`;
    })
    .join('\n\n');

  return {
    flags: V2 | 64,
    components: [
      U.container([
        U.text(`${U.title('Active Civil Cases')}\n${fmt.truncate(lines, 3400)}`),
      ]),
    ],
    allowedMentions: { parse: [] },
  };
}

function welcomeMessage(member) {
  return {
    flags: V2,
    components: [
      U.container([
        U.text(
          `${U.title('Welcome to the State of Florida')}\n` +
            `Welcome <@${member.id}>! You are member **#${member.guild.memberCount}**.\n\n` +
            '> Please read the rules, grab your roles, and review the court procedures before ' +
            'filing anything with the clerk of court.\n' +
            `> Questions about a case? Head to ${U.channelRef(config.channels.support)}.`,
        ),
      ]),
    ],
    allowedMentions: U.mentions([member.id]),
  };
}

module.exports = {
  lawsuitPanel,
  intakeMessage,
  intakeDenialDM,
  intakeDeniedNotice,
  stagePrompt,
  reviewMessage,
  reviewResolved,
  lawsuitFiled,
  discoveryHeader,
  exhibitFiled,
  judgeAppointed,
  activeCasesList,
  welcomeMessage,
  STAGE_FORMS,
  STAGE_LABEL,
};
