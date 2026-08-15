'use strict';

const { ChannelType, OverwriteType } = require('discord.js');

const config = require('../config');
const store = require('../db');
const fmt = require('../lib/format');
const { archiveUploads, buildMedia, EMPTY_MEDIA } = require('../lib/media');
const M = require('../ui/messages');
const { STAGES, nextStage, openingStage } = require('../stages');

/* ── permission sets ─────────────────────────────────────────────
   Written as permission *names* because that is what both
   `channels.create({ permissionOverwrites })` and
   `permissionOverwrites.edit(id, { Name: true })` accept.
   ────────────────────────────────────────────────────────────── */

const PARTY_READ = ['ViewChannel', 'ReadMessageHistory'];
const PARTY_WRITE = [
  'ViewChannel',
  'ReadMessageHistory',
  'SendMessages',
  'AttachFiles',
  'EmbedLinks',
  'AddReactions',
  'SendMessagesInThreads',
];
const STAFF = [...PARTY_WRITE, 'ManageMessages', 'CreatePublicThreads', 'CreatePrivateThreads'];
const BOT = [...STAFF, 'ManageChannels', 'ManageThreads'];

/** `['ViewChannel', ...]` -> `{ ViewChannel: true, ... }` */
const grant = (names, value = true) => Object.fromEntries(names.map((n) => [n, value]));

/* ── the single live message ─────────────────────────────────────
   A case channel holds exactly ONE bot message at a time. Each step
   replaces the previous one, so the channel always shows the current
   state and nothing else. Uploaded files live on disk (see
   lib/media.js), not in the message, so replacing it loses nothing.
   ────────────────────────────────────────────────────────────── */

async function showCaseMessage(channel, c, payload) {
  const previous = store.getCaseById(c.id)?.case_message_id;
  if (previous) {
    await channel.messages.delete(previous).catch(() => {});
  }
  const sent = await channel.send(payload);
  store.setCaseMessage(c.id, sent.id);
  return sent;
}

/* ── logging ─────────────────────────────────────────────────── */

