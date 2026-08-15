'use strict';

/**
 * End-to-end dry run of the case lifecycle against an in-memory fake Discord.
 * No network, no token — it exercises the real service layer and database so
 * state-machine bugs show up before the bot ever touches the gateway.
 *
 *   node scripts/simulate.js
 */

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= '100000000000000001';
process.env.GUILD_ID ||= '100000000000000002';
process.env.CLERK_ROLE_ID ||= '1532849857524531320';
process.env.JUDGE_ROLE_ID ||= '1536152046774788147';
process.env.CIVIL_CASE_CATEGORY_ID ||= '1536111208900595742';
process.env.SUPPORT_CHANNEL_ID ||= '1533695207386910751';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

// Use a throwaway database so a simulation never touches real case records.
const tmpDb = path.join(os.tmpdir(), `flgov-sim-${Date.now()}.db`);
const config = require('../src/config');
config.dbPath = tmpDb;

const store = require('../src/db');
const cases = require('../src/services/caseService');

let failures = 0;
const assert = (cond, label) => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
};

/* ── fake Discord ────────────────────────────────────────────── */

const PLAINTIFF = '111111111111111111';
const DEFENDANT = '222222222222222222';
const CLERK = '999999999999999999';
const JUDGE = '333333333333333333';

const sentMessages = [];
let messageSeq = 0;

function makeThread(name) {
  const added = new Set();
  return {
    id: `thread-${++messageSeq}`,
    name,
    members: { add: async (id) => added.add(id) },
    added,
    send: async (payload) => {
      sentMessages.push({ channel: 'discovery', payload });
      return { id: `msg-${++messageSeq}`, pin: async () => {} };
    },
  };
}

function makeChannel(name) {
  const overwrites = new Map();
  const threads = new Map();
  const messages = new Map();

  const channel = {
    id: `chan-${++messageSeq}`,
    name,
    members: new Map(),
    permissionOverwrites: {
      edit: async (id, perms) => {
        overwrites.set(id, { ...(overwrites.get(id) ?? {}), ...perms });
      },
    },
    overwrites,
    messages: {
      fetch: async (id) => {
        const m = messages.get(id);
        if (!m) throw new Error('unknown message');
        return m;
      },
    },
    threads: {
      create: async ({ name: n }) => {
        const t = makeThread(n);
        threads.set(t.id, t);
        return t;
      },
      fetch: async (id) => threads.get(id) ?? null,
    },
    send: async (payload) => {
      const id = `msg-${++messageSeq}`;
      const msg = {
        id,
        attachments: new Map(),
        edit: async (p) => {
          msg.lastEdit = p;
          return msg;
        },
        pin: async () => {},
      };
      messages.set(id, msg);
      sentMessages.push({ channel: name, payload });
      return msg;
    },
    delete: async () => {},
  };
  return channel;
}

const guild = {
  id: config.guildId,
  roles: { everyone: { id: config.guildId } },
  channels: {
    create: async ({ name }) => makeChannel(name),
  },
};

function makeInteraction(userId, channel) {
  return {
    user: { id: userId, tag: `user-${userId}` },
    client: { user: { id: 'bot' }, users: { fetch: async () => ({ send: async () => {} }) }, channels: { fetch: async () => channel } },
    guild,
    channel,
    channelId: channel?.id,
  };
}

/* ── a tiny file host, so uploads take the real download path ──── */

