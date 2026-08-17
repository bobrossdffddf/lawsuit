'use strict';

/**
 * Offline validator. Builds every message and modal the bot can send with
 * dummy data and checks them against Discord's structural rules, so layout
 * mistakes surface here instead of as a 400 in production.
 *
 *   npm run check
 */

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= '100000000000000001';
process.env.GUILD_ID ||= '100000000000000002';
process.env.CLERK_ROLE_ID ||= '1532849857524531320';
process.env.JUDGE_ROLE_ID ||= '1536152046774788147';
process.env.CIVIL_CASE_CATEGORY_ID ||= '1536111208900595742';
process.env.SUPPORT_CHANNEL_ID ||= '1533695207386910751';

const fs = require('node:fs');
const config = require('../src/config');
const M = require('../src/ui/messages');
const modals = require('../src/ui/modals');
const W = require('../src/ui/govWizard');
const L = require('../src/ui/lawyers');
const { PIPELINES, STAGES } = require('../src/stages');
const fmt = require('../src/lib/format');

let failures = 0;
let checks = 0;

function fail(where, msg) {
  failures += 1;
  console.error(`  ✗ ${where}: ${msg}`);
}
function ok(where) {
  checks += 1;
  console.log(`  ✓ ${where}`);
}

/* ── structural rules ────────────────────────────────────────── */

const MESSAGE_TOP_LEVEL = new Set([1, 9, 10, 12, 13, 14, 17]);
const CONTAINER_CHILDREN = new Set([1, 9, 10, 12, 13, 14]);

function walk(node, where, ctx) {
  ctx.count += 1;

  if (node.custom_id && String(node.custom_id).length > 100) {
    fail(where, `custom_id longer than 100 chars: ${node.custom_id}`);
  }
  if (node.type === 10) {
    if (typeof node.content !== 'string' || !node.content.length) {
      fail(where, 'text display with empty content');
    } else if (node.content.length > 4000) {
      fail(where, `text display ${node.content.length} chars (max 4000)`);
    }
  }
  if (node.type === 12) {
    if (!Array.isArray(node.items) || node.items.length === 0) fail(where, 'empty media gallery');
    else if (node.items.length > 10) fail(where, `gallery has ${node.items.length} items (max 10)`);
    for (const [i, item] of (node.items ?? []).entries()) {
      if (!item?.media?.url) fail(where, `gallery item ${i} has no media.url`);
    }
  }
  if (node.type === 1) {
    if (!Array.isArray(node.components) || node.components.length === 0) {
      fail(where, 'empty action row');
    } else if (node.components.length > 5) {
      fail(where, `action row has ${node.components.length} buttons (max 5)`);
    }
    for (const child of node.components ?? []) {
      if (child.type !== 2 && child.type !== 3 && !(child.type >= 5 && child.type <= 8)) {
        fail(where, `action row contains illegal child type ${child.type}`);
      }
      if (child.type === 2 && child.style !== 5 && !child.custom_id) {
        fail(where, 'non-link button without custom_id');
      }
      if (child.type === 2 && (!child.label || child.label.length > 80)) {
        fail(where, `button label invalid: ${child.label}`);
      }
      walk(child, where, ctx);
    }
    return;
  }
  if (node.type === 17) {
    for (const child of node.components ?? []) {
      if (!CONTAINER_CHILDREN.has(child.type)) {
        fail(where, `container holds illegal child type ${child.type}`);
      }
      walk(child, where, ctx);
    }
    return;
  }
  if (node.type === 13 && !node.file?.url?.startsWith('attachment://')) {
    fail(where, 'file component must reference attachment://');
  }
  if (node.type === 9) {
    const kids = node.components ?? [];
    if (!kids.length || kids.length > 3) fail(where, `section needs 1-3 text displays, has ${kids.length}`);
    if (kids.some((k) => k.type !== 10)) fail(where, 'section children must all be text displays');
    const acc = node.accessory;
    if (!acc || (acc.type !== 2 && acc.type !== 11)) {
      fail(where, 'section accessory must be a button or thumbnail');
    }
    for (const k of kids) walk(k, where, ctx);
    if (acc) walk(acc, where, ctx);
    return;
  }
  for (const child of node.components ?? []) walk(child, where, ctx);
}

