'use strict';

const { ChannelType, OverwriteType } = require('discord.js');

const config = require('../config');
const store = require('../db');
const fmt = require('../lib/format');
const { buildMedia } = require('../lib/media');
const M = require('../ui/messages');
const { STAGES } = require('../stages');

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

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} input { kind, defendantRaw, department, reason, links, files }
 */
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

  const media = await buildMedia(input.files ?? [], `${caseNumber}-intake`);
  const msg = M.intakeMessage(c, media);
  await channel.send({ ...msg, files: media.attachments });

  await log(
    interaction.client,
    `📄 \`${caseNumber}\` filed by <@${interaction.user.id}> against **${
      input.department || input.defendantRaw
    }** → <#${channel.id}>`,
  );

  return { c, channel };
}

/* ── 2. Intake decision ──────────────────────────────────────── */

async function openCase(interaction, c) {
  const channel = interaction.channel;

  // Claim the transition first. If another clerk beat us to it the UPDATE
  // matches no rows and we bail out instead of posting a duplicate prompt.
  if (!store.claimIntake(c.id, 'open', 'complaint')) return null;

  await channel.permissionOverwrites.edit(c.plaintiff_id, grant(PARTY_WRITE), {
    reason: `Case ${c.case_number} opened by ${interaction.user.tag}`,
  });

  const updated = store.getCaseById(c.id);

  await channel.send(M.stagePrompt('complaint', updated));
  await log(interaction.client, `✅ \`${c.case_number}\` opened by <@${interaction.user.id}>`);
  return updated;
}

async function denyCase(interaction, c, reason) {
  const channel = interaction.channel;
  if (!store.claimIntake(c.id, 'denied', 'intake')) return null;

  // DM the plaintiff; fall back to an in-channel ping if their DMs are shut.
  let dmed = true;
  try {
    const user = await interaction.client.users.fetch(c.plaintiff_id);
    await user.send(M.intakeDenialDM(c, reason, interaction.user.id));
  } catch {
    dmed = false;
  }

  await channel.send(M.intakeDeniedNotice(c, reason, interaction.user.id));
  if (!dmed) {
    await channel.send({
      content: `<@${c.plaintiff_id}> — your DMs are closed, so the denial notice is posted above.`,
      allowedMentions: { users: [c.plaintiff_id] },
    });
  }

  if (config.deniedCaseAction === 'delete') {
    setTimeout(() => {
      channel.delete(`Case ${c.case_number} denied`).catch(() => {});
    }, config.deleteDelaySeconds * 1000);
  } else {
    await channel.permissionOverwrites
      .edit(c.plaintiff_id, { SendMessages: false }, { reason: 'Case denied' })
      .catch(() => {});
  }

  await log(interaction.client, `⛔ \`${c.case_number}\` denied by <@${interaction.user.id}> — ${reason}`);
  return { dmed };
}

/* ── 3. Stage submissions ────────────────────────────────────── */

/**
 * Records a submission and posts the clerk review card.
 * @returns {number} submission id
 */
async function submitStage(interaction, c, stage, files, payload = {}) {
  const submissionId = store.createSubmission(c.id, stage, interaction.user.id, files, payload);

  const media = await buildMedia(files, `${c.case_number}-${stage}`);

  const extra = [];
  if (stage === 'service') {
    extra.push(
      `> Defendant username: \`${fmt.clean(payload.defendantUser, 100)}\`\n` +
        `> Defendant ID: \`${fmt.clean(payload.defendantId, 30)}\``,
    );
  }

  const msg = M.reviewMessage(stage, c, submissionId, media, interaction.user.id, extra);
  const sent = await interaction.channel.send(msg);
  store.setSubmissionMessage(submissionId, sent.id);

  // NOTE: the defendant the plaintiff typed is deliberately NOT written to the
  // case row here. It stays on the submission payload until a clerk confirms it
  // with the user picker, so an unverified snowflake can never be pinged as a
  // party or shown on the public docket.
  return submissionId;
}

