'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');

const config = require('../config');
const { pdfToImages } = require('./pdf');

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const PDF_EXT = /\.pdf$/i;
const MAX_GALLERY_ITEMS = 10;
// Discord allows at most 10 files on a single message.
const MAX_ATTACHMENTS = 10;
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
 * Downloads everything a party uploaded and archives it under
 * `data/cases/<case number>/<stage>/`. The bot keeps only one live message per
 * case channel, so Discord's copy of a file is transient — this on-disk archive
 * is the permanent record, and every later message is rebuilt from it.
 *
 * @param {Array<{url: string, filename: string, content_type?: string, size?: number}>} uploads
 * @param {string} caseNumber
 * @param {string} stage
 * @returns {Promise<Array<{localPath, filename, content_type, size, url}>>}
 */
async function archiveUploads(uploads, caseNumber, stage) {
  if (!uploads?.length) return [];

  const dir = path.join(config.caseFilesDir, safeName(caseNumber), safeName(stage));
  await fs.mkdir(dir, { recursive: true });

  const stamp = Date.now();
  const saved = [];

  for (const [i, f] of uploads.entries()) {
    const filename = safeName(f.filename, `evidence-${i + 1}`);
    const localPath = path.join(dir, `${stamp}-${i + 1}-${filename}`);
    try {
      const buf = await download(f.url);
      await fs.writeFile(localPath, buf);
      saved.push({
        localPath,
        filename,
        content_type: f.content_type ?? null,
        size: buf.length,
        url: f.url,
      });
    } catch (err) {
      console.error(`[media] could not archive ${filename}:`, err.message);
      // Keep the record even if the download failed, so the link is not lost.
      saved.push({
        localPath: null,
        filename,
        content_type: f.content_type ?? null,
        size: f.size ?? null,
        url: f.url,
      });
    }
  }

  return saved;
}

async function readRecord(rec) {
  if (rec.localPath || rec.local_path) {
    return fs.readFile(rec.localPath ?? rec.local_path);
  }
  if (rec.url) return download(rec.url);
  throw new Error('no source for file');
}

/**
 * Turns archived files into things a Components V2 message can show.
 *
 * - images        -> media gallery items
 * - PDFs          -> rendered to PNG pages for the gallery, plus the original
 *                    PDF as a File component
 * - anything else -> File component
 *
 * Honours Discord's 10-attachment and per-message byte limits; anything that
 * does not fit is reported in `overflow` (it is still safe on disk).
 *
 * @param {Array<object>} records rows from archiveUploads() or submission_files
 * @param {string} prefix short label used to build attachment names
 */
async function buildMedia(records, prefix) {
  const attachments = [];
  const galleryItems = [];
  const fileComponents = [];
  const overflow = [];
  let totalBytes = 0;

  /** Adds one file if there is room under both Discord limits. */
  const attach = (name, data, overflowName) => {
    if (attachments.length >= MAX_ATTACHMENTS || totalBytes + data.length > MAX_TOTAL_BYTES) {
      if (overflowName) overflow.push(overflowName);
      return null;
    }
    attachments.push(new AttachmentBuilder(data, { name }));
    totalBytes += data.length;
    return name;
  };

  let n = 0;
  for (const rec of records ?? []) {
    n += 1;
    const original = safeName(rec.filename, `evidence-${n}`);
    const label = safeName(`${prefix}-${n}`);
    const type = rec.content_type || '';

    let buf;
    try {
      buf = await readRecord(rec);
    } catch (err) {
      console.error(`[media] could not read ${original}:`, err.message);
      overflow.push(original);
      continue;
    }

    if (IMAGE_EXT.test(original) || type.startsWith('image/')) {
      const name = attach(safeName(`${label}-${original}`), buf, original);
      if (name && galleryItems.length < MAX_GALLERY_ITEMS) {
        galleryItems.push({ media: { url: `attachment://${name}` }, description: original });
      }
      continue;
    }

    if (PDF_EXT.test(original) || type === 'application/pdf') {
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
      const pdfName = attach(safeName(`${label}-${original}`), buf, original);
      if (pdfName) fileComponents.push({ type: 13, file: { url: `attachment://${pdfName}` } });
      continue;
    }

    // Video, audio, archives, everything else.
    const name = attach(safeName(`${label}-${original}`), buf, original);
    if (name) fileComponents.push({ type: 13, file: { url: `attachment://${name}` } });
  }

  return { attachments, galleryItems, fileComponents, overflow };
}

const EMPTY_MEDIA = { attachments: [], galleryItems: [], fileComponents: [], overflow: [] };

module.exports = { archiveUploads, buildMedia, safeName, EMPTY_MEDIA, MAX_GALLERY_ITEMS };
