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
  PANEL_CRIMINAL: 'p:crim',

  // Intake review (clerk)
  CASE_OPEN: 'c:open',
  CASE_DENY: 'c:deny',

  // Stage prompt
  STEP_NEXT: 's:next',

  // Clerk review of a submission
  REVIEW_OK: 'r:ok',
  REVIEW_NO: 'r:no',

  // Government-suit wizard (ephemeral, before a case exists)
  GOV_NEXT: 'g:next',
  GOV_CANCEL: 'g:cancel',

  // Lawyer reviews
  REVIEW_PICK_AM: 'v:am',
  REVIEW_PICK_NZ: 'v:nz',
  REVIEW_PAGE: 'v:page',
  REVIEW_LEAVE: 'v:leave',
  REVIEW_BACK: 'v:back',

  // Lawyer requests
  LAWYER_ACCEPT: 'q:accept',

  // /close confirmation chain
  CLOSE_YES: 'x:yes',
  CLOSE_NO: 'x:no',

  // Modals
  MODAL_INTAKE: 'm:intake',
  MODAL_DEPT: 'm:dept',
  MODAL_CASE_DENY: 'm:casedeny',
  MODAL_STEP: 'm:step',
  MODAL_REVIEW_DENY: 'm:rdeny',
  MODAL_SERVICE_OK: 'm:svcok',
  MODAL_ADD_JUDGE: 'm:addjudge',
  MODAL_GOV_FILES: 'm:gfiles',
  MODAL_GOV_DETAILS: 'm:gdetails',
  MODAL_CRIMINAL: 'm:crim',
  MODAL_REVIEW: 'm:review',
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
  GOV_FORMS: 'gov_forms',
  GOV_DEPARTMENT: 'gov_department',
  GOV_EMPLOYEES: 'gov_employees',
  GOV_DESCRIPTION: 'gov_description',
  GOV_COMPENSATION: 'gov_compensation',
  GOV_ATTORNEY: 'gov_attorney',
  CHARGE: 'charge',
  AGENCY: 'agency',
  CITATION: 'citation',
  RATING: 'rating',
  REVIEW_BODY: 'review_body',
};

module.exports = { IDS, FIELDS, withArg, parse };
