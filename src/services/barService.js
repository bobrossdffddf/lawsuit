'use strict';

const config = require('../config');
const store = require('../db');
const L = require('../ui/lawyers');

/**
 * Everything about the bar roll that needs to touch Discord: who holds the
 * lawyer role, what their per-server name is, and how long they have been
 * barred.
 *
 * Discord does not expose when a role was granted, so the bot records the first
 * moment it sees someone holding it. Members already barred when the bot is
 * installed fall back to the date they joined the server, which is the closest
 * honest answer available.
 */

/** Per-server display name — nickname if set, otherwise their username. */
const displayName = (member) => member.nickname || member.user.globalName || member.user.username;

/**
 * @returns {Promise<Array<{id: string, label: string, description: string}>>}
 *   sorted by display name, ready for the review panel dropdowns
 */
async function roll(guild) {
  if (!guild || !config.roles.lawyer) return [];

  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    console.error('[bar] could not fetch members:', err.message);
    return [];
  }

  const out = [];
  for (const member of members.values()) {
    if (member.user.bot) continue;
    if (!member.roles.cache.has(config.roles.lawyer)) continue;

    // Remember the first time we saw them barred.
    store.seeLawyer(member.id, member.joinedTimestamp ?? undefined);

    const stats = store.getReviewStats(member.id);
    const cases = store.countCasesFor(member.id, 'attorney');
    const rating = stats.n ? `${Number(stats.avg).toFixed(1)}/5 from ${stats.n}` : 'No reviews yet';

    out.push({
      id: member.id,
      label: displayName(member),
      description: `${rating} · ${cases} case${cases === 1 ? '' : 's'}`,
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** Builds the profile screen for one attorney, resolving reviewer names. */
async function profilePayload(interaction, lawyerId, page = 0) {
  const guild = interaction.guild;
  const member = await guild?.members.fetch(lawyerId).catch(() => null);

  const record = store.getLawyer(lawyerId);
  const barredSince = record?.barred_since ?? member?.joinedTimestamp ?? null;

  const reviews = store.getReviews(lawyerId);
  // Resolve each reviewer to their per-server name, cheaply and best-effort.
  for (const r of reviews) {
    const reviewer = guild?.members.cache.get(r.client_id);
    r.client_name = reviewer ? displayName(reviewer) : `user ${r.client_id.slice(-4)}`;
  }

  const lawyer = {
    id: lawyerId,
    name: member ? displayName(member) : `Unknown attorney (${lawyerId})`,
    barredSince,
    casesHandled: store.countCasesFor(lawyerId, 'attorney'),
  };

  return L.lawyerProfile(lawyer, reviews, page, store.isClientOf(lawyerId, interaction.user.id));
}

module.exports = { roll, profilePayload, displayName };
