'use strict';

const fs = require('node:fs');
const { MessageFlags, AttachmentBuilder } = require('discord.js');
const config = require('../config');

const V2 = MessageFlags.IsComponentsV2;

/** Component type ids, named for readability. */
const T = {
  ACTION_ROW: 1,
  BUTTON: 2,
  TEXT_INPUT: 4,
  USER_SELECT: 5,
  STRING_SELECT: 3,
  SECTION: 9,
  TEXT: 10,
  THUMBNAIL: 11,
  GALLERY: 12,
  FILE: 13,
  SEPARATOR: 14,
  CONTAINER: 17,
  LABEL: 18,
  FILE_UPLOAD: 19,
  RADIO_GROUP: 21,
  CHECKBOX_GROUP: 22,
  CHECKBOX: 23,
};

const STYLE = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5 };

const banner = () => ({ type: T.GALLERY, items: [{ media: { url: config.brand.banner } }] });
const bannerOf = (url) => ({ type: T.GALLERY, items: [{ media: { url } }] });
const footer = () => ({ type: T.GALLERY, items: [{ media: { url: config.brand.footer } }] });
const text = (content) => ({ type: T.TEXT, content });
const sep = (spacing = 2) => ({ type: T.SEPARATOR, spacing });
const row = (...components) => ({ type: T.ACTION_ROW, components: components.filter(Boolean) });

const button = (custom_id, label, style = STYLE.SECONDARY, extra = {}) => ({
  type: T.BUTTON,
  style,
  label,
  custom_id,
  ...extra,
});

/** A disabled button used purely as a "1/3" progress pill. */
const pill = (label, idx) => ({
  type: T.BUTTON,
  style: STYLE.SECONDARY,
  label,
  disabled: true,
  custom_id: `pill:${idx}:${label}`,
});

const fileRef = (name) => ({ type: T.FILE, file: { url: `attachment://${name}` } });

/** Standard court container: banner, body, footer. No accent bar — Discord's
 *  default sidebar colour, matching the original panel designs. */
function container(bodyComponents) {
  return {
    type: T.CONTAINER,
    components: [banner(), ...bodyComponents.filter(Boolean), sep(2), footer()],
  };
}

/** Same shape, but with a different header image (requests, reviews). */
function containerWith(url, bodyComponents) {
  return {
    type: T.CONTAINER,
    components: [bannerOf(url), ...bodyComponents.filter(Boolean), sep(2), footer()],
  };
}

/** Title line using a specific emoji instead of the court seal. */
const titleWith = (emoji, line) => `# ${emoji} ${line}`;

/**
 * `<:name:123>` / `<a:name:123>` -> the object a button's `emoji` field wants.
 * A plain unicode emoji comes back as `{ name }`. Anything else -> undefined,
 * so the button simply renders without an icon instead of erroring.
 */
function parseEmoji(raw) {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  const m = s.match(/^<(a)?:([\w~]+):(\d+)>$/);
  if (m) return { id: m[3], name: m[2], animated: Boolean(m[1]) };
  if (/^<|>$/.test(s)) return undefined;
  return { name: s };
}

/** Container without the trailing separator+footer pair already applied. */
function bareContainer(bodyComponents) {
  return {
    type: T.CONTAINER,
    components: bodyComponents.filter(Boolean),
  };
}

/** Title line with the court seal emoji. */
const title = (line) => `# ${config.brand.seal} ${line}`;

/** `#1234567890` -> a clickable channel mention, or empty string if unset. */
const channelRef = (id) => (id ? `<#${id}>` : 'the support channel');

/** Loads a court form off disk as an attachment named exactly for `attachment://`. */
const formAttachment = (key) =>
  new AttachmentBuilder(config.forms[key].file, { name: config.forms[key].name });

const formName = (key) => config.forms[key].name;

/** True when the PDF actually exists in assets/forms/. */
const hasForm = (key) => Boolean(config.forms[key]) && fs.existsSync(config.forms[key].file);

/** Only the forms that are really on disk — safe to hand to `files:`. */
const formAttachments = (keys) => keys.filter(hasForm).map(formAttachment);

/**
 * A File component for a court form, or a plain note if that PDF has not been
 * added to assets/forms/ yet. Referencing a missing attachment makes Discord
 * reject the whole message, so this degrades instead of breaking the flow.
 */
const formRef = (key) =>
  hasForm(key)
    ? fileRef(formName(key))
    : text(`-# \`${formName(key)}\` has not been uploaded to the bot yet — ask a clerk for it.`);

/**
 * Standard mention permissions: allow pinging the specific users/roles we
 * name, never @everyone.
 */
// Duplicate ids make Discord reject the whole message with
// allowed_mentions[SET_TYPE_ALREADY_CONTAINS_VALUE], so always de-dupe.
const mentions = (users = [], roles = []) => ({
  parse: [],
  users: [...new Set(users.filter(Boolean))],
  roles: [...new Set(roles.filter(Boolean))],
});

module.exports = {
  V2,
  T,
  STYLE,
  banner,
  bannerOf,
  containerWith,
  titleWith,
  parseEmoji,
  footer,
  text,
  sep,
  row,
  button,
  pill,
  fileRef,
  container,
  bareContainer,
  title,
  channelRef,
  formAttachment,
  formAttachments,
  formName,
  formRef,
  hasForm,
  mentions,
};