/**
 * @param {string} where
 * @param {object} payload
 * @param {string[]} [inherited] attachment names already on the message this
 *   payload EDITS. Discord keeps existing attachments when a PATCH omits the
 *   `attachments` field, so an edit may reference them without re-uploading.
 */
function checkMessage(where, payload, inherited = []) {
  if (!(payload.flags & 32768)) fail(where, 'missing IS_COMPONENTS_V2 flag (1 << 15)');
  if (payload.content) fail(where, 'content is ignored when IS_COMPONENTS_V2 is set');
  if (payload.embeds?.length) fail(where, 'embeds are ignored when IS_COMPONENTS_V2 is set');

  const ctx = { count: 0 };
  for (const node of payload.components ?? []) {
    if (!MESSAGE_TOP_LEVEL.has(node.type)) {
      fail(where, `illegal top-level component type ${node.type}`);
    }
    walk(node, where, ctx);
  }
  if (ctx.count > 40) fail(where, `${ctx.count} components (max 40)`);

  // Every attachment:// reference must be backed by a real file.
  const refs = [];
  JSON.stringify(payload.components, (k, v) => {
    if (typeof v === 'string' && v.startsWith('attachment://')) refs.push(v.slice(13));
    return v;
  });
  const provided = new Set([...(payload.files ?? []).map((f) => f.name), ...inherited]);
  for (const ref of refs) {
    if (!provided.has(ref)) fail(where, `attachment://${ref} has no matching file in payload.files`);
  }

  if (!failures) ok(where);
  return payload;
}

function checkModal(where, modal) {
  if (!modal.custom_id || modal.custom_id.length > 100) fail(where, 'bad modal custom_id');
  if (!modal.title || modal.title.length > 45) fail(where, `modal title invalid: ${modal.title}`);
  if (!Array.isArray(modal.components) || !modal.components.length) fail(where, 'modal has no components');
  if (modal.components.length > 5) fail(where, `modal has ${modal.components.length} rows (max 5)`);

  const seen = new Set();
  for (const node of modal.components) {
    if (node.type !== 18 && node.type !== 10) {
      fail(where, `modal top-level must be Label(18) or Text(10), got ${node.type}`);
      continue;
    }
    if (node.type === 10) continue;

    const inner = node.component;
    if (!inner) {
      fail(where, 'label without a component');
      continue;
    }
    if (![3, 4, 5, 6, 7, 8, 19, 21, 22, 23].includes(inner.type)) {
      fail(where, `label wraps illegal component type ${inner.type}`);
    }
    if (inner.disabled) fail(where, 'disabled is not allowed inside a modal');
    if (seen.has(inner.custom_id)) fail(where, `duplicate custom_id ${inner.custom_id}`);
    seen.add(inner.custom_id);
    if (inner.type === 3 && (!inner.options?.length || inner.options.length > 25)) {
      fail(where, 'string select needs 1-25 options');
    }
    if (inner.type === 19 && (inner.max_values < 1 || inner.max_values > 10)) {
      fail(where, 'file upload max_values must be 1-10');
    }
    if (inner.type === 21 && (!inner.options?.length || inner.options.length > 10)) {
      fail(where, 'radio group needs 1-10 options');
    }
  }
  ok(where);
  return modal;
}

/* ── fixtures ────────────────────────────────────────────────── */

const fakeCase = {
  id: 1,
  case_number: '26-CC-000001',
  kind: 'person',
  plaintiff_id: '111111111111111111',
  defendant_id: '222222222222222222',
  defendant_raw: 'justauser, robloxuser',
  department: null,
  reason: 'I slipped on oil left on the floor of the defendant’s store and can no longer work.',
  links: 'https://youtube.com/watch?v=abc, https://imgur.com/xyz',
  status: 'open',
  stage: 'complaint',
  judge_id: '333333333333333333',
  discovery_thread_id: '444444444444444444',
  exhibit_seq: 3,
  created_at: Date.now(),
  channel_id: '555555555555555555',
};

// Mirrors what buildMedia() really returns: attachment:// references that MUST
// be backed by entries in the payload's `files` array.
const fakeMedia = {
  attachments: [{ name: 'evidence-p1.png' }, { name: 'evidence.pdf' }],
  galleryItems: [{ media: { url: 'attachment://evidence-p1.png' }, description: 'page 1' }],
  fileComponents: [{ type: 13, file: { url: 'attachment://evidence.pdf' } }],
  overflow: [],
};

