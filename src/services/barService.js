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
 * `guild.members.fetch()` with no id is a gateway REQUEST_GUILD_MEMBERS
 * (opcode 8), and Discord rate-limits it hard — running /review a few times in
 * a row was enough to get "Request with opcode 8 was rate limited".
 *
 * So: read the role's own member list out of cache first, only fall back to a
 * full fetch when the cache genuinely has nothing, never fetch more than once
 * a minute, and keep serving the last good roll while rate-limited.
 */
const ROLL_TTL_MS = 5 * 60 * 1000;
const FETCH_COOLDOWN_MS = 60 * 1000;

let cachedRoll = { at: 0, members: [] };
let lastFetchAttempt = 0;

/** Bare {id,label} pairs from whatever the cache already knows. */
function fromCache(guild) {
  const role = guild.roles.cache.get(config.roles.lawyer);
  if (!role) return [];
  return [...role.members.values()]
    .filter((m) => !m.user.bot)
    .map((m) => ({ id: m.id, label: displayName(m), joinedTimestamp: m.joinedTimestamp }));
}

/**
 * @returns {Promise<Array<{id: string, label: string, description: string}>>}
 *   sorted by display name, ready for the review panel dropdowns
 */
async function roll(guild) {
  if (!guild || !config.roles.lawyer) return [];

  const fresh = Date.now() - cachedRoll.at < ROLL_TTL_MS;
  let members = fresh && cachedRoll.members.length ? cachedRoll.members : fromCache(guild);

  // Only reach for the gateway when the cache is actually empty, and never
  // more than once a minute.
  if (!members.length && Date.now() - lastFetchAttempt > FETCH_COOLDOWN_MS) {
    lastFetchAttempt = Date.now();
    try {
      await guild.members.fetch();
      members = fromCache(guild);
    } catch (err) {
      console.warn(`[bar] member fetch unavailable (${err.message}) — using cached roll`);
      members = cachedRoll.members;
    }
  }

  if (members.length) cachedRoll = { at: Date.now(), members };

  // Ratings and case counts come from SQLite, so they are always live even
  // when the member list itself is served from cache.
  return members
    .map((m) => {
      store.seeLawyer(m.id, m.joinedTimestamp ?? undefined);
      const stats = store.getReviewStats(m.id);
      const cases = store.countCasesFor(m.id, 'attorney');
      const rating = stats.n ? `${Number(stats.avg).toFixed(1)}/5 from ${stats.n}` : 'No reviews yet';
      return {
        id: m.id,
        label: m.label,
        description: `${rating} · ${cases} case${cases === 1 ? '' : 's'}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** Drops the cached roll — call when someone gains or loses the bar role. */
function invalidateRoll() {
  cachedRoll = { at: 0, members: [] };
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

module.exports = { roll, invalidateRoll, profilePayload, displayName };