function startFileHost() {
  const files = {
    '/complaint.pdf': path.join(config.formsDir, 'CV-01_Civil_Complaint.pdf'),
    '/summons.pdf': path.join(config.formsDir, 'CV-02_Summons.pdf'),
    '/answer.pdf': path.join(config.formsDir, 'CV-03_Answer_and_Affirmative_Defenses.pdf'),
  };
  const server = http.createServer((req, res) => {
    const file = files[req.url];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/pdf' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ── the run ─────────────────────────────────────────────────── */

(async () => {
  const { server, port } = await startFileHost();
  const upload = (route, name) => [
    {
      url: `http://127.0.0.1:${port}${route}`,
      filename: name,
      content_type: 'application/pdf',
      size: fs.statSync(path.join(config.formsDir, name.replace('uploaded-', ''))).size,
    },
  ];
  console.log('\nFiling');
  const filer = makeInteraction(PLAINTIFF, null);
  const { c: created, channel } = await cases.createCase(filer, {
    kind: 'person',
    defendantRaw: 'justauser, robloxuser',
    department: null,
    reason: 'Slipped on oil in the defendant’s store.',
    links: 'https://example.com/clip',
    files: [],
  });

  assert(/^\d{2}-CC-\d{6}$/.test(created.case_number), `case number ${created.case_number}`);
  assert(channel.name === created.case_number.toLowerCase(), `channel named ${channel.name}`);
  assert(created.status === 'intake' && created.stage === 'intake', 'starts at intake');
  assert(sentMessages.length === 1, 'intake card posted');

  console.log('\nSecond filing increments the docket');
  const second = await cases.createCase(makeInteraction(PLAINTIFF, null), {
    kind: 'department',
    defendantRaw: null,
    department: 'Florida Highway Patrol',
    reason: 'Vehicle impounded without cause.',
    links: '',
    files: [],
  });
  assert(second.c.seq === created.seq + 1, `${created.case_number} → ${second.c.case_number}`);

  console.log('\nClerk opens the case');
  const clerk = makeInteraction(CLERK, channel);
  let c = await cases.openCase(clerk, created);
  assert(c.status === 'open' && c.stage === 'complaint', 'stage → complaint');
  assert(channel.overwrites.get(PLAINTIFF)?.SendMessages === true, 'plaintiff can now type');

  console.log('\nComplaint → summons → service');
  const plaintiff = makeInteraction(PLAINTIFF, channel);
  const files = upload('/complaint.pdf', 'CV-01_Civil_Complaint.pdf');

  let subId = await cases.submitStage(plaintiff, c, 'complaint', files);
  let sub = store.getSubmission(subId);
  assert(sub.status === 'pending' && sub.message_id, 'complaint submission recorded');
  assert(sub.files.length === 1 && sub.files[0].filename, `upload persisted as ${sub.files[0]?.filename}`);

  const reviewCard = sentMessages.at(-1).payload;
  assert(
    (reviewCard.files ?? []).length > 0 && (reviewCard.files ?? []).length <= 10,
    `review card carries ${(reviewCard.files ?? []).length} attachments (max 10)`,
  );
  const galleries = JSON.stringify(reviewCard.components).match(/"type":12/g) ?? [];
  assert(galleries.length >= 2, 'PDF was rendered into a preview gallery');

  assert(store.hasPendingSubmission(c.id, 'complaint'), 'duplicate submissions are blocked while pending');

  await cases.denySubmission(clerk, c, sub, 'Section 4 is blank.');
  sub = store.getSubmission(subId);
  assert(sub.status === 'denied' && sub.deny_reason === 'Section 4 is blank.', 'denial recorded');
  assert(store.getCaseById(c.id).stage === 'complaint', 'stage unchanged after denial');
  assert(
    (await cases.denySubmission(clerk, c, sub, 'again')) === false,
    'a resolved submission cannot be denied twice',
  );

  subId = await cases.submitStage(plaintiff, c, 'complaint', files);
  const staleSub = store.getSubmission(subId);
  c = await cases.approveSubmission(clerk, c, staleSub);
  assert(c.stage === 'summons', 'stage → summons');
  assert(
    (await cases.approveSubmission(clerk, c, staleSub)) === null,
    'double-clicking Approve is a no-op',
  );
  assert(store.getCaseById(c.id).stage === 'summons', 'stage did not regress');

  subId = await cases.submitStage(plaintiff, c, 'summons', upload('/summons.pdf', 'CV-02_Summons.pdf'));
  c = await cases.approveSubmission(clerk, c, store.getSubmission(subId));
  assert(c.stage === 'service', 'stage → service');

  console.log('\nService of process');
  subId = await cases.submitStage(plaintiff, c, 'service', files, {
    defendantUser: 'justauser_',
    defendantId: DEFENDANT,
  });
  assert(
    store.getCaseById(c.id).defendant_id === null,
    'plaintiff-typed defendant is NOT trusted onto the docket',
  );
  assert(
    store.getSubmission(subId).payload.defendantId === DEFENDANT,
    'plaintiff-typed defendant is held on the submission for the clerk to confirm',
  );

  assert(store.resolveSubmission(subId, 'approved', null, CLERK), 'clerk resolves the service card');
  store.updateCase(c.id, { defendant_id: DEFENDANT });
  c = await cases.attachDefendant(clerk, store.getCaseById(c.id), DEFENDANT);
  assert(c.stage === 'answer', 'stage → answer');
  assert(channel.overwrites.get(DEFENDANT)?.SendMessages === true, 'defendant can type');

  console.log('\nAnswer and docketing');
  subId = await cases.submitStage(
    makeInteraction(DEFENDANT, channel),
    c,
    'answer',
    upload('/answer.pdf', 'CV-03_Answer_and_Affirmative_Defenses.pdf'),
  );
  const answerSub = store.getSubmission(subId);
  c = await cases.approveSubmission(clerk, c, answerSub);
  assert(c.status === 'filed' && c.stage === 'filed', 'case is filed');
  assert(Boolean(c.discovery_thread_id), 'discovery thread created');
  const threadBefore = c.discovery_thread_id;
  await cases.approveSubmission(clerk, c, answerSub);
  assert(
    store.getCaseById(c.id).discovery_thread_id === threadBefore,
    'a second Approve does not create a second discovery thread',
  );
  assert(
    sentMessages.some((m) => m.channel === 'discovery'),
    'discovery header posted in the thread',
  );

  console.log('\nExhibits');
  const fakeUpload = (name) => ({
    channelId: c.discovery_thread_id,
    author: { id: PLAINTIFF, bot: false },
    id: `evidence-${name}`,
    attachments: new Map([[name, { name, url: `https://cdn.example/${name}` }]]),
    reply: async () => ({ id: 'reply' }),
  });

  await cases.fileExhibits(fakeUpload('dashcam.mp4'), c);
  await cases.fileExhibits(fakeUpload('receipt.png'), c);
  const exhibits = store.getExhibits(c.id);
  assert(exhibits.length === 2, `${exhibits.length} exhibits filed`);
  assert(
    exhibits[0].letter === 'A' && exhibits[1].letter === 'B',
    `lettered ${exhibits.map((e) => e.letter).join(', ')}`,
  );

  console.log('\nJudge');
  c = await cases.appointJudge(clerk, c, JUDGE);
  assert(c.judge_id === JUDGE, 'judge recorded on the docket');

  console.log('\nActive docket');
  const active = store.getActiveCases();
  assert(active.length === 1, `${active.length} active case (the denied/unopened one is excluded)`);

  server.close();
  fs.rmSync(tmpDb, { force: true });
  fs.rmSync(`${tmpDb}-wal`, { force: true });
  fs.rmSync(`${tmpDb}-shm`, { force: true });

  console.log(
    failures === 0
      ? `\n✅ lifecycle simulation passed (${sentMessages.length} messages sent)\n`
      : `\n❌ ${failures} failure(s)\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\n💥 simulation crashed:', err);
  process.exit(1);
});