console.log('\nCourt forms on disk');
const missingForms = [];
for (const [key, form] of Object.entries(config.forms)) {
  if (fs.existsSync(form.file)) ok(`${key} → ${form.name}`);
  else {
    missingForms.push(form.name);
    console.warn(`  ! ${key} → ${form.name} NOT PRESENT (messages will show a note instead)`);
  }
}

// The forms are designed at 8-10pt. If anything ever rewrites a widget's /DA
// with a bigger size — which is what pdf-lib's appearance baking did — the
// field renders comically large. Catch that here rather than in Discord.
async function auditForms() {
  const { PDFDocument, PDFName } = require('pdf-lib');
  const MAX_POINT_SIZE = 12;
  let big = 0;
  let filled = 0;
  let capped = 0;
  let baked = 0;

  for (const [key, form] of Object.entries(config.forms)) {
    if (!fs.existsSync(form.file)) continue;
    const doc = await PDFDocument.load(fs.readFileSync(form.file));
    for (const field of doc.getForm().getFields()) {
      if (typeof field.getText === 'function' && (field.getText() ?? '').trim()) filled += 1;
      for (const widget of field.acroField.getWidgets()) {
        if (widget.dict.has(PDFName.of('MaxLen'))) capped += 1;
        if (widget.dict.has(PDFName.of('AP'))) baked += 1;
        const da = widget.dict.get(PDFName.of('DA'));
        if (!da) continue;
        const text = String(da.decodeText ? da.decodeText() : da);
        const match = text.match(/([\d.]+)\s+Tf/);
        if (match && Number(match[1]) > MAX_POINT_SIZE) {
          big += 1;
          if (big <= 3) console.error(`  ! ${key} field "${field.getName()}" is ${match[1]}pt`);
        }
      }
    }
  }

  if (big) fail('forms', `${big} field(s) render above ${MAX_POINT_SIZE}pt`);
  else ok(`no field renders above ${MAX_POINT_SIZE}pt`);

  if (capped) fail('forms', `${capped} field(s) still have a MaxLen cap`);
  else ok('no field has a character cap');

  if (filled) fail('forms', `${filled} field(s) still carry sample data`);
  else ok('every form is a true blank');

  if (baked) fail('forms', `${baked} widget(s) have a baked appearance stream`);
  else ok('appearances are left to the viewer (NeedAppearances)');
}

console.log('\nMessages');
checkMessage('lawsuitPanel', M.lawsuitPanel());
checkMessage('intakeMessage', M.intakeMessage(fakeCase, fakeMedia));
checkMessage('intakeDenialDM', M.intakeDenialDM(fakeCase, 'Not enough detail.', '999'));
checkMessage('intakeDeniedNotice', M.intakeDeniedNotice(fakeCase, 'Not enough detail.', '999'));
checkMessage(
  'intakeDeniedNotice:dmFailed',
  M.intakeDeniedNotice(fakeCase, 'Not enough detail.', '999', { dmFailed: true }),
);

const govCase = {
  ...fakeCase,
  kind: 'department',
  department: 'Florida Highway Patrol',
  compensation: 'I want $7,000 to pay for my medical bills.',
  employees: JSON.stringify(['777777777777777777']),
  attorney_id: '888888888888888888',
  stage: 'notice',
};

checkMessage('departmentIntakeMessage', M.departmentIntakeMessage(govCase, fakeMedia));

const crimCase = {
  ...fakeCase,
  kind: 'criminal',
  case_number: '26-CR-000004',
  stage: 'appearance',
  employees: JSON.stringify({ charge: 'Grand theft auto', agency: 'FHP', citation: 'CW-4417Q' }),
};
checkMessage('criminalIntakeMessage', M.criminalIntakeMessage(crimCase, fakeMedia));
checkMessage('lawsuitFiled:criminal', M.lawsuitFiled(crimCase));

console.log('\nLawyers');
const roll = [
  { id: '111111111111111111', label: 'Alice Barrow', description: '4.5/5 from 2 · 6 cases' },
  { id: '222222222222222222', label: 'Max Goodman', description: 'No reviews yet · 1 case' },
  { id: '333333333333333333', label: 'Nora Vance', description: '5.0/5 from 9 · 12 cases' },
];
checkMessage('reviewPanel', L.reviewPanel(roll));
checkMessage('reviewPanel:empty', L.reviewPanel([]));
// 30 attorneys must page into two selects per half, not overflow one.
checkMessage(
  'reviewPanel:bigRoll',
  L.reviewPanel(
    Array.from({ length: 30 }, (_, i) => ({ id: `${i}`.padStart(18, '9'), label: `Attorney ${i}` })),
  ),
);

