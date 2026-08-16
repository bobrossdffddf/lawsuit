'use strict';

const config = require('../config');
const store = require('../db');

/** Two-digit year used in case numbers, e.g. "26". */
function caseYear() {
  if (config.caseYearOverride) return config.caseYearOverride.slice(-2).padStart(2, '0');
  return String(new Date().getFullYear()).slice(-2);
}

/** Civil suits and government claims share the CC docket; criminal has its own. */
const DOCKET_CODE = { person: 'CC', department: 'CC', criminal: 'CR' };

/**
 * Allocates the next case number for the current year.
 * @param {string} kind 'person' | 'department' | 'criminal'
 * @returns {{ caseNumber: string, year: string, seq: number }}
 */
function allocateCaseNumber(kind = 'person') {
  const year = caseYear();
  const code = DOCKET_CODE[kind] ?? 'CC';
  const seq = store.nextSeq(`case:${code}:${year}`);
  return { caseNumber: `${year}-${code}-${String(seq).padStart(6, '0')}`, year, seq };
}

/** A -> B -> ... -> Z -> AA -> AB. `n` is 1-based. */
function exhibitLetter(n) {
  let out = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

const URL_RE = /https?:\/\/[^\s<>()]+/gi;

/**
 * Turns a blob of pasted links into hyperlinked markdown, one per line.
 * Non-URL text is preserved as-is so nothing the filer typed is lost.
 */
function hyperlink(raw) {
  const text = (raw || '').trim();
  if (!text) return '*None provided*';

  const parts = text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lines = parts.map((part) => {
    const urls = part.match(URL_RE);
    if (!urls) return part;
    if (urls.length === 1 && urls[0] === part) {
      let host;
      try {
        host = new URL(part).hostname.replace(/^www\./, '');
      } catch {
        host = 'link';
      }
      return `[${host}](${part})`;
    }
    return part.replace(URL_RE, (u) => `<${u}>`);
  });

  return truncate(lines.join('\n'), 900);
}

/** Discord hard-caps Text Display at 4000 chars; we stay well under. */
function truncate(text, max = 1500) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Escapes markdown so user input can't break the layout. */
function clean(text, max = 1200) {
  return truncate(String(text ?? '').replace(/```/g, "'''"), max);
}

/** `<t:1700000000:F>` — renders in each viewer's own timezone. */
const timestamp = (ms = Date.now(), style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;

module.exports = { caseYear, allocateCaseNumber, DOCKET_CODE, exhibitLetter, hyperlink, truncate, clean, timestamp };
