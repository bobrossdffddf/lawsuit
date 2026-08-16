'use strict';

/**
 * Two pipelines, one per kind of case.
 *
 * person (a civil suit against another Floridian):
 *   intake     clerk decides whether the complaint is worth docketing
 *   complaint  plaintiff files CV-01 or CV-05          (button pill 1/3)
 *   summons    plaintiff files the completed CV-02     (button pill 2/3)
 *   service    plaintiff proves the defendant was served + names them (2/3)
 *   answer     defendant files CV-03                   (button pill 3/3)
 *   filed      docketed; discovery thread is open
 *
 * department (a claim against a government entity):
 *   intake     clerk reviews the notice of claim package
 *   notice     plaintiff serves CV-04 on the agency and waits for a response
 *   filed      docketed; discovery thread is open
 *
 * `actor` is who may press "Next Step" at that stage.
 * `noSubmission` stages advance on the button press alone — no upload modal.
 */
const STAGES = {
  intake: {},

  /* ── civil ─────────────────────────────────────────────── */

  complaint: {
    pill: '1/3',
    actor: 'plaintiff',
    denyTitle: 'Step One Denied',
    reviewTitle: 'Step 1 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 1/3',
  },

  summons: {
    pill: '2/3',
    actor: 'plaintiff',
    denyTitle: 'Step Two Denied',
    reviewTitle: 'Step 2 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 2/3',
  },

  service: {
    pill: '2/3',
    actor: 'plaintiff',
    picksCounterparty: true,
    denyTitle: 'Proof of Service Denied',
    reviewTitle: 'Proof of Service - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 2/3',
  },

  answer: {
    pill: '3/3',
    actor: 'defendant',
    denyTitle: 'Answer Denied',
    reviewTitle: 'Step 3 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 3/3',
  },

  /* ── criminal ──────────────────────────────────────────── */

  contest: {
    pill: '1/3',
    actor: 'plaintiff',
    denyTitle: 'Step One Denied',
    reviewTitle: 'Step 1 - Waiting on clerk',
    modalTitle: 'Criminal Contest 1/3',
  },

  motion: {
    pill: '2/3',
    actor: 'plaintiff',
    denyTitle: 'Step Two Denied',
    reviewTitle: 'Step 2 - Waiting on clerk',
    modalTitle: 'Criminal Contest 2/3',
  },

  notify: {
    pill: '2/3',
    actor: 'plaintiff',
    picksCounterparty: true,
    denyTitle: 'Notice to the State Denied',
    reviewTitle: 'Notice to the State - Waiting on clerk',
    modalTitle: 'Criminal Contest 2/3',
  },

  response: {
    pill: '3/3',
    actor: 'defendant',
    denyTitle: 'State Response Denied',
    reviewTitle: 'Step 3 - Waiting on clerk',
    modalTitle: 'Criminal Contest 3/3',
  },

  /* ── department ────────────────────────────────────────── */

  notice: {
    actor: 'plaintiff',
    noSubmission: true,
    denyTitle: 'Notice of Claim Denied',
    reviewTitle: 'Notice of Claim - Waiting on clerk',
  },

  filed: {},
};

const PIPELINES = {
  person: ['intake', 'complaint', 'summons', 'service', 'answer', 'filed'],
  department: ['intake', 'notice', 'filed'],
  criminal: ['intake', 'contest', 'motion', 'notify', 'response', 'filed'],
};

/** Human label for the two sides, which differ by kind of case. */
const PARTY_LABELS = {
  person: { plaintiff: 'Plaintiff', defendant: 'Defendant' },
  department: { plaintiff: 'Claimant', defendant: 'Agency' },
  criminal: { plaintiff: 'Accused', defendant: 'State' },
};

const partyLabel = (kind, side) => (PARTY_LABELS[kind] ?? PARTY_LABELS.person)[side];

const pipelineFor = (kind) => PIPELINES[kind] ?? PIPELINES.person;

/** The stage that follows `stage` for this kind of case, or null at the end. */
function nextStage(kind, stage) {
  const pipeline = pipelineFor(kind);
  const i = pipeline.indexOf(stage);
  if (i === -1 || i === pipeline.length - 1) return null;
  return pipeline[i + 1];
}

/** The first stage after intake — where a case lands when a clerk opens it. */
const openingStage = (kind) => pipelineFor(kind)[1];

module.exports = { STAGES, PIPELINES, PARTY_LABELS, partyLabel, pipelineFor, nextStage, openingStage };