async function log(client, line) {
  if (!config.channels.log) return;
  try {
    const ch = await client.channels.fetch(config.channels.log);
    await ch.send({ content: line, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[log] failed:', err.message);
  }
}

/* ── 1. Create the case channel ──────────────────────────────── */

async function createCase(interaction, input) {
  const guild = interaction.guild;
  const { caseNumber, year, seq } = fmt.allocateCaseNumber();

  const overwrites = [
    { id: guild.roles.everyone.id, deny: ['ViewChannel'], type: OverwriteType.Role },
    // Plaintiff can watch but not speak until a clerk opens the case.
    { id: interaction.user.id, allow: PARTY_READ, deny: ['SendMessages'], type: OverwriteType.Member },
    { id: config.roles.clerk, allow: STAFF, type: OverwriteType.Role },
    { id: interaction.client.user.id, allow: BOT, type: OverwriteType.Member },
  ];
  if (config.roles.judge && config.roles.judge !== config.roles.clerk) {
    overwrites.push({ id: config.roles.judge, allow: STAFF, type: OverwriteType.Role });
  }

  const channel = await guild.channels.create({
    name: caseNumber.toLowerCase(),
    type: ChannelType.GuildText,
    parent: config.channels.civilCategory,
    topic: `${caseNumber} · Plaintiff: ${interaction.user.tag} · Defendant: ${
      input.department || input.defendantRaw
    }`.slice(0, 1024),
    permissionOverwrites: overwrites,
    reason: `Civil case ${caseNumber} filed by ${interaction.user.tag}`,
  });

  const c = store.createCase({
    case_number: caseNumber,
    year,
    seq,
    kind: input.kind,
    guild_id: guild.id,
    channel_id: channel.id,
    plaintiff_id: interaction.user.id,
    defendant_raw: input.defendantRaw ?? null,
    department: input.department ?? null,
    reason: input.reason,
    links: input.links ?? null,
  });

  // Archive the intake evidence, then record it against a submission row so it
  // is queryable alongside everything else filed on the case.
  const archived = await archiveUploads(input.files ?? [], caseNumber, 'intake');
  if (archived.length) {
    const subId = store.createSubmission(c.id, 'intake', interaction.user.id, archived, {});
    store.resolveSubmission(subId, 'approved', null, interaction.user.id);
  }

  const media = archived.length ? await buildMedia(archived, `${caseNumber}-intake`) : EMPTY_MEDIA;
  await showCaseMessage(channel, c, M.intakeMessage(c, media));

  await log(
    interaction.client,
    `[FILED] \`${caseNumber}\` by <@${interaction.user.id}> against **${
      input.department || input.defendantRaw
    }** → <#${channel.id}>`,
  );

  return { c, channel };
}

/**
 * Creates the channel for a claim against a government entity, from the data
 * the ephemeral wizard collected.
 */
async function createDepartmentCase(interaction, draft) {
  const guild = interaction.guild;
  const { caseNumber, year, seq } = fmt.allocateCaseNumber();
  const p = draft.payload;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: ['ViewChannel'], type: OverwriteType.Role },
    { id: interaction.user.id, allow: PARTY_READ, deny: ['SendMessages'], type: OverwriteType.Member },
    { id: config.roles.clerk, allow: STAFF, type: OverwriteType.Role },
    { id: interaction.client.user.id, allow: BOT, type: OverwriteType.Member },
  ];
  if (config.roles.judge && config.roles.judge !== config.roles.clerk) {
    overwrites.push({ id: config.roles.judge, allow: STAFF, type: OverwriteType.Role });
  }
  // The filer's attorney gets in from the start so they can advise immediately.
  if (p.attorneyId && p.attorneyId !== interaction.user.id) {
    overwrites.push({ id: p.attorneyId, allow: PARTY_WRITE, type: OverwriteType.Member });
  }

  const channel = await guild.channels.create({
    name: caseNumber.toLowerCase(),
    type: ChannelType.GuildText,
    parent: config.channels.civilCategory,
    topic: `${caseNumber} · Claimant: ${interaction.user.tag} · Agency: ${p.department}`.slice(0, 1024),
    permissionOverwrites: overwrites,
    reason: `Government claim ${caseNumber} filed by ${interaction.user.tag}`,
  });

  const c = store.createCase({
    case_number: caseNumber,
    year,
    seq,
    kind: 'department',
    guild_id: guild.id,
    channel_id: channel.id,
    plaintiff_id: interaction.user.id,
    defendant_raw: null,
    department: p.department,
    reason: p.description,
    links: null,
  });

  store.updateCase(c.id, {
    compensation: p.compensation ?? null,
    employees: JSON.stringify(p.employees ?? []),
    attorney_id: p.attorneyId ?? null,
  });

  // The wizard held the uploads as Discord descriptors; archive them now that
  // there is a case number to file them under.
  const archived = await archiveUploads(draft.files ?? [], caseNumber, 'notice');
  if (archived.length) {
    const subId = store.createSubmission(c.id, 'intake', interaction.user.id, archived, {});
    store.resolveSubmission(subId, 'approved', null, interaction.user.id);
  }

  const fresh = store.getCaseById(c.id);
  const media = archived.length ? await buildMedia(archived, `${caseNumber}-notice`) : EMPTY_MEDIA;
  await showCaseMessage(channel, fresh, M.departmentIntakeMessage(fresh, media));

  await log(
    interaction.client,
    `[FILED] \`${caseNumber}\` government claim by <@${interaction.user.id}> against **${p.department}** -> <#${channel.id}>`,
  );

  return { c: fresh, channel };
}

/* ── 2. Intake decision ──────────────────────────────────────── */

async function openCase(interaction, c) {
  const channel = interaction.channel;

  // Claim the transition first. If another clerk beat us to it the UPDATE
  // matches no rows and we bail out instead of posting a duplicate prompt.
  const opening = openingStage(c.kind);
  if (!store.claimIntake(c.id, 'open', opening)) return null;

  await channel.permissionOverwrites.edit(c.plaintiff_id, grant(PARTY_WRITE), {
    reason: `Case ${c.case_number} opened by ${interaction.user.tag}`,
  });

  const updated = store.getCaseById(c.id);
  await showCaseMessage(channel, updated, M.stagePrompt(opening, updated));
  await log(interaction.client, `[OPENED] \`${c.case_number}\` by <@${interaction.user.id}>`);
  return updated;
}

async function denyCase(interaction, c, reason) {
  const channel = interaction.channel;
  if (!store.claimIntake(c.id, 'denied', 'intake')) return null;

  // DM the plaintiff; fall back to an in-channel note if their DMs are shut.
  let dmed = true;
  try {
    const user = await interaction.client.users.fetch(c.plaintiff_id);
    await user.send(M.intakeDenialDM(c, reason, interaction.user.id));
  } catch {
    dmed = false;
  }

  await showCaseMessage(
    channel,
    c,
    M.intakeDeniedNotice(c, reason, interaction.user.id, { dmFailed: !dmed }),
  );

  if (config.deniedCaseAction === 'delete') {
    setTimeout(() => {
      channel.delete(`Case ${c.case_number} denied`).catch(() => {});
    }, config.deleteDelaySeconds * 1000);
  } else {
    await channel.permissionOverwrites
      .edit(c.plaintiff_id, { SendMessages: false }, { reason: 'Case denied' })
      .catch(() => {});
  }

  await log(interaction.client, `[DENIED] \`${c.case_number}\` by <@${interaction.user.id}> — ${reason}`);
  return { dmed };
}

