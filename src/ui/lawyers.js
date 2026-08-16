'use strict';

const { MessageFlags } = require('discord.js');

const config = require('../config');
const { IDS, withArg } = require('../lib/ids');
const fmt = require('../lib/format');
const U = require('./common');

const { V2, T, STYLE } = U;

// Ephemeral is set once, on the first reply. Discord only accepts
// SUPPRESS_EMBEDS / IS_COMPONENTS_V2 in an edit body, so these payloads carry
// V2 only and `ephemeral()` adds the bit at the single entry point.
const EPHEMERAL = MessageFlags.Ephemeral;
const ephemeral = (payload) => ({ ...payload, flags: payload.flags | EPHEMERAL });

const REVIEWS_PER_PAGE = 5;
const heading = (line) => U.titleWith(config.brand.reviewEmoji, line);
const stars = (n) => config.brand.starEmoji.repeat(Math.max(1, Math.min(5, Number(n) || 1)));

/* ══════════════════════════════════════════════════════════════
   /review — pick an attorney
   ══════════════════════════════════════════════════════════════ */

/**
 * Splits the bar roll into the two dropdowns the panel shows.
 *
 * Buckets on the first *letter*, ignoring leading punctuation, digits and
 * accents — otherwise a nickname like `_zeus` or `Ømar` sorts by code point
 * and lands in the wrong half, where nobody would think to look for it.
 * Names with no letter at all go in A-M so they are never lost.
 */
// Letters that NFD cannot decompose into "plain letter + accent".
const TRANSLITERATE = { Ø: 'O', Æ: 'A', Œ: 'O', Ł: 'L', Đ: 'D', Þ: 'T', Ð: 'D', ß: 'S' };

function firstLetter(label) {
  const normalised = String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[ØÆŒŁĐÞÐß]/g, (ch) => TRANSLITERATE[ch] ?? ch);
  const match = normalised.match(/[A-Z]/);
  return match ? match[0] : 'A';
}

function splitRoll(lawyers) {
  return {
    am: lawyers.filter((l) => firstLetter(l.label) < 'N'),
    nz: lawyers.filter((l) => firstLetter(l.label) >= 'N'),
  };
}

const option = (l) => ({
  label: fmt.truncate(l.label, 100),
  value: l.id,
  ...(l.description ? { description: fmt.truncate(l.description, 100) } : {}),
});

/**
 * @param {Array<{id: string, label: string, description?: string}>} lawyers
 *   the bar roll, already sorted by per-server display name
 */
function reviewPanel(lawyers) {
  const { am, nz } = splitRoll(lawyers);

  const inner = [
    U.text(heading('Lawyer Reviews')),
    U.text(
      'Welcome to the lawyer review panel. You can view the past clients of a lawyer and their ' +
        'reviews of the lawyer. Please find the lawyer you would like to review or see the reviews ' +
        'of by searching for their per server username. (Ex. Max Goodman would be under the first ' +
        'dropdown.)',
    ),
    U.sep(1),
  ];

  if (!lawyers.length) {
    inner.push(U.text('-# No one currently holds the bar role, so there is nobody to review yet.'));
    return { flags: V2, components: [U.containerWith(config.brand.reviewBanner, inner)] };
  }

  // Discord caps a select at 25 options, so each half is paged if the bar grows.
  const dropdown = (bucket, label, id) => {
    if (!bucket.length) {
      inner.push(U.text(label), U.text(`-# No attorneys in ${label.split(' ').pop()} yet.`));
      return;
    }
    inner.push(U.text(label));
    for (let i = 0; i < bucket.length; i += 25) {
      const slice = bucket.slice(i, i + 25);
      inner.push({
        type: T.ACTION_ROW,
        components: [
          {
            type: T.STRING_SELECT,
            custom_id: withArg(id, String(i / 25)),
            placeholder: `Select an attorney (${label})`,
            min_values: 1,
            max_values: 1,
            options: slice.map(option),
          },
        ],
      });
    }
  };

  dropdown(am, 'Lawyers A-M', IDS.REVIEW_PICK_AM);
  dropdown(nz, 'Lawyers N-Z', IDS.REVIEW_PICK_NZ);

  return { flags: V2, components: [U.containerWith(config.brand.reviewBanner, inner)] };
}

/* ══════════════════════════════════════════════════════════════
   A single attorney's profile and reviews
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {object} lawyer  { id, name, barredSince, casesHandled }
 * @param {Array}  reviews newest first
 * @param {number} page    0-based
 * @param {boolean} canReview whether the viewer is a client of this attorney
 */