const reviews = Array.from({ length: 12 }, (_, i) => ({
  rating: (i % 5) + 1,
  body: `Review number ${i + 1}. They did fine.`,
  client_id: '444444444444444444',
  client_name: 'justawacko',
  created_at: Date.now() - i * 86400000,
}));
const lawyerFixture = { id: '222222222222222222', name: 'Max Goodman', barredSince: Date.now(), casesHandled: 7 };
checkMessage('lawyerProfile:p1', L.lawyerProfile(lawyerFixture, reviews, 0, true));
checkMessage('lawyerProfile:p3', L.lawyerProfile(lawyerFixture, reviews, 2, false));
checkMessage('lawyerProfile:none', L.lawyerProfile(lawyerFixture, [], 0, false));
checkMessage('lawyerRequestNotice', L.lawyerRequestNotice('111111111111111111'));
checkMessage('lawyerRequestNotice:taken', L.lawyerRequestNotice('111111111111111111', '222222222222222222'));
checkMessage('lawyerRequestBroadcast', L.lawyerRequestBroadcast(fakeCase, 7, '111111111111111111', 'Assault case.'));
checkMessage(
  'lawyerRequestBroadcast:taken',
  L.lawyerRequestBroadcast(fakeCase, 7, '111111111111111111', 'Assault case.', '222222222222222222'),
);
checkMessage('presenceRequestDM', L.presenceRequestDM('111111111111111111', '999999999999999999'));

// Reviews must page five at a time.
const pageOne = JSON.stringify(L.lawyerProfile(lawyerFixture, reviews, 0, true));
if ((pageOne.match(/Review number/g) || []).length === 5) ok('review page holds exactly 5');
else fail('lawyerProfile', 'a page should hold 5 reviews');
if (pageOne.includes('Page 1/3')) ok('12 reviews paginate to 3 pages');
else fail('lawyerProfile', 'expected Page 1/3');

console.log('\nMessages (continued)');
checkMessage('lawsuitFiled:department', M.lawsuitFiled(govCase));
checkMessage('caseClosed', M.caseClosed(fakeCase, '999'));
for (const step of [1, 2, 3]) checkMessage(`closeConfirm:${step}`, M.closeConfirm(fakeCase, step));

console.log('\nGovernment-claim wizard');
for (let step = 1; step <= W.PANEL_COUNT; step += 1) {
  // The first render uploads the court PDFs...
  const first = W.govPanel(step, 42, W.READ_SECONDS, true);
  checkMessage(`govPanel:${step}:first`, first);

  // ...and the countdown ticks edit that same message, so they may reference
  // those attachments without sending them again.
  const uploaded = (first.files ?? []).map((f) => f.name);
  checkMessage(`govPanel:${step}:tick`, W.govPanel(step, 42, 3), uploaded);
  checkMessage(`govPanel:${step}:ready`, W.govPanel(step, 42, 0), uploaded);

  // A tick must never reference something the first render did not upload.
  const refs = [];
  JSON.stringify(W.govPanel(step, 42, 0), (k, v) => {
    if (typeof v === 'string' && v.startsWith('attachment://')) refs.push(v.slice(13));
    return v;
  });
  const orphan = refs.find((r) => !uploaded.includes(r));
  if (orphan) fail(`govPanel:${step}`, `tick references ${orphan}, never uploaded by the first render`);
  else ok(`govPanel:${step} ticks only reuse attachments from the first render`);
}
checkMessage('govCancelled', W.govCancelled());
checkMessage('govFiling', W.govFiling());
checkMessage('govFiled', W.govFiled('26-CC-000009', '555555555555555555'));

// Only the first render ships the court PDFs; the ticks must not re-upload them.
if (W.govPanel(2, 1, 5, true).files !== undefined && W.govPanel(2, 1, 4).files === undefined) {
  ok('countdown ticks do not re-upload the court forms');
} else {
  fail('countdown', 'ticks should omit `files` so attachments are reused');
}

