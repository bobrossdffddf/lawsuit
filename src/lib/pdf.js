'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const config = require('../config');

let popplerChecked = false;
let popplerAvailable = false;

/** True if poppler-utils (`pdftoppm`) is installed on this host. */
async function hasPoppler() {
  if (popplerChecked) return popplerAvailable;
  popplerChecked = true;
  try {
    await execFileAsync('pdftoppm', ['-v']);
    popplerAvailable = true;
  } catch {
    popplerAvailable = false;
    console.warn(
      '[pdf] pdftoppm not found — uploaded PDFs will be attached as files instead of ' +
        'rendered previews. Install with: apt install -y poppler-utils',
    );
  }
  return popplerAvailable;
}

/**
 * Renders a PDF into PNG page images.
 * @param {Buffer} buffer raw PDF bytes
 * @param {string} label used to name the output files
 * @param {number} maxPages hard cap on pages rendered
 * @returns {Promise<Array<{name: string, data: Buffer}>>}
 */
async function pdfToImages(buffer, label, maxPages = config.pdf.maxPages) {
  if (!(await hasPoppler())) return [];

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flgov-pdf-'));
  const src = path.join(dir, 'in.pdf');

  try {
    await fs.writeFile(src, buffer);
    await execFileAsync(
      'pdftoppm',
      ['-png', '-r', String(config.pdf.dpi), '-f', '1', '-l', String(maxPages), src, path.join(dir, 'page')],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 64 },
    );

    const entries = (await fs.readdir(dir))
      .filter((f) => f.startsWith('page') && f.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const out = [];
    for (let i = 0; i < entries.length && i < maxPages; i += 1) {
      out.push({
        name: `${label}-p${i + 1}.png`,
        data: await fs.readFile(path.join(dir, entries[i])),
      });
    }
    return out;
  } catch (err) {
    console.error('[pdf] render failed:', err.message);
    return [];
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { pdfToImages, hasPoppler };
