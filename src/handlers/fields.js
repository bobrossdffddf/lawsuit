'use strict';

/**
 * Safe accessors for modal fields. discord.js throws when a field is absent
 * (which happens legitimately for optional inputs the user left blank), so
 * every getter here degrades to a sensible empty value instead.
 */

function textOf(interaction, customId, fallback = '') {
  try {
    return interaction.fields.getTextInputValue(customId) ?? fallback;
  } catch {
    return fallback;
  }
}

function stringSelectOf(interaction, customId, fallback = '') {
  try {
    const values = interaction.fields.getStringSelectValues(customId);
    return values?.[0] ?? fallback;
  } catch {
    return fallback;
  }
}

function userIdOf(interaction, customId) {
  try {
    const users = interaction.fields.getSelectedUsers(customId, false);
    return users?.first()?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * @returns {Array<{url: string, filename: string, content_type?: string, size?: number}>}
 */
function filesOf(interaction, customId) {
  let collection;
  try {
    collection = interaction.fields.getUploadedFiles(customId, false);
  } catch {
    return [];
  }
  if (!collection) return [];

  return [...collection.values()].map((a) => ({
    url: a.url,
    filename: a.name ?? 'upload',
    content_type: a.contentType ?? null,
    size: a.size ?? null,
  }));
}

module.exports = { textOf, stringSelectOf, userIdOf, filesOf };
