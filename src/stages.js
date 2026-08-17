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
 * `actor` is who may press "Next Step": `filer` is whoever opened the case,
 * `counterparty` is the other side. What those are CALLED depends on the kind
 * of case — see PARTY_LABELS. Never hardcode "plaintiff" or "defendant" in
 * copy; a criminal filer is the defendant, and calling them the plaintiff is
 * what made the criminal flow read as nonsense.
 *
 * `noSubmission`       advances on the button press alone, no upload modal.
 * `collectsCounterparty` the filer supplies the other side's handle in their
 *                      own modal — only true where the filer genuinely serves
 *                      them (civil service of process).
 * `picksCounterparty`  the clerk identifies the other side when they approve.
 */
const STAGES = {
  intake: {},

  /* ── civil ─────────────────────────────────────────────── */

  complaint: {
    pill: '1/3',
    actor: 'filer',
    denyTitle: 'Step One Denied',
    reviewTitle: 'Step 1 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 1/3',
  },

  summons: {
    pill: '2/3',
    actor: 'filer',
    denyTitle: 'Step Two Denied',
    reviewTitle: 'Step 2 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 2/3',
  },

  service: {
    pill: '2/3',
    actor: 'filer',
    collectsCounterparty: true,
    picksCounterparty: true,
    denyTitle: 'Proof of Service Denied',
    reviewTitle: 'Proof of Service - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 2/3',
  },

  answer: {
    pill: '3/3',
    actor: 'counterparty',
    denyTitle: 'Answer Denied',
    reviewTitle: 'Step 3 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 3/3',
  },

  /* ── criminal ────────────────────────────────────────────
     The accused is the DEFENDANT. They never serve or name the
     prosecution — the court assigns it. So nothing here asks the
     defendant for the prosecutor's details; the clerk picks them
     when approving the motions step.
     ────────────────────────────────────────────────────────── */

  appearance: {
    pill: '1/3',
    actor: 'filer',
    denyTitle: 'Notice of Appearance Denied',
    reviewTitle: 'Step 1 - Waiting on clerk',
    modalTitle: 'Criminal Case 1/3',
  },

  motions: {
    pill: '2/3',
    actor: 'filer',
    picksCounterparty: true,
    denyTitle: 'Motion Denied',
    reviewTitle: 'Step 2 - Waiting on clerk',
    modalTitle: 'Criminal Case 2/3',
  },

  prosecution: {
    pill: '3/3',
    actor: 'counterparty',
    denyTitle: 'State Filing Denied',
    reviewTitle: 'Step 3 - Waiting on clerk',
    modalTitle: 'Criminal Case 3/3',
  },

  /* ── department ────────────────────────────────────────── */

  notice: {
    actor: 'filer',
    noSubmission: true,
    denyTitle: 'Notice of Claim Denied',
    reviewTitle: 'Notice of Claim - Waiting on clerk',
  },

  filed: {},
};

const PIPELINES = {
  person: ['intake', 'complaint', 'summons', 'service', 'answer', 'filed'],
  department: ['intake', 'notice', 'filed'],
  criminal: ['intake', 'appearance', 'motions', 'prosecution', 'filed'],
};

/**
 * What each side is CALLED, per kind of case. `filer` opened the case;
 * `counterparty` is the other side. In a criminal matter the filer is the
 * defendant and the counterparty is the prosecution — the exact opposite of
 * a civil suit, which is why every label goes through here.
 */
const PARTY_LABELS = {
  person: { filer: 'Plaintiff', counterparty: 'Defendant' },
  department: { filer: 'Claimant', counterparty: 'Agency' },
  criminal: { filer: 'Defendant', counterparty: 'Prosecution' },
};

const partyLabel = (kind, side) => (PARTY_LABELS[kind] ?? PARTY_LABELS.person)[side] ?? side;

/** The user id of whichever side an actor refers to, for this case. */
const actorId = (c, actor) => (actor === 'counterparty' ? c.defendant_id : c.plaintiff_id);

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

module.exports = {
  STAGES,
  PIPELINES,
  PARTY_LABELS,
  partyLabel,
  actorId,
  pipelineFor,
  nextStage,
  openingStage,
};