// The countdown must actually flip the button from disabled to enabled.
const locked = JSON.stringify(W.govPanel(1, 1, 5));
const ready = JSON.stringify(W.govPanel(1, 1, 0));
if (locked.includes('"label":"Continue (5)"') && locked.includes('"disabled":true')) ok('countdown starts locked at (5)');
else fail('countdown', 'panel should start as a disabled "Continue (5)"');
if (ready.includes('"label":"Continue"') && !ready.includes('"disabled":true')) ok('countdown ends enabled');
else fail('countdown', 'panel should end as an enabled "Continue"');

console.log('\nStages');
const ALL_STAGES = [...new Set([...PIPELINES.person, ...PIPELINES.department])];
for (const stage of ALL_STAGES) {
  if (stage === 'intake' || stage === 'filed') continue;
  checkMessage(`stagePrompt:${stage}`, M.stagePrompt(stage, fakeCase));
  checkMessage(`stageDenied:${stage}`, M.stagePrompt(stage, fakeCase, { denialReason: 'Section 4 blank.' }));
  checkMessage(`review:${stage}`, M.reviewMessage(stage, fakeCase, 42, fakeMedia, '111', []));
}

checkMessage('lawsuitFiled', M.lawsuitFiled(fakeCase));
checkMessage('discoveryHeader', M.discoveryHeader(fakeCase));
checkMessage('exhibitFiled', M.exhibitFiled('A', 'bodycam.mp4'));
checkMessage('judgeAppointed', M.judgeAppointed(fakeCase, '333333333333333333'));
checkMessage('activeCasesList', M.activeCasesList([fakeCase, { ...fakeCase, case_number: '26-CC-000002' }]));
checkMessage('activeCasesList:empty', M.activeCasesList([]));

console.log('\nModals');
checkModal('intakeModal', modals.intakeModal());
checkModal('criminalModal', modals.criminalModal());
checkModal('reviewModal', modals.reviewModal('222222222222222222'));
checkModal('govFilesModal', modals.govFilesModal(42));
checkModal('govDetailsModal', modals.govDetailsModal(42));
checkModal('caseDenyModal', modals.caseDenyModal());
for (const stage of ['complaint', 'summons', 'service', 'answer']) {
  checkModal(`stepModal:${stage}`, modals.stepModal(stage));
}
checkModal('reviewDenyModal', modals.reviewDenyModal(42));
checkModal('serviceApproveModal', modals.serviceApproveModal(42));
checkModal('addJudgeModal', modals.addJudgeModal());

console.log('\nallowed_mentions (no duplicate ids)');

function checkMentions(where, payload) {
  const am = payload.allowedMentions;
  if (!am) {
    ok(`${where} (none set)`);
    return;
  }
  for (const key of ['users', 'roles']) {
    const list = am[key] ?? [];
    if (new Set(list).size !== list.length) {
      fail(where, `duplicate ${key} in allowed_mentions: ${list.join(', ')}`);
      return;
    }
  }
  ok(where);
}

// The judge is also the plaintiff, and the denier is also the defendant —
// exactly the collisions that produced SET_TYPE_ALREADY_CONTAINS_VALUE.
const selfCase = { ...fakeCase, judge_id: fakeCase.plaintiff_id };
checkMentions('judgeAppointed:judge is plaintiff', M.judgeAppointed(selfCase, fakeCase.plaintiff_id));
checkMentions('judgeAppointed:judge is defendant', M.judgeAppointed(fakeCase, fakeCase.defendant_id));
checkMentions(
  'stagePrompt:denier is a party',
  M.stagePrompt('answer', fakeCase, { denialReason: 'x', deniedBy: fakeCase.defendant_id }),
);
checkMentions('intakeMessage', M.intakeMessage(fakeCase, fakeMedia));
checkMentions('departmentIntakeMessage', M.departmentIntakeMessage(govCase, fakeMedia));
checkMentions('welcomeMessage', M.welcomeMessage({ id: '111', guild: { memberCount: 45 } }));
checkMentions('criminalIntakeMessage', M.criminalIntakeMessage(crimCase, fakeMedia));
checkMentions('presenceRequestDM', L.presenceRequestDM('111', '111'));
checkMentions('lawyerRequestBroadcast', L.lawyerRequestBroadcast(fakeCase, 1, '111', 'x', '111'));
checkMentions('reviewMessage', M.reviewMessage('complaint', fakeCase, 1, fakeMedia, '111', []));
checkMentions(
  'intakeDeniedNotice:clerk is plaintiff',
  M.intakeDeniedNotice(fakeCase, 'x', fakeCase.plaintiff_id, { dmFailed: true }),
);