/* ── 3. Stage submissions ────────────────────────────────────── */

async function submitStage(interaction, c, stage, uploads, payload = {}) {
  const archived = await archiveUploads(uploads, c.case_number, stage);
  const submissionId = store.createSubmission(c.id, stage, interaction.user.id, archived, payload);

  const media = await buildMedia(archived, `${c.case_number}-${stage}`);

  const extra = [];
  if (stage === 'service') {
    extra.push(
      `> Defendant username: \`${fmt.clean(payload.defendantUser, 100)}\`\n` +
        `> Defendant ID: \`${fmt.clean(payload.defendantId, 30)}\``,
    );
  }

  const sent = await showCaseMessage(
    interaction.channel,
    c,
    M.reviewMessage(stage, c, submissionId, media, interaction.user.id, extra),
  );
  store.setSubmissionMessage(submissionId, sent.id);

  // NOTE: the defendant the plaintiff typed is deliberately NOT written to the
  // case row here. It stays on the submission payload until a clerk confirms it
  // with the user picker, so an unverified snowflake can never be pinged as a
  // party or shown on the public docket.
  return submissionId;
}

async function approveSubmission(interaction, c, sub) {
  // Stale card: the case already moved past the stage this submission belongs to.
  if (c.stage !== sub.stage) return null;
  // Someone else resolved it between the button check and now.
  if (!store.resolveSubmission(sub.id, 'approved', null, interaction.user.id)) return null;

  const next = nextStage(c.kind, sub.stage);
  if (!next || !store.advanceStage(c.id, sub.stage, next)) return null;

  const updated = store.getCaseById(c.id);

  if (next === 'filed') {
    await finalizeFiling(interaction, updated);
  } else {
    await showCaseMessage(interaction.channel, updated, M.stagePrompt(next, updated));
  }

  await log(
    interaction.client,
    `[APPROVED] \`${c.case_number}\` ${sub.stage} by <@${interaction.user.id}> -> ${next}`,
  );
  return store.getCaseById(c.id);
}

async function denySubmission(interaction, c, sub, reason) {
  if (!store.resolveSubmission(sub.id, 'denied', reason, interaction.user.id)) return false;

  await showCaseMessage(
    interaction.channel,
    c,
    M.stagePrompt(sub.stage, c, { denialReason: reason, deniedBy: interaction.user.id }),
  );

  await log(
    interaction.client,
    `[REJECTED] \`${c.case_number}\` ${sub.stage} by <@${interaction.user.id}> — ${reason}`,
  );
  return true;
}

/**
 * Advances a stage that needs no upload and no clerk review — the filer just
 * presses "Next Step" when the real-world step is done. Used by the
 * government-claim `notice` stage.
 */
async function advanceWithoutSubmission(interaction, c) {
  const next = nextStage(c.kind, c.stage);
  if (!next) return null;
  if (!store.advanceStage(c.id, c.stage, next)) return null;

  const updated = store.getCaseById(c.id);
  if (next === 'filed') await finalizeFiling(interaction, updated);
  else await showCaseMessage(interaction.channel, updated, M.stagePrompt(next, updated));

  await log(
    interaction.client,
    `[ADVANCED] \`${c.case_number}\` ${c.stage} -> ${next} by <@${interaction.user.id}>`,
  );
  return store.getCaseById(c.id);
}

/* ── 4. Adding the defendant after service is approved ───────── */

async function attachDefendant(interaction, c, defendantId) {
  const channel = interaction.channel;

  await channel.permissionOverwrites.edit(defendantId, grant(PARTY_WRITE), {
    reason: `Defendant added to ${c.case_number}`,
  });

  store.updateCase(c.id, { defendant_id: defendantId });
  if (!store.advanceStage(c.id, 'service', 'answer')) return null;
  const updated = store.getCaseById(c.id);

  await showCaseMessage(channel, updated, M.stagePrompt('answer', updated));
  await log(interaction.client, `[DEFENDANT] \`${c.case_number}\` <@${defendantId}> added to the case`);
  return updated;
}

/* ── 5. Docketing + discovery thread ─────────────────────────── */

