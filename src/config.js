'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function req(key) {
  const v = (process.env[key] || '').trim();
  if (!v) {
    console.error(`[config] Missing required environment variable: ${key}`);
    console.error('         Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  return v;
}

function opt(key, fallback = '') {
  const v = (process.env[key] || '').trim();
  return v || fallback;
}

function int(key, fallback) {
  const v = parseInt((process.env[key] || '').trim(), 10);
  return Number.isFinite(v) ? v : fallback;
}

const ROOT = path.join(__dirname, '..');

const config = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  formsDir: path.join(ROOT, 'assets', 'forms'),
  tmpDir: path.join(ROOT, 'data', 'tmp'),
  dbPath: path.join(ROOT, 'data', 'court.db'),

  token: req('DISCORD_TOKEN'),
  clientId: req('CLIENT_ID'),
  guildId: req('GUILD_ID'),

  roles: {
    clerk: req('CLERK_ROLE_ID'),
    judge: req('JUDGE_ROLE_ID'),
    panelManager: opt('PANEL_MANAGER_ROLE_ID'),
  },

  channels: {
    civilCategory: req('CIVIL_CASE_CATEGORY_ID'),
    support: opt('SUPPORT_CHANNEL_ID'),
    log: opt('LOG_CHANNEL_ID'),
    welcome: opt('WELCOME_CHANNEL_ID'),
  },

  brand: {
    banner: opt('BANNER_URL', 'https://i.postimg.cc/43Cv9R3V/flgovlawsuits.webp'),
    footer: opt('FOOTER_URL', 'https://i.postimg.cc/5tc5CWtT/flgov-footer.webp'),
    seal: opt('SEAL_EMOJI', '<:unknown:1536074768187654245>'),
    accent: parseInt(opt('ACCENT_COLOR', 'B3995D'), 16),
  },

  prefix: opt('PREFIX', '$'),
  caseYearOverride: opt('CASE_YEAR_OVERRIDE'),
  pdf: {
    dpi: int('PDF_RENDER_DPI', 110),
    maxPages: int('PDF_MAX_PAGES', 10),
  },
  deniedCaseAction: opt('DENIED_CASE_ACTION', 'lock'),
  deleteDelaySeconds: int('DELETE_DELAY_SECONDS', 60),

  departments: opt('DEPARTMENTS', 'Office of the Governor')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, 25),
};

// Court forms. `name` is what Discord will show and what `attachment://` must match.
config.forms = {
  CV01: { name: 'CV-01_Civil_Complaint.pdf', file: path.join(config.formsDir, 'CV-01_Civil_Complaint.pdf') },
  CV02: { name: 'CV-02_Summons.pdf', file: path.join(config.formsDir, 'CV-02_Summons.pdf') },
  CV03: { name: 'CV-03_Answer_and_Affirmative_Defenses.pdf', file: path.join(config.formsDir, 'CV-03_Answer_and_Affirmative_Defenses.pdf') },
  CV05: { name: 'CV-05_Small_Claims_Statement_of_Claim.pdf', file: path.join(config.formsDir, 'CV-05_Small_Claims_Statement_of_Claim.pdf') },
};

module.exports = config;
