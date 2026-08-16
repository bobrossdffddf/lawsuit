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
  // Permanent on-disk copy of every file filed with the court.
  caseFilesDir: path.join(ROOT, 'data', 'cases'),

  token: req('DISCORD_TOKEN'),
  clientId: req('CLIENT_ID'),
  guildId: req('GUILD_ID'),

  roles: {
    clerk: req('CLERK_ROLE_ID'),
    judge: req('JUDGE_ROLE_ID'),
    lawyer: opt('LAWYER_ROLE_ID'),
    panelManager: opt('PANEL_MANAGER_ROLE_ID'),
  },

  // Server administrators normally bypass every role gate. Set this to `true`
  // only if you want that back — the court decisions (open/deny a case,
  // approve a filing) are deliberately clerk-role-only.
  adminOverride: opt('ADMIN_OVERRIDE', 'false').toLowerCase() === 'true',

  channels: {
    civilCategory: req('CIVIL_CASE_CATEGORY_ID'),
    criminalCategory: opt('CRIMINAL_CASE_CATEGORY_ID') || opt('CIVIL_CASE_CATEGORY_ID'),
    lawyerRequests: opt('LAWYER_REQUEST_CHANNEL_ID'),
    courtVoice: opt('COURT_VOICE_CHANNEL_ID'),
    support: opt('SUPPORT_CHANNEL_ID'),
    log: opt('LOG_CHANNEL_ID'),
    welcome: opt('WELCOME_CHANNEL_ID'),
  },

  brand: {
    banner: opt('BANNER_URL', 'https://i.postimg.cc/43Cv9R3V/flgovlawsuits.webp'),
    footer: opt('FOOTER_URL', 'https://i.postimg.cc/5tc5CWtT/flgov-footer.webp'),
    seal: opt('SEAL_EMOJI', '<:unknown:1536074768187654245>'),
    welcomeEmoji: opt('WELCOME_EMOJI', '<:unknown:1526363469086064723>'),
    // Request-a-lawyer / summon-to-court messages use their own banner.
    requestBanner: opt('REQUEST_BANNER_URL', 'https://i.postimg.cc/B6C4GGzS/image-(2).webp'),
    // The lawyer review panel has its own banner and heading emoji.
    reviewBanner: opt('REVIEW_BANNER_URL', 'https://i.postimg.cc/SsGkppPX/image-(3).webp'),
    reviewEmoji: opt('REVIEW_EMOJI', '<:unknown:1526363454104010902>'),
    starEmoji: opt('STAR_EMOJI', '<:unknown:1538411573985411072>'),
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
/**
 * The Clearwater County form library. `name` is what Discord shows AND what
 * `attachment://` must match, so these filenames are already sanitised — no
 * spaces, no characters Discord would rewrite.
 */
const form = (name, title, category) => ({
  name,
  title,
  category,
  file: path.join(config.formsDir, name),
});

config.forms = {
  // criminal
  CR01: form('CR-01_Arrest_Affidavit_and_Probable_Cause_Statement.pdf', "Arrest Affidavit and Probable Cause Statement", 'criminal'),
  CR02: form('CR-02_Notice_to_Appear.pdf', "Notice to Appear", 'criminal'),
  CR03: form('CR-03_Information-Formal_Charging_Document.pdf', "Information-Formal Charging Document", 'criminal'),
  CR04: form('CR-04_Arrest_Warrant_and_Application.pdf', "Arrest Warrant and Application", 'criminal'),
  CR05: form('CR-05_Search_Warrant_Application_and_Warrant.pdf', "Search Warrant Application and Warrant", 'criminal'),
  CR06: form('CR-06_Pretrial_Release_and_Bond_Order.pdf', "Pretrial Release and Bond Order", 'criminal'),
  CR07: form('CR-07_Plea_Agreement_and_Waiver_of_Rights.pdf', "Plea Agreement and Waiver of Rights", 'criminal'),
  CR08: form('CR-08_Notice_of_Appearance_of_Counsel.pdf', "Notice of Appearance of Counsel", 'criminal'),
  CR09: form('CR-09_Application_for_Court-Appointed_Counsel_and_Affidavit_of_Indigency.pdf', "Application for Court-Appointed Counsel and Affidavit of Indigency", 'criminal'),
  CR10: form('CR-10_Judgment_and_Sentence.pdf', "Judgment and Sentence", 'criminal'),
  CR11: form('CR-11_Order_of_Probation_and_Violation_Report.pdf', "Order of Probation and Violation Report", 'criminal'),
  CR12: form('CR-12_Motion_to_Suppress_Evidence.pdf', "Motion to Suppress Evidence", 'criminal'),

  // civil
  CV01: form('CV-01_Civil_Complaint.pdf', "Civil Complaint", 'civil'),
  CV02: form('CV-02_Summons.pdf', "Summons", 'civil'),
  CV03: form('CV-03_Answer_and_Affirmative_Defenses.pdf', "Answer and Affirmative Defenses", 'civil'),
  CV04: form('CV-04_Notice_of_Claim_Against_a_Government_Entity.pdf', "Notice of Claim Against a Government Entity", 'civil'),
  CV05: form('CV-05_Small_Claims_Statement_of_Claim.pdf', "Small Claims Statement of Claim", 'civil'),
  CV06: form('CV-06_Motion_to_Dismiss.pdf', "Motion to Dismiss", 'civil'),
  CV07: form('CV-07_Request_for_Production_of_Documents.pdf', "Request for Production of Documents", 'civil'),
  CV08: form('CV-08_Notice_of_Deposition.pdf', "Notice of Deposition", 'civil'),
  CV09: form('CV-09_Settlement_Agreement_and_Release_of_Claims.pdf', "Settlement Agreement and Release of Claims", 'civil'),
  CV10: form('CV-10_Final_Judgment-Civil.pdf', "Final Judgment-Civil", 'civil'),

  // traffic
  TR01: form('TR-01_Uniform_Traffic_Citation.pdf', "Uniform Traffic Citation", 'traffic'),
  TR02: form('TR-02_Election_of_Options-Response_to_Citation.pdf', "Election of Options-Response to Citation", 'traffic'),
  TR03: form('TR-03_Affidavit_of_Compliance-Correctable_Violation.pdf', "Affidavit of Compliance-Correctable Violation", 'traffic'),
  TR04: form('TR-04_Request_for_Traffic_Hearing.pdf', "Request for Traffic Hearing", 'traffic'),
  TR05: form('TR-05_Driver_License_Suspension_and_Reinstatement_Order.pdf', "Driver License Suspension and Reinstatement Order", 'traffic'),

  // general
  GN01: form('GN-01_General_Motion.pdf', "General Motion", 'general'),
  GN02: form('GN-02_Notice_of_Hearing.pdf', "Notice of Hearing", 'general'),
  GN03: form('GN-03_Subpoena.pdf', "Subpoena", 'general'),
  GN04: form('GN-04_Witness_List_and_Exhibit_List.pdf', "Witness List and Exhibit List", 'general'),
  GN05: form('GN-05_Filing_Cover_Sheet_and_Certificate_of_Service.pdf', "Filing Cover Sheet and Certificate of Service", 'general'),
  GN06: form('GN-06_Motion_for_Continuance.pdf', "Motion for Continuance", 'general'),

  // admin
  AD01: form('AD-01_Civil_Cover_Sheet.pdf', "Civil Cover Sheet", 'admin'),
  AD02: form('AD-02_Notice_of_Appeal.pdf', "Notice of Appeal", 'admin'),
  AD03: form('AD-03_Public_Records_Request.pdf', "Public Records Request", 'admin'),
  AD04: form('AD-04_Application_for_Admission_to_the_Clearwater_County_Bar.pdf', "Application for Admission to the Clearwater County Bar", 'admin'),
  AD05: form('AD-05_Internal_Affairs_Complaint.pdf', "Internal Affairs Complaint", 'admin'),
  AD06: form('AD-06_Petition_to_Seal_or_Expunge_a_Criminal_Record.pdf', "Petition to Seal or Expunge a Criminal Record", 'admin'),
  AD07: form('AD-07_Request_for_Transcript_and_Record_on_Appeal.pdf', "Request for Transcript and Record on Appeal", 'admin'),
  AD08: form('AD-08_Jury_Summons_and_Juror_Questionnaire.pdf', "Jury Summons and Juror Questionnaire", 'admin'),

  // appeals
  AP01: form('AP-01_Notice_of_Appeal_of_Sentence.pdf', "Notice of Appeal of Sentence", 'appeals'),
  AP02: form('AP-02_Notice_of_Appeal_to_the_Supreme_Court.pdf', "Notice of Appeal to the Supreme Court", 'appeals'),
  AP03: form('AP-03_Appellate_Brief.pdf', "Appellate Brief", 'appeals'),
  JR01: form('JR-01_Judicial_Ruling_and_Order.pdf', "Judicial Ruling and Order", 'appeals'),
};

/** Every form in one category, e.g. formsIn('criminal'). */
config.formsIn = (category) =>
  Object.entries(config.forms)
    .filter(([, f]) => f.category === category)
    .map(([key]) => key);

/** Forms missing from assets/forms/ — checked at boot so a 400 never surprises you. */
config.missingForms = () =>
  Object.entries(config.forms)
    .filter(([, f]) => !require('node:fs').existsSync(f.file))
    .map(([key, f]) => `${key} (${f.name})`);

module.exports = config;
