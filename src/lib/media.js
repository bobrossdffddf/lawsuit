'use strict';

const { AttachmentBuilder } = require('discord.js');
const { pdfToImages } = require('./pdf');

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const PDF_EXT = /\.pdf$/i;
const MAX_GALLERY_ITEMS = 10;
// Discord allows at most 10 files on a single message.
const MAX_ATTACHMENTS = 10;
// Per-file ceiling. Anything bigger stays as a plain link.
const MAX_REUPLOAD_BYTES = 8 * 1024 * 1024;
// Per-message ceiling for an unboosted guild (10 MB), with headroom.
const MAX_TOTAL_BYTES = 9 * 1024 * 1024;

/** Discord rejects attachment names with characters outside this set. */
function safeName(name, fallback = 'file') {
  const cleaned = String(name || fallback)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(-90);
  return cleaned || fallback;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Turns a set of user-uploaded files into things a Components V2 message can show.
 *
 * - images        -> media gallery items
 * - PDFs          -> rendered to PNG pages, then media gallery items
 *                    (the original PDF is re-attached as a File component too)
 * - anything else -> File component, or a plain link if it is too large to re-upload
 *
 * @param {Array<{url: string, filename: string, content_type?: string, size?: number}>} files
 * @param {string} prefix short label used to build attachment names, e.g. "26-CC-000001-s1"
 */
async function buildMedia(files, prefix) {
  const attachments = [];
  const galleryItems = [];
  const fileComponents = [];
  const overflowLinks = [];
  let totalBytes = 0;

  /**
   * Adds one file to the outgoing message if there is room for it under both
   * Discord's 10-attachment cap and the per-message byte budget. Returns the
   * attachment name on success, or null if it had to be left behind.
   */
  const attach = (name, data, linkName, linkUrl) => {
    if (attachments.length >= MAX_ATTACHMENTS || totalBytes + data.length > MAX_TOTAL_BYTES) {
      if (linkUrl) overflowLinks.push({ name: linkName, url: linkUrl });
      return null;
    }
    attachments.push(new AttachmentBuilder(data, { name }));
    totalBytes += data.length;
    return name;
  };

  let n = 0;
  for (const f of files) {
    n += 1;
    const original = safeName(f.filename, `evidence-${n}`);
    const label = safeName(`${prefix}-${n}`);

    // Too big to bring across — keep a link so nothing is silently lost.
    if (f.size && f.size > MAX_REUPLOAD_BYTES) {
      overflowLinks.push({ name: original, url: f.url });
      continue;
    }

    let buf;
    try {
      buf = await download(f.url);
    } catch (err) {
      console.error(`[media] could not download ${original}:`, err.message);
      overflowLinks.push({ name: original, url: f.url });
      continue;
    }

    if (buf.length > MAX_REUPLOAD_BYTES) {
      overflowLinks.push({ name: original, url: f.url });
      continue;
    }

    if (IMAGE_EXT.test(original) || (f.content_type || '').startsWith('image/')) {
      const name = attach(safeName(`${label}-${original}`), buf, original, f.url);
      if (name && galleryItems.length < MAX_GALLERY_ITEMS) {
        galleryItems.push({ media: { url: `attachment://${name}` }, description: original });
      }
      continue;
    }

    if (PDF_EXT.test(original) || (f.content_type || '') === 'application/pdf') {
      // Reserve one attachment slot for the original PDF itself.
      const previewBudget = Math.min(
        MAX_GALLERY_ITEMS - galleryItems.length,
        Math.max(0, MAX_ATTACHMENTS - attachments.length - 1),
      );
      const pages = previewBudget > 0 ? await pdfToImages(buf, label, previewBudget) : [];
      for (const page of pages) {
        const name = attach(safeName(page.name), page.data);
        if (name && galleryItems.length < MAX_GALLERY_ITEMS) {
          galleryItems.push({ media: { url: `attachment://${name}` }, description: original });
        }
      }
      // Always try to keep the real PDF downloadable alongside the preview.
      const pdfName = attach(safeName(`${label}-${original}`), buf, original, f.url);
      if (pdfName) fileComponents.push({ type: 13, file: { url: `attachment://${pdfName}` } });
      continue;
    }

    // Video, audio, archives, everything else.
    const name = attach(safeName(`${label}-${original}`), buf, original, f.url);
    if (name) fileComponents.push({ type: 13, file: { url: `attachment://${name}` } });
  }

  return { attachments, galleryItems, fileComponents, overflowLinks };
}

module.exports = { buildMedia, safeName, MAX_GALLERY_ITEMS };
