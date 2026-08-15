'use strict';

/**
 * Central registry of every custom_id used by the bot.
 *
 * Format: `namespace:action` optionally followed by `:argument`.
 * Discord caps custom_id at 100 characters, so arguments are always
 * small integers (database row ids) — the case itself is always looked
 * up from the channel the interaction happened in.
 */

const IDS = {
  // Public lawsuit panel
  PANEL_FILE: 'p:file',
  PANEL_DEPT: 'p:dept',
  PANEL_ACTIVE: 'p:active',

  // Intake review (clerk)
  CASE_OPEN: 'c:open',
  CASE_DENY: 'c:deny',

  // Stage prompt
  STEP_NEXT: 's:next',

  // Clerk review of a submission
  REVIEW_OK: 'r:ok',
  REVIEW_NO: 'r:no',

  // Modals
  MODAL_INTAKE: 'm:intake',
  MODAL_DEPT: 'm:dept',
  MODAL_CASE_DENY: 'm:casedeny',
  MODAL_STEP: 'm:step',
  MODAL_REVIEW_DENY: 'm:rdeny',
  MODAL_SERVICE_OK: 'm:svcok',
  MODAL_ADD_JUDGE: 'm:addjudge',
};

/** `r:ok` + 42 -> `r:ok:42` */
const withArg = (base, arg) => `${base}:${arg}`;

/** `r:ok:42` -> { base: 'r:ok', arg: '42' } */
function parse(customId) {
  const parts = String(customId).split(':');
  if (parts.length <= 2) return { base: customId, arg: null };
  return { base: parts.slice(0, 2).join(':'), arg: parts.slice(2).join(':') };
}

// Field custom_ids inside modals
const FIELDS = {
  DEFENDANT: 'defendant',
  DEPARTMENT: 'department',
  REASON: 'reason',
  LINKS: 'links',
  EVIDENCE: 'evidence',
  UPLOAD: 'upload',
  DENY_REASON: 'deny_reason',
  DEFENDANT_USER: 'defendant_user',
  DEFENDANT_ID: 'defendant_id',
  DEFENDANT_SELECT: 'defendant_select',
  JUDGE_SELECT: 'judge_select',
};

module.exports = { IDS, FIELDS, withArg, parse };
