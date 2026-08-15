'use strict';

/**
 * The civil case pipeline, in order.
 *
 *   intake     clerk decides whether the complaint is worth docketing
 *   complaint  plaintiff files CV-01 or CV-05          (button pill 1/3)
 *   summons    plaintiff files the completed CV-02     (button pill 2/3)
 *   service    plaintiff proves the defendant was served + names them (2/3)
 *   answer     defendant files CV-03                   (button pill 3/3)
 *   filed      docketed; discovery thread is open
 *
 * `actor` is who is allowed to press "Next Step" at that stage.
 */
const STAGES = {
  intake: { next: 'complaint' },

  complaint: {
    pill: '1/3',
    actor: 'plaintiff',
    denyTitle: 'Step One Denied',
    reviewTitle: 'Step 1 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 1/3',
    next: 'summons',
  },

  summons: {
    pill: '2/3',
    actor: 'plaintiff',
    denyTitle: 'Step Two Denied',
    reviewTitle: 'Step 2 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 2/3',
    next: 'service',
  },

  service: {
    pill: '2/3',
    actor: 'plaintiff',
    denyTitle: 'Proof of Service Denied',
    reviewTitle: 'Proof of Service - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 2/3',
    next: 'answer',
  },

  answer: {
    pill: '3/3',
    actor: 'defendant',
    denyTitle: 'Answer Denied',
    reviewTitle: 'Step 3 - Waiting on clerk',
    modalTitle: 'Civil Lawsuit 3/3',
    next: 'filed',
  },

  filed: {},
};

const ORDER = ['intake', 'complaint', 'summons', 'service', 'answer', 'filed'];

module.exports = { STAGES, ORDER };
