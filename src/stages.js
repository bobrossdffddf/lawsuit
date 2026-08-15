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
};

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

module.exports = { STAGES, PIPELINES, pipelineFor, nextStage, openingStage };