async function finalizeFiling(interaction, c) {
  const channel = interaction.channel;
  if (c.discovery_thread_id) return c; // already docketed
  store.updateCase(c.id, { status: 'filed' });

  await showCaseMessage(channel, c, M.lawsuitFiled(c));

  let thread;
  try {
    thread = await channel.threads.create({
      name: `${c.case_number} Discovery`,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: 10080,
      reason: `Discovery for ${c.case_number}`,
    });
  } catch (err) {
    console.warn('[discovery] private thread unavailable, falling back to public:', err.message);
    thread = await channel.threads.create({
      name: `${c.case_number} Discovery`,
      type: ChannelType.PublicThread,
      autoArchiveDuration: 10080,
      reason: `Discovery for ${c.case_number}`,
    });
  }

  store.updateCase(c.id, { discovery_thread_id: thread.id });
  const updated = store.getCaseById(c.id);

  // Pull in everyone who can already see the case channel.
  const invitees = new Set([c.plaintiff_id, c.defendant_id, c.judge_id, interaction.user.id].filter(Boolean));
  try {
    for (const member of channel.members.values()) {
      if (!member.user.bot) invitees.add(member.id);
    }
  } catch { /* GuildMembers intent may be off; parties are still added below */ }

  for (const id of [...invitees].slice(0, 50)) {
    await thread.members.add(id).catch(() => {});
  }

  const header = await thread.send(M.discoveryHeader(updated));
  await header.pin().catch(() => {});

  await log(interaction.client, `[DOCKETED] \`${c.case_number}\` — discovery thread <#${thread.id}>`);
  return updated;
}

/* ── 6. Discovery exhibits ───────────────────────────────────── */

async function fileExhibits(message, c) {
  const letters = [];
  const uploads = [];

  for (const att of message.attachments.values()) {
    const n = store.nextExhibitNumber(c.id);
    const letter = fmt.exhibitLetter(n);
    letters.push(letter);
    store.addExhibit(c.id, letter, att.name, att.url, message.author.id, message.id);
    uploads.push({ url: att.url, filename: att.name, content_type: att.contentType, size: att.size });
  }
  if (!letters.length) return null;

  // Discovery evidence is the record that matters most — keep a copy on disk.
  await archiveUploads(uploads, c.case_number, `discovery/exhibit-${letters[0]}`);

  const label = letters.length === 1 ? letters[0] : `${letters[0]}–${letters[letters.length - 1]}`;
  const names = [...message.attachments.values()].map((a) => a.name).join(', ');

  return message.reply({ ...M.exhibitFiled(label, names), allowedMentions: { parse: [] } });
}

/* ── 7. Judge appointment ────────────────────────────────────── */

async function appointJudge(interaction, c, judgeId) {
  const channel = interaction.channel;

  await channel.permissionOverwrites
    .edit(judgeId, grant(STAFF), { reason: `Judge appointed to ${c.case_number}` })
    .catch(() => {});

  store.updateCase(c.id, { judge_id: judgeId });
  const updated = store.getCaseById(c.id);

  if (updated.discovery_thread_id) {
    const thread = await channel.threads.fetch(updated.discovery_thread_id).catch(() => null);
    await thread?.members.add(judgeId).catch(() => {});
  }

  await showCaseMessage(channel, updated, M.judgeAppointed(updated, judgeId));
  await log(interaction.client, `[JUDGE] \`${c.case_number}\` <@${judgeId}> appointed`);
  return updated;
}

/* ── 8. Closing a case (/close) ──────────────────────────────── */

async function closeCase(interaction, c) {
  if (!store.closeCase(c.id, interaction.user.id)) return null;
  const channel = interaction.channel;

  for (const id of [c.plaintiff_id, c.defendant_id, c.attorney_id].filter(Boolean)) {
    await channel.permissionOverwrites
      .edit(id, { SendMessages: false, SendMessagesInThreads: false }, { reason: `Case ${c.case_number} closed` })
      .catch(() => {});
  }

  if (c.discovery_thread_id) {
    const thread = await channel.threads.fetch(c.discovery_thread_id).catch(() => null);
    await thread?.setLocked(true).catch(() => {});
    await thread?.setArchived(true).catch(() => {});
  }

  const updated = store.getCaseById(c.id);
  await showCaseMessage(channel, updated, M.caseClosed(updated, interaction.user.id));
  await log(interaction.client, `[CLOSED] \`${c.case_number}\` by <@${interaction.user.id}>`);
  return updated;
}

/* ── 9. Manual party add (/add) ──────────────────────────────── */

async function addParty(interaction, c, userId) {
  await interaction.channel.permissionOverwrites.edit(userId, grant(PARTY_WRITE), {
    reason: `Added to ${c.case_number} by ${interaction.user.tag}`,
  });

  if (c.discovery_thread_id) {
    const thread = await interaction.channel.threads.fetch(c.discovery_thread_id).catch(() => null);
    await thread?.members.add(userId).catch(() => {});
  }
  await log(interaction.client, `[ADDED] \`${c.case_number}\` <@${userId}> by <@${interaction.user.id}>`);
}

module.exports = {
  showCaseMessage,
  createCase,
  createDepartmentCase,
  advanceWithoutSubmission,
  closeCase,
  openCase,
  denyCase,
  submitStage,
  approveSubmission,
  denySubmission,
  attachDefendant,
  finalizeFiling,
  fileExhibits,
  appointJudge,
  addParty,
  log,
  PARTY_READ,
  PARTY_WRITE,
  STAFF,
  grant,
};