function lawyerProfile(lawyer, reviews, page = 0, canReview = false) {
  const pages = Math.max(1, Math.ceil(reviews.length / REVIEWS_PER_PAGE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = reviews.slice(current * REVIEWS_PER_PAGE, current * REVIEWS_PER_PAGE + REVIEWS_PER_PAGE);

  const average = reviews.length
    ? (reviews.reduce((t, r) => t + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  const inner = [
    U.text(heading('Lawyer Reviews')),
    U.text(
      `Name: ${fmt.clean(lawyer.name, 100)}\n` +
        `Barred Since: ${lawyer.barredSince ? fmt.timestamp(lawyer.barredSince, 'D') : 'Unknown'}\n` +
        `Cases handled: ${lawyer.casesHandled}` +
        (average ? `\nRating: ${average} / 5 across ${reviews.length} review${reviews.length === 1 ? '' : 's'}` : ''),
    ),
    U.sep(1),
  ];

  if (!slice.length) {
    inner.push(U.text('> No reviews yet. If this attorney represented you, you can be the first.'));
  }

  slice.forEach((r, i) => {
    const n = current * REVIEWS_PER_PAGE + i + 1;
    inner.push(
      U.text(
        `> ## ${n}.  ${stars(r.rating)} - ${fmt.clean(r.client_name ?? 'a client', 40)}\n` +
          `>>> ${fmt.clean(r.body, 700)}\n` +
          `-# ${fmt.timestamp(r.created_at, 'f')}\n`,
      ),
    );
    if (i < slice.length - 1) inner.push(U.sep(2));
  });

  inner.push(
    U.sep(2),
    U.row(
      U.button(`pill:page:${lawyer.id}`, `Page ${current + 1}/${pages}`, STYLE.SECONDARY, {
        disabled: true,
      }),
      U.button(withArg(IDS.REVIEW_PAGE, `${lawyer.id}.${current - 1}`), 'Prev', STYLE.SECONDARY, {
        disabled: current === 0,
      }),
      U.button(withArg(IDS.REVIEW_PAGE, `${lawyer.id}.${current + 1}`), 'Next', STYLE.SECONDARY, {
        disabled: current >= pages - 1,
      }),
      U.button(withArg(IDS.REVIEW_LEAVE, lawyer.id), 'Leave a Review', STYLE.SECONDARY, {
        ...(U.parseEmoji(config.brand.starEmoji) ? { emoji: U.parseEmoji(config.brand.starEmoji) } : {}),
        disabled: !canReview,
      }),
      U.button(IDS.REVIEW_BACK, 'Back', STYLE.SECONDARY),
    ),
  );

  if (!canReview) {
    inner.push(U.text('-# Only clients of this attorney can leave a review.'));
  }

  return {
    flags: V2,
    components: [U.containerWith(config.brand.reviewBanner, inner)],
    allowedMentions: { parse: [] },
  };
}

/* ══════════════════════════════════════════════════════════════
   Lawyer requests
   ══════════════════════════════════════════════════════════════ */

/** Posted in the case channel, addressed to the party who needs counsel. */
function lawyerRequestNotice(forUserId, acceptedBy = null) {
  const inner = [
    U.text(
      `${U.title('Request a Lawyer')}\n` +
        `Hello <@${forUserId}> the clerk of your case has requested an attorney for you. Your ` +
        'attorney will represent you in this matter. In a civil suit they are entitled from ' +
        '10-25% of your winnings. ',
    ),
  ];
  if (acceptedBy) {
    inner.push(U.sep(1), U.text(`> <@${acceptedBy}> has accepted and will represent you.`));
  }

  return {
    flags: V2,
    components: [U.containerWith(config.brand.requestBanner, inner)],
    allowedMentions: U.mentions([forUserId, acceptedBy]),
  };
}

const KIND_LABEL = {
  person: 'civil suit',
  department: 'government suit',
  criminal: 'criminal case',
};

/** Broadcast to the attorney channel with an Accept button. */
function lawyerRequestBroadcast(c, requestId, forUserId, details, acceptedBy = null) {
  const inner = [
    U.text(
      `${U.title('Request a Lawyer')}\n` +
        `<@&${config.roles.lawyer}> a lawyer has been requested in a ${KIND_LABEL[c.kind] ?? 'case'}. \n\n` +
        `Details:\n\n${fmt.clean(details, 900)}`,
    ),
    U.sep(2),
    U.row(
      U.button(
        withArg(IDS.LAWYER_ACCEPT, requestId),
        acceptedBy ? 'Accepted' : 'Accept',
        STYLE.SECONDARY,
        acceptedBy ? { disabled: true } : {},
      ),
    ),
  ];

  if (acceptedBy) inner.push(U.text(`-# Taken by <@${acceptedBy}> · ${fmt.timestamp()}`));

  return {
    flags: V2,
    components: [U.containerWith(config.brand.requestBanner, inner)],
    allowedMentions: U.mentions([acceptedBy], [config.roles.lawyer]),
  };
}

/* ══════════════════════════════════════════════════════════════
   /request — summon someone to the courtroom
   ══════════════════════════════════════════════════════════════ */

function presenceRequestDM(forUserId, requesterId) {
  const where = config.channels.courtVoice
    ? `<#${config.channels.courtVoice}>`
    : 'the court voice channel';

  return {
    flags: V2,
    components: [
      U.bareContainer([
        U.bannerOf(config.brand.requestBanner),
        U.text(
          `Dear <@${forUserId}>,\n` +
            `Your pressence has been requested by <@${requesterId}>. Please join ${where} as soon ` +
            'as possible. ',
        ),
        U.bannerOf(config.brand.footer),
      ]),
    ],
    allowedMentions: U.mentions([forUserId, requesterId]),
  };
}

module.exports = {
  ephemeral,
  firstLetter,
  reviewPanel,
  lawyerProfile,
  lawyerRequestNotice,
  lawyerRequestBroadcast,
  presenceRequestDM,
  splitRoll,
  REVIEWS_PER_PAGE,
};
