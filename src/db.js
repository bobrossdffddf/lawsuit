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

CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_channel ON cases(channel_id);
CREATE INDEX IF NOT EXISTS idx_cases_status  ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_thread  ON cases(discovery_thread_id);
CREATE INDEX IF NOT EXISTS idx_sub_case      ON submissions(case_id, stage, status);
`);

const now = () => Date.now();

/* ── counters ─────────────────────────────────────────────── */

const nextSeq = db.transaction((key) => {
  db.prepare('INSERT INTO counters (key, value) VALUES (?, 0) ON CONFLICT(key) DO NOTHING').run(key);
  db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?').run(key);
  return db.prepare('SELECT value FROM counters WHERE key = ?').get(key).value;
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
    INSERT INTO submission_files (submission_id, url, filename, content_type, size)
    VALUES (?, ?, ?, ?, ?)
  `),
  filesFor: db.prepare('SELECT * FROM submission_files WHERE submission_id = ?'),

  insertExhibit: db.prepare(`
    INSERT INTO exhibits (case_id, letter, filename, url, uploader_id, message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  exhibitsFor: db.prepare('SELECT * FROM exhibits WHERE case_id = ? ORDER BY id ASC'),
};

/** Allowed columns for updateCase — guards against SQL injection via key names. */
const CASE_COLUMNS = new Set([
  'defendant_id', 'defendant_username', 'defendant_raw', 'status', 'stage',
  'judge_id', 'discovery_thread_id', 'reason', 'links', 'department',
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
  updateCase,

  createCase(row) {
    stmts.insertCase.run({ ...row, ts: now() });
    return stmts.caseByChannel.get(row.channel_id);
  },
  getCaseByChannel: (id) => stmts.caseByChannel.get(id),
  getCaseById: (id) => stmts.caseById.get(id),
  getCaseByThread: (id) => stmts.caseByThread.get(id),
  getActiveCases: () => stmts.activeCases.all(),

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
        f.url,
        f.filename ?? f.name ?? 'upload',
        f.content_type ?? f.contentType ?? null,
        f.size ?? null,
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

  addExhibit: (caseId, letter, filename, url, uploaderId, messageId) =>
    stmts.insertExhibit.run(caseId, letter, filename, url, uploaderId, messageId, now()),
  getExhibits: (caseId) => stmts.exhibitsFor.all(caseId),
};
