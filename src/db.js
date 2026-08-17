'use strict';

const fs = require('node:fs');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.tmpDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS cases (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number         TEXT    NOT NULL UNIQUE,
  year                TEXT    NOT NULL,
  seq                 INTEGER NOT NULL,
  kind                TEXT    NOT NULL DEFAULT 'person',   -- 'person' | 'department'
  guild_id            TEXT    NOT NULL,
  channel_id          TEXT    NOT NULL UNIQUE,
  plaintiff_id        TEXT    NOT NULL,
  defendant_raw       TEXT,          -- what the plaintiff typed in the intake modal
  defendant_id        TEXT,          -- resolved once a clerk selects them
  defendant_username  TEXT,
  department          TEXT,
  reason              TEXT,
  links               TEXT,
  status              TEXT    NOT NULL DEFAULT 'intake',   -- intake|denied|open|filed|closed
  stage               TEXT    NOT NULL DEFAULT 'intake',   -- intake|complaint|summons|service|answer|filed
  judge_id            TEXT,
  discovery_thread_id TEXT,
  exhibit_seq         INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  stage        TEXT    NOT NULL,
  submitter_id TEXT    NOT NULL,
  message_id   TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending',        -- pending|approved|denied
  deny_reason  TEXT,
  payload      TEXT,                                       -- JSON: extra modal fields
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolved_by  TEXT
);

CREATE TABLE IF NOT EXISTS submission_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  url           TEXT    NOT NULL,
  filename      TEXT    NOT NULL,
  content_type  TEXT,
  size          INTEGER
);

CREATE TABLE IF NOT EXISTS exhibits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  letter      TEXT    NOT NULL,
  filename    TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  uploader_id TEXT    NOT NULL,
  message_id  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  guild_id   TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  files      TEXT    NOT NULL DEFAULT '[]',
  payload    TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

-- Answers harvested from filed PDFs, replayed into every later form on the
-- same case so nobody retypes their case number five times.
CREATE TABLE IF NOT EXISTS case_fields (
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (case_id, name)
);

-- Everyone with access to a case, and in what capacity.
CREATE TABLE IF NOT EXISTS case_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'party',   -- party|attorney|judge|clerk
  added_by   TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (case_id, user_id, role)
);

-- First time the bot saw someone holding the bar role.
CREATE TABLE IF NOT EXISTS lawyers (
  user_id      TEXT PRIMARY KEY,
  barred_since INTEGER NOT NULL
);

-- Who an attorney has represented. Only clients may review them.
CREATE TABLE IF NOT EXISTS lawyer_clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lawyer_id  TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  case_id    INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  added_by   TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lawyer_reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lawyer_id  TEXT    NOT NULL,
  client_id  TEXT    NOT NULL,
  rating     INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lawyer_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  for_user_id TEXT    NOT NULL,
  requested_by TEXT   NOT NULL,
  channel_id  TEXT,
  message_id  TEXT,
  accepted_by TEXT,
  accepted_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_channel ON cases(channel_id);
