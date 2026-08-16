'use strict';

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

const userSelect = (custom_id, { placeholder, required = true, defaultUserId, max_values } = {}) => ({
  type: T.USER_SELECT,
  custom_id,
  ...(placeholder ? { placeholder } : {}),
  ...(max_values ? { max_values } : {}),
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

/* ── 2b. Intake: contesting a criminal charge ────────────────── */

const criminalModal = () => ({
  custom_id: IDS.MODAL_CRIMINAL,
  title: 'Contest a Criminal Charge',
  components: [
    label(
      'What are you charged with?',
      textInput(FIELDS.CHARGE, { placeholder: 'Grand theft auto, resisting without violence', max_length: 300 }),
      'List every charge you are contesting.',
    ),
    label(
      'Arresting agency and officer',
      textInput(FIELDS.AGENCY, { placeholder: 'FHP - Trooper J. Salas #317', required: false, max_length: 200 }),
      'Who arrested or cited you, if you know.',
    ),
    label(
      'Citation, case or booking number',
      textInput(FIELDS.CITATION, { placeholder: 'CW-4417Q', required: false, max_length: 100 }),
      'Anything printed on the citation or booking sheet.',
    ),
    label(
      'Why are you contesting this charge?',
      textInput(FIELDS.REASON, {
        style: 2,
        placeholder: 'I was never read my rights and the vehicle was not reported stolen until after the stop.',
        max_length: 1500,
      }),
      'Please provide in maximum detail why the charge is wrong.',
    ),
    label(
      'Please provide any evidence.',
      fileUpload(FIELDS.EVIDENCE, { required: false, max_values: 10 }),
      'Bodycam, dashcam, photos, the citation itself.',
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

  // Stages that identify the other side collect their handle and id here, so a
  // clerk has something to confirm against when they pick the user.
  if (meta.picksCounterparty) {
    return {
      custom_id: withArg(IDS.MODAL_STEP, stage),
      title: meta.modalTitle,
      components: [
        label(
          stage === 'notify'
            ? 'Proof you served the State.'
            : 'Video and/or photo of defendant being served.',
          fileUpload(FIELDS.UPLOAD, { max_values: 10 }),
        ),
        label(
          stage === 'notify' ? 'Discord user of the prosecutor' : 'Discord user of the defendant',
          textInput(FIELDS.DEFENDANT_USER, { placeholder: 'Justauser_', max_length: 100 }),
        ),
        label(
          stage === 'notify' ? 'Prosecutor Discord ID' : 'Defendant Discord ID',
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

const serviceApproveModal = (submissionId, suggestedDefendantId, stage = 'service') => ({
  custom_id: withArg(IDS.MODAL_SERVICE_OK, submissionId),
  title: stage === 'notify' ? 'Criminal Contest 2/3' : 'Civil Lawsuit 2/3',
  components: [
    label(
      stage === 'notify'
        ? "Please select the prosecutor's user."
        : "Please select the defendant's user.",
      userSelect(FIELDS.DEFENDANT_SELECT, {
        placeholder: stage === 'notify' ? 'Select the prosecutor' : 'Select the defendant',
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

/* ── 7. Government claim: the two wizard modals ──────────────── */

const govFilesModal = (draftId) => ({
  custom_id: withArg(IDS.MODAL_GOV_FILES, draftId),
  title: 'Sue a Department',
  components: [
    label(
      'Please put all forms here.',
      fileUpload(FIELDS.GOV_FORMS, { max_values: 3 }),
      'Here is where you would put any of the last 3 forms.',
    ),
  ],
});

const govDetailsModal = (draftId) => ({
  custom_id: withArg(IDS.MODAL_GOV_DETAILS, draftId),
  title: 'Sue a Department',
  components: [
    label(
      'What department are you suing?',
      textInput(FIELDS.GOV_DEPARTMENT, { max_length: 120 }),
    ),
    label(
      'Please list any employees involved.',
      userSelect(FIELDS.GOV_EMPLOYEES, { required: false, max_values: 10 }),
    ),
    label(
      'Please describe in detail what happened.',
      textInput(FIELDS.GOV_DESCRIPTION, {
        style: 2,
        placeholder: 'I was driving when the police car slammed into my car breaking my arm...',
        max_length: 1500,
      }),
    ),
    label(
      'What compensation do you want to receive?',
      textInput(FIELDS.GOV_COMPENSATION, {
        style: 2,
        placeholder: 'I want $7,000 to pay for my medical bills.',
        max_length: 700,
      }),
    ),
    label(
      'Do you have an attorney?',
      userSelect(FIELDS.GOV_ATTORNEY, { required: false }),
      'If so please select them here.',
    ),
  ],
});

/* ── 7b. Leaving a lawyer review ─────────────────────────────── */

const reviewModal = (lawyerId) => ({
  custom_id: withArg(IDS.MODAL_REVIEW, lawyerId),
  title: 'Leave a Review',
  components: [
    label(
      'Your rating',
      {
        type: T.RADIO_GROUP,
        custom_id: FIELDS.RATING,
        required: true,
        options: [
          { label: '5 - Excellent', value: '5' },
          { label: '4 - Good', value: '4' },
          { label: '3 - Okay', value: '3' },
          { label: '2 - Poor', value: '2' },
          { label: '1 - Terrible', value: '1' },
        ],
      },
      'One to five stars.',
    ),
    label(
      'How did they do?',
      textInput(FIELDS.REVIEW_BODY, {
        style: 2,
        placeholder: 'What a great lawyer he got all of my charges droped',
        max_length: 700,
      }),
      'This will be shown publicly on their review page.',
    ),
  ],
});

/* ── 8. /addjudge ────────────────────────────────────────────── */

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
  criminalModal,
  reviewModal,
  govFilesModal,
  govDetailsModal,
  intakeModal,
  caseDenyModal,
  stepModal,
  reviewDenyModal,
  serviceApproveModal,
  addJudgeModal,
};