/** Strips the buttons off a resolved review card so it can't be double-clicked. */
async function sealReview(interaction, c, sub, status, reason) {
  if (!sub.message_id) return;
  try {
    const msg = await interaction.channel.messages.fetch(sub.message_id);

    // Keep the files that are already on the message rather than re-uploading,
    // and keep referencing them through attachment:// so the edit is valid.
    const keep = [...msg.attachments.values()];
    const media = { galleryItems: [], fileComponents: [] };
    for (const att of keep) {
      if (att.contentType?.startsWith('image/') && media.galleryItems.length < 10) {
        media.galleryItems.push({ media: { url: `attachment://${att.name}` }, description: att.name });
      } else if (!att.contentType?.startsWith('image/')) {
        media.fileComponents.push({ type: 13, file: { url: `attachment://${att.name}` } });
      }
    }

    await msg.edit({
      ...M.reviewResolved(sub.stage, c, media, sub.submitter_id, status, interaction.user.id, reason),
      attachments: keep,
    });
  } catch (err) {
    console.error('[review] could not seal message:', err.message);
  }
}

async function approveSubmission(interaction, c, sub) {
  // Stale card: the case already moved past the stage this submission belongs to.
  if (c.stage !== sub.stage) return null;
  // Someone else resolved it between the button check and now.
  if (!store.resolveSubmission(sub.id, 'approved', null, interaction.user.id)) return null;

  const nextStage = STAGES[sub.stage].next;
  if (!store.advanceStage(c.id, sub.stage, nextStage)) return null;

  await sealReview(interaction, c, sub, 'approved');
  const updated = store.getCaseById(c.id);

  if (nextStage === 'filed') {
    await finalizeFiling(interaction, updated);
  } else {
    await interaction.channel.send(M.stagePrompt(nextStage, updated));
  }

  await log(
    interaction.client,
    `👍 \`${c.case_number}\` ${sub.stage} approved by <@${interaction.user.id}> → ${nextStage}`,
  );
  return store.getCaseById(c.id);
}

async function denySubmission(interaction, c, sub, reason) {
  if (!store.resolveSubmission(sub.id, 'denied', reason, interaction.user.id)) return false;
  await sealReview(interaction, c, sub, 'denied', reason);
  await interaction.channel.send(M.stagePrompt(sub.stage, c, { denialReason: reason }));
  await log(
    interaction.client,
    `👎 \`${c.case_number}\` ${sub.stage} denied by <@${interaction.user.id}> — ${reason}`,
  );
  return true;
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

  await channel.send(M.stagePrompt('answer', updated));
  await log(interaction.client, `⚖️ \`${c.case_number}\` defendant <@${defendantId}> added to the case`);
  return updated;
}

/* ── 5. Docketing + discovery thread ─────────────────────────── */

async function finalizeFiling(interaction, c) {
  const channel = interaction.channel;
  if (c.discovery_thread_id) return c; // already docketed
  store.updateCase(c.id, { status: 'filed' });

  await channel.send(M.lawsuitFiled(c));

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

  await log(interaction.client, `📁 \`${c.case_number}\` docketed — discovery thread <#${thread.id}>`);
  return updated;
}

/* ── 6. Discovery exhibits ───────────────────────────────────── */

async function fileExhibits(message, c) {
  const letters = [];
  for (const att of message.attachments.values()) {
    const n = store.nextExhibitNumber(c.id);
    const letter = fmt.exhibitLetter(n);
    letters.push(letter);
    store.addExhibit(c.id, letter, att.name, att.url, message.author.id, message.id);
  }
  if (!letters.length) return null;

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

  await channel.send(M.judgeAppointed(updated, judgeId));
  await log(interaction.client, `👨‍⚖️ \`${c.case_number}\` judge <@${judgeId}> appointed`);
  return updated;
}

/* ── 8. Manual party add (/add) ──────────────────────────────── */

async function addParty(interaction, c, userId) {
  await interaction.channel.permissionOverwrites.edit(userId, grant(PARTY_WRITE), {
    reason: `Added to ${c.case_number} by ${interaction.user.tag}`,
  });

  if (c.discovery_thread_id) {
    const thread = await interaction.channel.threads.fetch(c.discovery_thread_id).catch(() => null);
    await thread?.members.add(userId).catch(() => {});
  }
  await log(interaction.client, `➕ \`${c.case_number}\` <@${userId}> added by <@${interaction.user.id}>`);
}

module.exports = {
  sealReview,
  createCase,
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
