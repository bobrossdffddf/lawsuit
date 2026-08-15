'use strict';

const config = require('../config');
const { IDS, FIELDS, withArg } = require('../lib/ids');
const { STAGES } = require('../stages');
const { T } = require('./common');

/** Label (type 18) wrapping a single input. */
const label = (labelText, component, description) => ({
  type: T.LABEL,
  label: labelText,
  ...(description ? { description } : {}),
  component,
});

const textInput = (custom_id, { style = 1, placeholder, required = true, max_length } = {}) => ({
  type: T.TEXT_INPUT,
  style,
  custom_id,
  ...(placeholder ? { placeholder } : {}),
  required,
  ...(max_length ? { max_length } : {}),
});

const fileUpload = (custom_id, { required = true, max_values = 1, min_values } = {}) => ({
  type: T.FILE_UPLOAD,
  custom_id,
  required,
  max_values,
  ...(min_values !== undefined ? { min_values } : {}),
});

const userSelect = (custom_id, { placeholder, required = true, defaultUserId } = {}) => ({
  type: T.USER_SELECT,
  custom_id,
  ...(placeholder ? { placeholder } : {}),
  required,
  // Pre-selects whoever the plaintiff named, so the clerk only has to confirm
  // it. The clerk can still change it — nothing is trusted until they submit.
  ...(/^\d{15,25}$/.test(defaultUserId ?? '')
    ? { default_values: [{ id: defaultUserId, type: 'user' }] }
    : {}),
});

/* ── 1. Intake: suing a person ───────────────────────────────── */

const intakeModal = () => ({
  custom_id: IDS.MODAL_INTAKE,
  title: 'Civil Lawsuit',
  components: [
    label(
      'Who are you suing (Username)',
      textInput(FIELDS.DEFENDANT, { placeholder: 'justauser, robloxuser', max_length: 200 }),
      'Please provide the discord username and roblox username of the person you are suing.',
    ),
    label(
      'Why are you suing them?',
      textInput(FIELDS.REASON, {
        style: 2,
        placeholder:
          "I was at Bob's store when I slipped and fell on oil that he left on the floor. Now I cant work.",
        max_length: 1500,
      }),
      'Please provide in maximum detail why you are suing this person.',
    ),
    label(
      'Please provide any evidence.',
      textInput(FIELDS.LINKS, {
        placeholder: 'www.videolink.com',
        required: false,
        max_length: 900,
      }),
      'Put any links here.',
    ),
    label(
      'Please provide any evidence.',
      fileUpload(FIELDS.EVIDENCE, { required: false, max_values: 10 }),
      'Put any files here that can better describe or give context to your situation.',
    ),
  ],
});

/* ── 2. Intake: suing a department ───────────────────────────── */

const departmentModal = () => ({
  custom_id: IDS.MODAL_DEPT,
  title: 'Sue a Department',
  components: [
    label(
      'Which department are you suing?',
      {
        type: T.STRING_SELECT,
        custom_id: FIELDS.DEPARTMENT,
        placeholder: 'Select a department',
        options: config.departments.map((d) => ({ label: d.slice(0, 100), value: d.slice(0, 100) })),
      },
      'Select the state or local agency that wronged you.',
    ),
    label(
      'Why are you suing them?',
      textInput(FIELDS.REASON, {
        style: 2,
        placeholder:
          'A trooper impounded my vehicle without cause and it has not been returned.',
        max_length: 1500,
      }),
      'Please provide in maximum detail why you are suing this department.',
    ),
    label(
      'Please provide any evidence.',
      textInput(FIELDS.LINKS, { placeholder: 'www.videolink.com', required: false, max_length: 900 }),
      'Put any links here.',
    ),
    label(
      'Please provide any evidence.',
      fileUpload(FIELDS.EVIDENCE, { required: false, max_values: 10 }),
      'Put any files here that can better describe or give context to your situation.',
    ),
  ],
});

/* ── 3. Clerk denies intake ──────────────────────────────────── */

const caseDenyModal = () => ({
  custom_id: IDS.MODAL_CASE_DENY,
  title: 'Deny Case',
  components: [
    label(
      'Why are you denying this case?',
      textInput(FIELDS.DENY_REASON, {
        style: 2,
        placeholder: 'The complaint does not state a claim the court can grant relief on.',
        max_length: 900,
      }),
      'This will be sent to the plaintiff in a DM.',
    ),
  ],
});

/* ── 4. Stage submission modals ──────────────────────────────── */

function stepModal(stage) {
  const meta = STAGES[stage];

  if (stage === 'service') {
    return {
      custom_id: withArg(IDS.MODAL_STEP, stage),
      title: meta.modalTitle,
      components: [
        label(
          'Video and/or photo of defendant being served.',
          fileUpload(FIELDS.UPLOAD, { max_values: 10 }),
        ),
        label(
          'Discord user of the defendant',
          textInput(FIELDS.DEFENDANT_USER, { placeholder: 'Justauser_', max_length: 100 }),
        ),
        label(
          'Defendant Discord ID',
          textInput(FIELDS.DEFENDANT_ID, { placeholder: '467238643627', max_length: 25 }),
        ),
      ],
    };
  }

  return {
    custom_id: withArg(IDS.MODAL_STEP, stage),
    title: meta.modalTitle,
    components: [
      label('Please upload the completed form', fileUpload(FIELDS.UPLOAD, { max_values: 5 })),
    ],
  };
}

/* ── 5. Clerk denies a stage submission ──────────────────────── */

const reviewDenyModal = (submissionId) => ({
  custom_id: withArg(IDS.MODAL_REVIEW_DENY, submissionId),
  title: 'Deny Submission',
  components: [
    label(
      'Why are you denying this?',
      textInput(FIELDS.DENY_REASON, {
        style: 2,
        placeholder: 'Section 4 of the complaint was left blank.',
        max_length: 900,
      }),
      'This will be posted in the case channel for the filer to read.',
    ),
  ],
});

/* ── 6. Clerk approves service and identifies the defendant ──── */

const serviceApproveModal = (submissionId, suggestedDefendantId) => ({
  custom_id: withArg(IDS.MODAL_SERVICE_OK, submissionId),
  title: 'Civil Lawsuit 2/3',
  components: [
    label(
      "Please select the defendant's user.",
      userSelect(FIELDS.DEFENDANT_SELECT, {
        placeholder: 'Select the defendant',
        defaultUserId: suggestedDefendantId,
      }),
    ),
    {
      type: T.TEXT,
      content:
        '### If the defendant has not joined the server after 3 business days of being served a ' +
        'default judgment may be entered against them for the full amount demanded. As the clerk ' +
        'you must notify them 3 times on 3 separate days. If they do not join the government server ' +
        "within 5 days please contact a moderator because the defendant is FRP'ing.",
    },
  ],
});

/* ── 7. /addjudge ────────────────────────────────────────────── */

const addJudgeModal = () => ({
  custom_id: IDS.MODAL_ADD_JUDGE,
  title: 'Appoint a Judge',
  components: [
    label(
      'Which judge is being appointed?',
      userSelect(FIELDS.JUDGE_SELECT, { placeholder: 'Select a judge' }),
    ),
  ],
});

module.exports = {
  intakeModal,
  departmentModal,
  caseDenyModal,
  stepModal,
  reviewDenyModal,
  serviceApproveModal,
  addJudgeModal,
};
