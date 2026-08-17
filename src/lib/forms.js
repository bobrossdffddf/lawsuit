'use strict';

const fs = require('node:fs/promises');
const { AttachmentBuilder } = require('discord.js');
const { PDFDocument, PDFName, PDFBool } = require('pdf-lib');

const config = require('../config');

/**
 * The Clearwater forms share field names — `case_number`, `defendant`,
 * `username`, `bar_no` and so on appear across dozens of them. That lets the
 * bot keep one profile of answers per case: it harvests whatever a party types
 * into a filed PDF, and pre-fills the same boxes on every form it hands out
 * afterwards, so nobody retypes their case number five times.
 *
 * These are the fields that must NEVER be copied forward — signature blocks,
 * anything a judge or clerk fills in, and scheduling the court sets.
 */
const NEVER_CARRY = [
  /_(sig|print)$/i, // signature and printed-name lines
  /_date$/i, // the date line under a signature
  /^(granted|denied)$/i, // judicial disposition checkboxes
  /^(hearing_set|hearing_date|next_court_date|courtroom|time(_\d+)?)$/i,
  /^(receipt_no|filing_fee|court_costs|points_assessed|probation_term|community_service_hours)$/i,
  /^(order|ruling|disposition|verdict|sentence)/i,
];

const carryable = (name) => !NEVER_CARRY.some((re) => re.test(name));

/** Keeps a profile from growing without bound if someone pastes an essay. */
const MAX_VALUE = 800;
/** And from being flooded by a crafted form with thousands of boxes. */
const MAX_FIELDS = 250;
/**
 * pdf-lib parses synchronously, so a very large upload would block the whole
 * bot — every other button press in that window would blow its 3-second ack
 * window. Bigger files are archived and served, just not mined for answers.
 */
const MAX_PARSE_BYTES = 6 * 1024 * 1024;

/* ── reading ─────────────────────────────────────────────────── */

/**
 * Pulls every non-empty, carry-forward field out of a filled PDF.
 * @param {Buffer} buffer
 * @returns {Promise<Record<string,string>>}
 */
async function readFilledFields(buffer) {
  const out = {};
  if (!buffer || buffer.length > MAX_PARSE_BYTES) return out;

  let doc;
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return out; // not a PDF, or not one we can parse
  }

  let fields;
  try {
    fields = doc.getForm().getFields();
  } catch {
    return out;
  }

  for (const field of fields) {
    const name = field.getName();
    if (!carryable(name)) continue;
    try {
      // Text fields are the only ones worth carrying; checkboxes and radios are
      // form-specific and copying them would put words in someone's mouth.
      if (typeof field.getText !== 'function') continue;
      const value = (field.getText() ?? '').trim();
      if (value) out[name] = value.slice(0, MAX_VALUE);
      if (Object.keys(out).length >= MAX_FIELDS) break;
    } catch {
      /* malformed field — skip it */
    }
  }
  return out;
}

/* ── writing ─────────────────────────────────────────────────── */

/**
 * Returns a copy of a court form with every field the profile knows about
 * already filled in.
 * @param {string} key   a key from config.forms, e.g. 'CV02'
 * @param {Record<string,string>} values
 */
async function fillForm(key, values) {
  const spec = config.forms[key];
  if (!spec) throw new Error(`unknown form ${key}`);

  const raw = await fs.readFile(spec.file);
  if (!values || !Object.keys(values).length) return raw;

  try {
    const doc = await PDFDocument.load(raw, { updateMetadata: false });
    const form = doc.getForm();

    let filled = 0;
    for (const [name, value] of Object.entries(values)) {
      if (!value) continue;
      try {
        const field = form.getTextField(name);
        field.setText(String(value));
        filled += 1;
      } catch {
        /* this form does not have that box — perfectly normal */
      }
    }
    if (!filled) return raw;

    // Viewers draw the text themselves, using each widget's own /DA.
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);

    // updateFieldAppearances MUST stay false. The forms' AcroForm default is
    // `/Helv 0 Tf` — 0 means auto-size — so letting pdf-lib bake appearance
    // streams makes it recompute a size per box to fill the height. That is
    // what turned 8pt fields into 10pt, 15pt and one at 51pt.
    return Buffer.from(await doc.save({ updateFieldAppearances: false }));
  } catch (err) {
    console.error(`[forms] could not pre-fill ${spec.name}:`, err.message);
    return raw;
  }
}

/**
 * Discord attachments for a set of forms, pre-filled from a case profile.
 * Falls back to the blank form on any failure, so a bad profile can never stop
 * a case from moving.
 */
async function attachmentsFor(keys, values) {
  const out = [];
  for (const key of keys ?? []) {
    const spec = config.forms[key];
    if (!spec) continue;
    try {
      out.push(new AttachmentBuilder(await fillForm(key, values), { name: spec.name }));
    } catch (err) {
      console.error(`[forms] falling back to the blank ${key}:`, err.message);
    }
  }
  return out;
}

module.exports = { readFilledFields, fillForm, attachmentsFor, carryable, NEVER_CARRY };