CREATE INDEX IF NOT EXISTS idx_cases_status  ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_thread  ON cases(discovery_thread_id);
CREATE INDEX IF NOT EXISTS idx_sub_case      ON submissions(case_id, stage, status);
CREATE INDEX IF NOT EXISTS idx_members_case  ON case_members(case_id);
CREATE INDEX IF NOT EXISTS idx_members_user  ON case_members(user_id, role);
CREATE INDEX IF NOT EXISTS idx_clients       ON lawyer_clients(lawyer_id, client_id);
CREATE INDEX IF NOT EXISTS idx_reviews       ON lawyer_reviews(lawyer_id);
`);

/* ── migrations ───────────────────────────────────────────────
   Additive only, safe to run against an existing live database. */

function ensureColumn(table, column, ddl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// The single live message the bot keeps in each case channel.
ensureColumn('cases', 'case_message_id', 'case_message_id TEXT');
// Where the uploaded file was archived on disk.
ensureColumn('submission_files', 'local_path', 'local_path TEXT');
// Government-claim fields.
ensureColumn('cases', 'compensation', 'compensation TEXT');
ensureColumn('cases', 'employees', 'employees TEXT');
ensureColumn('cases', 'attorney_id', 'attorney_id TEXT');
ensureColumn('cases', 'closed_by', 'closed_by TEXT');
ensureColumn('cases', 'closed_at', 'closed_at INTEGER');
// Lawyer requests remember their blurb and the notice posted in the case channel.
ensureColumn('lawyer_requests', 'details', 'details TEXT');
ensureColumn('lawyer_requests', 'notice_message_id', 'notice_message_id TEXT');

const now = () => Date.now();

/* ── counters ─────────────────────────────────────────────── */

const nextSeq = db.transaction((key) => {
  db.prepare('INSERT INTO counters (key, value) VALUES (?, 0) ON CONFLICT(key) DO NOTHING').run(key);
  db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?').run(key);
  return db.prepare('SELECT value FROM counters WHERE key = ?').get(key).value;
});

const seqStmts = {
  ensure: db.prepare('INSERT INTO counters (key, value) VALUES (?, 0) ON CONFLICT(key) DO NOTHING'),
  read: db.prepare('SELECT value FROM counters WHERE key = ?'),
  write: db.prepare('UPDATE counters SET value = ? WHERE key = ?'),
  highestUsed: db.prepare(
    'SELECT COALESCE(MAX(seq), 0) AS n FROM cases WHERE year = ? AND case_number LIKE ?',
  ),
};

/**
 * Next sequence number on a docket, e.g. ('CC', '26') -> 42.
 *
 * Deliberately takes the MAX of the stored counter and the highest number
 * actually present in `cases`. A counter can be reset, renamed or restored
 * from an older backup; the case table is the real record. This makes the
 * allocator self-healing instead of handing out a duplicate.
 */
const nextCaseSeq = db.transaction((code, year) => {
  const key = `case:${code}:${year}`;
  seqStmts.ensure.run(key);

  const counter = seqStmts.read.get(key)?.value ?? 0;
  const used = seqStmts.highestUsed.get(year, `${year}-${code}-%`).n;

  const next = Math.max(counter, used) + 1;
  seqStmts.write.run(next, key);
  return next;
});

/* ── cases ────────────────────────────────────────────────── */

const stmts = {
  insertCase: db.prepare(`
    INSERT INTO cases (case_number, year, seq, kind, guild_id, channel_id, plaintiff_id,
                       defendant_raw, department, reason, links, status, stage, created_at, updated_at)
    VALUES (@case_number, @year, @seq, @kind, @guild_id, @channel_id, @plaintiff_id,
            @defendant_raw, @department, @reason, @links, 'intake', 'intake', @ts, @ts)
  `),
  caseByChannel: db.prepare('SELECT * FROM cases WHERE channel_id = ?'),
  caseById: db.prepare('SELECT * FROM cases WHERE id = ?'),
  caseByThread: db.prepare('SELECT * FROM cases WHERE discovery_thread_id = ?'),
  activeCases: db.prepare(`SELECT * FROM cases WHERE status IN ('open','filed') ORDER BY seq ASC`),
  bumpExhibit: db.prepare('UPDATE cases SET exhibit_seq = exhibit_seq + 1, updated_at = ? WHERE id = ?'),

  insertSubmission: db.prepare(`
    INSERT INTO submissions (case_id, stage, submitter_id, status, payload, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `),
  submissionById: db.prepare('SELECT * FROM submissions WHERE id = ?'),
  setSubmissionMessage: db.prepare('UPDATE submissions SET message_id = ? WHERE id = ?'),
  // Guarded on status so two clerks clicking Approve at the same moment
  // cannot both "win" — the second UPDATE matches zero rows.
  resolveSubmission: db.prepare(`
    UPDATE submissions SET status = ?, deny_reason = ?, resolved_at = ?, resolved_by = ?
    WHERE id = ? AND status = 'pending'
  `),
  pendingForStage: db.prepare(`
    SELECT id FROM submissions WHERE case_id = ? AND stage = ? AND status = 'pending' LIMIT 1
  `),
  claimIntake: db.prepare(`
    UPDATE cases SET status = ?, stage = ?, updated_at = ? WHERE id = ? AND status = 'intake'
  `),
  advanceStage: db.prepare(`
    UPDATE cases SET stage = ?, updated_at = ? WHERE id = ? AND stage = ?
  `),
  insertFile: db.prepare(`
    INSERT INTO submission_files (submission_id, url, filename, content_type, size, local_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  setCaseMessage: db.prepare('UPDATE cases SET case_message_id = ?, updated_at = ? WHERE id = ?'),
  filesForCase: db.prepare(`
    SELECT f.*, s.stage, s.status, s.submitter_id, s.created_at
    FROM submission_files f
    JOIN submissions s ON s.id = f.submission_id
    WHERE s.case_id = ?
    ORDER BY f.id ASC
  `),
  filesFor: db.prepare('SELECT * FROM submission_files WHERE submission_id = ?'),

  insertExhibit: db.prepare(`
    INSERT INTO exhibits (case_id, letter, filename, url, uploader_id, message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  exhibitsFor: db.prepare('SELECT * FROM exhibits WHERE case_id = ? ORDER BY id ASC'),

  insertDraft: db.prepare(`
    INSERT INTO drafts (user_id, guild_id, kind, created_at) VALUES (?, ?, ?, ?)
  `),
  draftById: db.prepare('SELECT * FROM drafts WHERE id = ?'),
  updateDraft: db.prepare('UPDATE drafts SET files = ?, payload = ? WHERE id = ?'),
  deleteDraft: db.prepare('DELETE FROM drafts WHERE id = ?'),
  pruneDrafts: db.prepare('DELETE FROM drafts WHERE created_at < ?'),

  closeCase: db.prepare(`
    UPDATE cases SET status = 'closed', closed_by = ?, closed_at = ?, updated_at = ?
    WHERE id = ? AND status != 'closed'
  `),

  putField: db.prepare(`
    INSERT INTO case_fields (case_id, name, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(case_id, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  fieldsFor: db.prepare('SELECT name, value FROM case_fields WHERE case_id = ?'),

  addMember: db.prepare(`
    INSERT INTO case_members (case_id, user_id, role, added_by, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
  `),
  membersOf: db.prepare('SELECT * FROM case_members WHERE case_id = ?'),
  memberRoles: db.prepare('SELECT role FROM case_members WHERE case_id = ? AND user_id = ?'),
  dropMember: db.prepare('DELETE FROM case_members WHERE case_id = ? AND user_id = ?'),
  resolvePending: db.prepare(`
    UPDATE submissions SET status = 'approved', resolved_at = ?, resolved_by = ?
    WHERE case_id = ? AND stage = ? AND status = 'pending'
  `),
  caseCountFor: db.prepare(
    'SELECT COUNT(DISTINCT case_id) AS n FROM case_members WHERE user_id = ? AND role = ?',
  ),

  seeLawyer: db.prepare('INSERT INTO lawyers (user_id, barred_since) VALUES (?, ?) ON CONFLICT DO NOTHING'),
  lawyer: db.prepare('SELECT * FROM lawyers WHERE user_id = ?'),

  addClient: db.prepare(`
    INSERT INTO lawyer_clients (lawyer_id, client_id, case_id, added_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  isClient: db.prepare(
    'SELECT 1 AS ok FROM lawyer_clients WHERE lawyer_id = ? AND client_id = ? LIMIT 1',
  ),
  clientsOf: db.prepare(
    'SELECT DISTINCT client_id FROM lawyer_clients WHERE lawyer_id = ? ORDER BY client_id',
  ),

  addReview: db.prepare(`
    INSERT INTO lawyer_reviews (lawyer_id, client_id, rating, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  reviewsOf: db.prepare('SELECT * FROM lawyer_reviews WHERE lawyer_id = ? ORDER BY created_at DESC'),
  reviewStats: db.prepare(
    'SELECT COUNT(*) AS n, AVG(rating) AS avg FROM lawyer_reviews WHERE lawyer_id = ?',
  ),

  addRequest: db.prepare(`
    INSERT INTO lawyer_requests (case_id, for_user_id, requested_by, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  setRequestNotice: db.prepare('UPDATE lawyer_requests SET notice_message_id = ? WHERE id = ?'),
  requestById: db.prepare('SELECT * FROM lawyer_requests WHERE id = ?'),
  setRequestMessage: db.prepare('UPDATE lawyer_requests SET channel_id = ?, message_id = ? WHERE id = ?'),
  acceptRequest: db.prepare(`
    UPDATE lawyer_requests SET accepted_by = ?, accepted_at = ?
    WHERE id = ? AND accepted_by IS NULL
  `),
};

/** Allowed columns for updateCase — guards against SQL injection via key names. */
const CASE_COLUMNS = new Set([
  'defendant_id', 'defendant_username', 'defendant_raw', 'status', 'stage',
  'judge_id', 'discovery_thread_id', 'reason', 'links', 'department',
  'case_message_id', 'compensation', 'employees', 'attorney_id',
]);

function updateCase(id, patch) {
  const keys = Object.keys(patch).filter((k) => CASE_COLUMNS.has(k));
  if (!keys.length) return;
  const sql = `UPDATE cases SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => patch[k]), now(), id);
}

module.exports = {
  db,
  now,
  nextSeq,
  nextCaseSeq,
  updateCase,

  createCase(row) {
    stmts.insertCase.run({ ...row, ts: now() });
    return stmts.caseByChannel.get(row.channel_id);
  },
  getCaseByChannel: (id) => stmts.caseByChannel.get(id),
  getCaseById: (id) => stmts.caseById.get(id),
  getCaseByThread: (id) => stmts.caseByThread.get(id),
  getActiveCases: () => stmts.activeCases.all(),

  /** Remembers which message is the case channel's single live embed. */
  setCaseMessage: (caseId, messageId) => stmts.setCaseMessage.run(messageId, now(), caseId),

  /** Every file ever filed on a case, across all submissions. */
  getCaseFiles: (caseId) => stmts.filesForCase.all(caseId),

  /** Atomically increments the exhibit counter and returns the new value. */
  nextExhibitNumber: db.transaction((caseId) => {
    stmts.bumpExhibit.run(now(), caseId);
    return stmts.caseById.get(caseId).exhibit_seq;
  }),

  createSubmission: db.transaction((caseId, stage, submitterId, files, payload = {}) => {
    const info = stmts.insertSubmission.run(caseId, stage, submitterId, JSON.stringify(payload), now());
    const subId = info.lastInsertRowid;
    for (const f of files) {
      stmts.insertFile.run(
        subId,
        f.url ?? '',
        f.filename ?? f.name ?? 'upload',
        f.content_type ?? f.contentType ?? null,
        f.size ?? null,
        f.localPath ?? f.local_path ?? null,
      );
    }
    return subId;
  }),
  getSubmission(id) {
    const sub = stmts.submissionById.get(id);
    if (!sub) return null;
    sub.files = stmts.filesFor.all(id);
    sub.payload = sub.payload ? JSON.parse(sub.payload) : {};
    return sub;
  },
  setSubmissionMessage: (subId, messageId) => stmts.setSubmissionMessage.run(messageId, subId),
  /**
   * @returns {boolean} true if this caller is the one that resolved it.
   *   false means someone else got there first — do not act on the submission.
   */
  resolveSubmission: (subId, status, reason, byId) =>
    stmts.resolveSubmission.run(status, reason ?? null, now(), byId, subId).changes === 1,

  /** True if this stage already has a submission waiting on a clerk. */
  hasPendingSubmission: (caseId, stage) => Boolean(stmts.pendingForStage.get(caseId, stage)),

  /**
   * Moves a case out of intake exactly once.
   * @returns {boolean} true if this caller performed the transition.
   */
  claimIntake: (caseId, status, stage) =>
    stmts.claimIntake.run(status, stage, now(), caseId).changes === 1,

  /**
   * Moves a case from one stage to the next, but only if it is still on `from`.
   * @returns {boolean} true if this caller performed the transition.
   */
  advanceStage: (caseId, from, to) => stmts.advanceStage.run(to, now(), caseId, from).changes === 1,

  /* ── government-suit drafts (the ephemeral wizard) ────── */

  createDraft(userId, guildId, kind) {
    return stmts.insertDraft.run(userId, guildId, kind, now()).lastInsertRowid;
  },
  getDraft(id) {
    const d = stmts.draftById.get(id);
    if (!d) return null;
    d.files = JSON.parse(d.files || '[]');
    d.payload = JSON.parse(d.payload || '{}');
    return d;
  },
  saveDraft: (id, files, payload) =>
    stmts.updateDraft.run(JSON.stringify(files ?? []), JSON.stringify(payload ?? {}), id),
  deleteDraft: (id) => stmts.deleteDraft.run(id),
  /**
   * Deletes a draft and reports whether this caller was the one that got it.
   * @returns {boolean} false means someone (or a double-submit) already took it.
   */
  claimDraft: (id) => stmts.deleteDraft.run(id).changes === 1,
  /** Drops abandoned wizards. Called on boot. */
  pruneDrafts: (olderThanMs = 24 * 60 * 60 * 1000) => stmts.pruneDrafts.run(now() - olderThanMs).changes,

  /** @returns {boolean} true if this caller closed it (false = already closed). */
  closeCase: (caseId, byId) => stmts.closeCase.run(byId, now(), now(), caseId).changes === 1,

  /* ── carry-forward form answers ───────────────────────── */

  /** Merges harvested PDF answers into the case profile. */
  mergeFields: db.transaction((caseId, fields) => {
    const ts = now();
    let n = 0;
    for (const [name, value] of Object.entries(fields ?? {})) {
      if (!name || value === undefined || value === null || String(value).trim() === '') continue;
      stmts.putField.run(caseId, name, String(value), ts);
      n += 1;
    }
    return n;
  }),
  getFields(caseId) {
    const out = {};
    for (const row of stmts.fieldsFor.all(caseId)) out[row.name] = row.value;
    return out;
  },

  /* ── case membership ──────────────────────────────────── */

  addMember: (caseId, userId, role = 'party', addedBy = null) =>
    stmts.addMember.run(caseId, userId, role, addedBy, now()),
  getMembers: (caseId) => stmts.membersOf.all(caseId),
  getMemberRoles: (caseId, userId) => stmts.memberRoles.all(caseId, userId),
  removeMember: (caseId, userId) => stmts.dropMember.run(caseId, userId),
  /** Closes out anything still waiting on a clerk for a stage being skipped. */
  resolvePendingForStage: (caseId, stage, byId) =>
    stmts.resolvePending.run(now(), byId, caseId, stage).changes,
  countCasesFor: (userId, role = 'attorney') => stmts.caseCountFor.get(userId, role)?.n ?? 0,

  /* ── the bar ──────────────────────────────────────────── */

  seeLawyer: (userId, since) => stmts.seeLawyer.run(userId, since ?? now()),
  getLawyer: (userId) => stmts.lawyer.get(userId),
  addClient: (lawyerId, clientId, caseId, addedBy) =>
    stmts.addClient.run(lawyerId, clientId, caseId ?? null, addedBy ?? null, now()),
  isClientOf: (lawyerId, clientId) => Boolean(stmts.isClient.get(lawyerId, clientId)),
  getClients: (lawyerId) => stmts.clientsOf.all(lawyerId).map((r) => r.client_id),

  addReview: (lawyerId, clientId, rating, body) =>
    stmts.addReview.run(lawyerId, clientId, rating, body, now()),
  getReviews: (lawyerId) => stmts.reviewsOf.all(lawyerId),
  getReviewStats: (lawyerId) => stmts.reviewStats.get(lawyerId) ?? { n: 0, avg: null },

  /* ── lawyer requests ──────────────────────────────────── */

  createRequest: (caseId, forUserId, requestedBy, details = null) =>
    stmts.addRequest.run(caseId, forUserId, requestedBy, details, now()).lastInsertRowid,
  setRequestNotice: (id, messageId) => stmts.setRequestNotice.run(messageId, id),
  getRequest: (id) => stmts.requestById.get(id),
  setRequestMessage: (id, channelId, messageId) => stmts.setRequestMessage.run(channelId, messageId, id),
  /** @returns {boolean} true if this attorney is the one that got it. */
  acceptRequest: (id, lawyerId) => stmts.acceptRequest.run(lawyerId, now(), id).changes === 1,

  addExhibit: (caseId, letter, filename, url, uploaderId, messageId) =>
    stmts.insertExhibit.run(caseId, letter, filename, url, uploaderId, messageId, now()),
  getExhibits: (caseId) => stmts.exhibitsFor.all(caseId),
};