console.log('\nForm carry-over wiring');
// Regression: the pre-fill only happens when a payload declares formKeys.
// Without this every party gets a blank PDF and the profile is dead weight.
for (const stage of ['complaint', 'summons', 'answer', 'appearance', 'motions', 'prosecution']) {
  const payload = M.stagePrompt(stage, fakeCase);
  const expected = M.STAGE_FORMS[stage].filter((k) => config.forms[k]);
  if (!expected.length) continue;
  if (Array.isArray(payload.formKeys) && payload.formKeys.length === expected.length) {
    ok(`stagePrompt:${stage} declares formKeys (${payload.formKeys.join(', ')})`);
  } else {
    fail(`stagePrompt:${stage}`, 'no formKeys — the handed-out form would never be pre-filled');
  }
}

console.log('\nCounterparty stages');
// Regression: `picksCounterparty` must actually drive the modals, or the
// criminal pipeline dead-ends with no prosecutor attached.
for (const [stage, meta] of Object.entries(STAGES)) {
  if (!meta.collectsCounterparty) continue;
  const modal = modals.stepModal(stage);
  const ids = modal.components.map((n) => n.component?.custom_id).filter(Boolean);
  if (ids.includes('defendant_user') && ids.includes('defendant_id')) {
    ok(`stepModal:${stage} collects the counterparty`);
  } else {
    fail(`stepModal:${stage}`, `collects ${ids.join(', ')} — cannot identify the other side`);
  }
  checkModal(`serviceApproveModal:${stage}`, modals.serviceApproveModal(1, null, 'person'));
  checkModal(`serviceApproveModal:${stage}:criminal`, modals.serviceApproveModal(1, null, 'criminal'));
}

console.log('\nWelcome message');
checkMessage('welcomeMessage', M.welcomeMessage({ id: '111111111111111111', guild: { memberCount: 45 } }));

console.log('\nNo accent bar on containers');
const accented = JSON.stringify([
  M.lawsuitPanel(),
  M.intakeMessage(fakeCase, fakeMedia),
  M.stagePrompt('complaint', fakeCase),
]).includes('accent_color');
if (accented) fail('containers', 'accent_color is set — sidebar should be Discord default');
else ok('containers use the default sidebar colour');

console.log('\nHelpers');
const buckets = L.splitRoll([
  { id: '1', label: '_zeus' },
  { id: '2', label: 'Ømar' },
  { id: '3', label: '1337Lawyer' },
  { id: '4', label: '#Ace' },
  { id: '5', label: 'nora' },
]);
const same = (got, want) => [...got].sort().join('|') === [...want].sort().join('|');
const inAM = buckets.am.map((l) => l.label);
const inNZ = buckets.nz.map((l) => l.label);
if (same(inAM, ['#Ace', '1337Lawyer']) && same(inNZ, ['_zeus', 'nora', 'Ømar'])) {
  ok(`A-M / N-Z split ignores punctuation and accents (${inAM.join(', ')} | ${inNZ.join(', ')})`);
} else {
  fail('splitRoll', `A-M=[${inAM}] N-Z=[${inNZ}]`);
}

const letters = [1, 2, 26, 27, 28, 52, 53].map(fmt.exhibitLetter).join(' ');
if (letters === 'A B Z AA AB AZ BA') ok(`exhibitLetter → ${letters}`);
else fail('exhibitLetter', `unexpected sequence: ${letters}`);

const linked = fmt.hyperlink('https://youtube.com/watch?v=abc, https://imgur.com/xyz');
if (linked.includes('[youtube.com](') && linked.includes('[imgur.com](')) ok('hyperlink');
else fail('hyperlink', linked);

if (fmt.hyperlink('') === '*None provided*') ok('hyperlink:empty');
else fail('hyperlink:empty', 'should render a placeholder');

(async () => {
  console.log('\nForm rendering');
  await auditForms();

  if (missingForms.length) {
    console.warn(
      `\nACTION REQUIRED: drop these into assets/forms/ before using the flows that need them:\n` +
        missingForms.map((f) => `  - ${f}`).join('\n'),
    );
  }

  console.log(
    failures === 0
      ? `\nall ${checks} checks passed\n`
      : `\n${failures} problem(s) found\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
