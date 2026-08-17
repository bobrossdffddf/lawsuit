# FLGOV Judicial Branch Bot

Civil docket bot for the Clearwater / State of Florida roleplay server. It runs the
whole civil lawsuit pipeline inside Discord: intake, clerk review, complaint,
summons, service of process, the defendant's answer, docketing, and a discovery
thread that auto-letters every piece of evidence filed in it.

Built on **Discord Components V2** (containers, media galleries, file components,
label-wrapped modal inputs, and modal file uploads).

---

## What it does

### The public panel

A moderator runs `$lawsuits` (or `/panel`) in a public channel. The bot posts the
lawsuit panel with three buttons:

| Button | What happens |
|---|---|
| **File a Lawsuit** | Opens the Civil Lawsuit modal (defendant, reason, links, file evidence) |
| **Sue a Department** | Starts the private four-panel government-claim wizard (below) |
| **Active Civil Cases** | Private list of every open case, its stage, judge, and channel |
| **Contest a Criminal Charge** | Opens the criminal contest modal (charge, agency, citation, grounds, evidence) |

### One message per case channel

A case channel holds **exactly one bot message at a time**. Every step replaces
the previous one, so the channel always shows the current state and nothing
else. Because Discord's copy of a file disappears with the message it was on,
**every file filed with the court is archived to disk** under
`data/cases/<case number>/<stage>/` the moment it is uploaded — intake evidence,
every completed form, proof of service, and discovery exhibits. Nothing depends
on Discord CDN links, which expire.

### Suing a department

The **Sue a Department** button opens a private four-panel wizard that only the
filer can see. Each panel's Continue button is greyed out for five seconds and
counts down, so the rules actually get read:

```
1  the ground rules ($200k/$300k caps, employee immunity, riot exclusion)
2  the two recommended forms — AD-05 Internal Affairs, AD-03 Public Records
3  the mandatory CV-04 Notice of Claim  → Continue opens an upload modal (≤3 files)
4  claim details                        → Continue opens the details modal
   (department, employees involved, what happened, compensation, attorney)
```

Submitting the last modal creates the case channel with the uploaded package
already rendered for the clerk, plus the usual Open Case / Deny Case buttons.
The filer's attorney, if they named one, is added to the channel immediately.

```
intake   clerk presses Open Case or Deny Case
   ↓
notice   plaintiff serves CV-04 on the agency, then presses Next Step once the
   ↓     agency responds (no upload — the clerk assigns a judge from here)
filed    discovery thread opens
```

Cancel at any point discards everything; nothing is filed.

### Contesting a criminal charge

Filing creates `26-CR-000001` on its own docket, in `CRIMINAL_CASE_CATEGORY_ID`.
The pipeline mirrors the civil one exactly:

```
intake      clerk presses Open Case or Deny Case
   ↓
appearance  defendant files CR-08 (counsel) or CR-09 (appointed)   [1/3]
   ↓
motions     defendant files CR-12 (suppress) or GN-01 (general)    [2/3]
   ↓        → clerk approves AND assigns the prosecutor, who joins
prosecution prosecution files CR-03 Information                    [3/3]
   ↓
filed       discovery thread opens
```

The person contesting is the **defendant** — they are never asked who is
prosecuting them, because assigning the State is the court's job. Every label
comes from `PARTY_LABELS` in `src/stages.js`: a civil filer is the Plaintiff, a
government claimant is the Claimant, a criminal filer is the Defendant.

### Forms fill themselves in

Every form the bot hands out is pre-filled from a **case profile**. The profile
is seeded at filing with the case number, division, party names and agency, then
grows every time someone uploads a completed PDF — the bot reads their answers
back out and replays them into the next form. Nobody types their case number
twice.

Signature blocks, dated signature lines, judicial dispositions
(`granted`/`denied`) and anything the court schedules are **never** carried
forward — see `NEVER_CARRY` in `src/lib/forms.js`.

The shipped forms were also cleaned on install: the 100-character `/MaxLen` cap
was stripped from all 2,183 capped fields, and the sample data every form
shipped with ("Marcus D. Reeves", case `26-CC-000915`) was cleared, so litigants
get a genuine blank.

**Appearance streams are deliberately left to the viewer.** These forms set
`NeedAppearances` and use `/Helv 0 Tf` (auto-size) as the AcroForm default,
so anything that bakes appearance streams recomputes a font size per box to
fill its height — which turns an 8pt field into 51pt. `fillForm()` therefore
saves with `updateFieldAppearances: false`, and `npm run check` fails if any
field's `/DA` exceeds 12pt.

### Lawyers

`/review` opens a private panel listing everyone with `LAWYER_ROLE_ID`, split
A-M / N-Z by the first letter of their per-server name. Picking one shows their
profile — barred since, cases handled, average rating — and their reviews, five
to a page. **Only registered clients of that attorney can leave a review**;
everyone else sees the button greyed out.

A client relationship is created three ways: a clerk runs `/lawyeradd`, an
attorney accepts a `/lawreq`, or a filer names a bar-certified attorney in the
government-claim wizard.

`/lawreq @user` (clerks) posts a notice in the case channel and broadcasts to
`LAWYER_REQUEST_CHANNEL_ID` with an Accept button. The first attorney to press
it gets the case: the button greys out, they are added to the channel and the
discovery thread, and the in-channel notice updates to name them.

### The case pipeline

Filing creates a locked channel named `26-CC-000001` in the civil category
(`YY-CC-` + a six-digit counter that increments per case and resets each year).

```
intake     clerk presses Open Case or Deny Case
   ↓       (denied → the plaintiff gets a DM with the reason and may re-file)
complaint  plaintiff uploads CV-01 or CV-05          → clerk approves   [1/3]
   ↓
summons    plaintiff uploads the completed CV-02     → clerk approves   [2/3]
   ↓
service    plaintiff uploads proof of service +      → clerk approves   [2/3]
   ↓       the defendant's username and ID             and picks the defendant's
   ↓                                                   user, who is added to the case
answer     defendant uploads CV-03                   → clerk approves   [3/3]
   ↓
filed      "Lawsuit Filed", private discovery thread opens and is pinned
```

At every stage the "Next Step" button opens a modal, the upload goes to a clerk
review card, and the clerk can **Approve** (advance) or **Deny** (post the reason
and re-prompt the same step). Uploaded PDFs are rendered to page images and shown
inline in the review card so clerks never have to download anything.

Only the plaintiff can press Next Step on the complaint, summons and service
steps. Only the defendant can press it on the answer. Only clerks (and admins)
can approve or deny anything.

### Discovery

Any file dropped in the discovery thread is replied to with a
`Filed - Exhibit A` card and recorded in the database. Lettering runs
`A … Z, AA, AB, …` per case.

### Commands

| Command | Who | What |
|---|---|---|
| `$lawsuits` | Manage Server, or `PANEL_MANAGER_ROLE_ID` | Posts the public panel |
| `/add user:` | clerks & judges | Adds someone to the case channel and the discovery thread |
| `/addjudge` | clerks & judges | User-select modal, appoints the judge, posts the appointment notice |
| `/close` | clerks | Closes the case. Asks three times, then locks the channel and archives discovery |
| `/review` | anyone | Attorney directory, profiles and reviews |
| `/lawyeradd` | clerks | Registers a user as an attorney's client, so they can review them |
| `/lawreq user:` | clerks | Requests counsel for a party and broadcasts it to the bar |
| `/skip` | clerks | Skips the current step; any pending filing on it is closed out |
| `/remove user:` | clerks | Removes someone from the case and clears their role on it |
| `/request user:` | staff & attorneys | DMs someone asking them to join the court voice channel |

---

## Setup

### 1. Discord Developer Portal

1. Create the application and bot at <https://discord.com/developers/applications>.
2. Under **Bot → Privileged Gateway Intents**, turn ON:
   - **Message Content Intent** — required for `$lawsuits`
   - **Server Members Intent** — required for discovery invites and welcome messages
3. Under **OAuth2 → URL Generator**, tick `bot` and `applications.commands`, then
   give the bot: *Manage Channels, Manage Roles, Manage Messages, Manage Threads,
   View Channels, Send Messages, Send Messages in Threads, Create Private Threads,
   Embed Links, Attach Files, Read Message History*. Invite it with that URL.
4. **Drag the bot's role above the roles it manages** and make sure it can see the
   civil case category. Without Manage Channels + Manage Roles on that category
   the bot cannot create locked case channels.

### 2. Install on Proxmox

A Debian 12 or Ubuntu 24.04 LXC container with 1 vCPU / 1 GB RAM is plenty.

```bash
# inside the container, as root
apt update
apt install -y curl git build-essential poppler-utils
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

adduser --system --group --home /opt/flgov-bot flgov
```

`poppler-utils` is what renders uploaded PDFs into review images. Without it the
bot still works — it just attaches the PDFs instead of previewing them.

Copy this folder to `/opt/flgov-bot`, then:

```bash
cd /opt/flgov-bot
npm install --omit=dev
cp .env.example .env
nano .env            # fill in the token and IDs
npm run check        # validates every message layout offline
npm run deploy       # registers the slash commands to your guild
chown -R flgov:flgov /opt/flgov-bot
```

### 3. Keep it running

Two options — pick one, not both.

**PM2 (simplest)**

```bash
npm install -g pm2

cd /path/to/the/bot          # wherever you unzipped it
pm2 start ecosystem.config.js
pm2 save                     # remember this process list across reboots
pm2 startup systemd          # prints one command — copy/paste and run it
```

Day to day:

```bash
pm2 logs flgov-bot           # live logs
pm2 logs flgov-bot --lines 200
pm2 restart flgov-bot        # after editing .env or pulling changes
pm2 stop flgov-bot
pm2 status
pm2 monit                    # cpu / memory dashboard
```

`ecosystem.config.js` pins the bot to a **single fork-mode process** on purpose.
Cluster mode would open one gateway connection per instance and every button
click would be handled twice. `watch` is off for the same class of reason —
SQLite's WAL files change constantly and would cause a restart loop.

**systemd (alternative)**

`flgov-bot.service` assumes the bot lives at `/opt/flgov-bot` and runs as a
`flgov` user. If yours is somewhere else, edit `WorkingDirectory`, `ExecStart`,
`ReadWritePaths`, `User` and `Group` before installing it:

```bash
cp flgov-bot.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now flgov-bot
journalctl -u flgov-bot -f
```

---

## Configuration

Everything lives in `.env`; see `.env.example` for the annotated list. The values
that matter most:

| Key | Meaning |
|---|---|
| `CLERK_ROLE_ID` | Can open/deny cases and approve/deny every step |
| `LAWYER_ROLE_ID` | The bar. Listed in `/review`, pinged for lawyer requests |
| `ADMIN_OVERRIDE` | `false` by default — administrators do **not** count as clerks |
| `CRIMINAL_CASE_CATEGORY_ID` | Where criminal contests are created (blank = civil category) |
| `LAWYER_REQUEST_CHANNEL_ID` | Where `/lawreq` broadcasts go |
| `COURT_VOICE_CHANNEL_ID` | The voice channel `/request` points people to |
| `JUDGE_ROLE_ID` | Read/write on every case channel; assigned via `/addjudge` |
| `CIVIL_CASE_CATEGORY_ID` | Where case channels are created |
| `SUPPORT_CHANNEL_ID` | Linked in the "if you have questions" copy |
| `CASE_YEAR_OVERRIDE` | Force the `YY` prefix (blank = real current year) |
| `DENIED_CASE_ACTION` | `lock` keeps denied channels as a record, `delete` removes them |
| `DEPARTMENTS` | Comma-separated dropdown for the Sue a Department modal |
| `LOG_CHANNEL_ID` | Optional audit trail of every case action |
| `WELCOME_CHANNEL_ID` | Channel that gets the join message (blank = off) |
| `WELCOME_EMOJI` | Emoji shown on the welcome card |

### Court forms

`assets/forms/` holds the complete Clearwater County form library — all 45
editable PDFs, registered in `config.forms` (`src/config.js`). Filenames are
already sanitised (no spaces) because they are referenced by `attachment://`
and must match exactly what Discord stores.

Only seven are wired into a flow today; the rest are installed and addressable
by key, ready for the criminal, traffic and appeals features. `config.formsIn('criminal')`
returns every key in a category.

**Criminal (CR)**

| Key | File | Used by |
|---|---|---|
| `CR01` | `CR-01_Arrest_Affidavit_and_Probable_Cause_Statement.pdf` | — |
| `CR02` | `CR-02_Notice_to_Appear.pdf` | — |
| `CR03` | `CR-03_Information-Formal_Charging_Document.pdf` | — |
| `CR04` | `CR-04_Arrest_Warrant_and_Application.pdf` | — |
| `CR05` | `CR-05_Search_Warrant_Application_and_Warrant.pdf` | — |
| `CR06` | `CR-06_Pretrial_Release_and_Bond_Order.pdf` | — |
| `CR07` | `CR-07_Plea_Agreement_and_Waiver_of_Rights.pdf` | — |
| `CR08` | `CR-08_Notice_of_Appearance_of_Counsel.pdf` | — |
| `CR09` | `CR-09_Application_for_Court-Appointed_Counsel_and_Affidavit_of_Indigency.pdf` | — |
| `CR10` | `CR-10_Judgment_and_Sentence.pdf` | — |
| `CR11` | `CR-11_Order_of_Probation_and_Violation_Report.pdf` | — |
| `CR12` | `CR-12_Motion_to_Suppress_Evidence.pdf` | — |

**Civil (CV)**

| Key | File | Used by |
|---|---|---|
| `CV01` | `CV-01_Civil_Complaint.pdf` | civil complaint step |
| `CV02` | `CV-02_Summons.pdf` | summons + service steps |
| `CV03` | `CV-03_Answer_and_Affirmative_Defenses.pdf` | defendant's answer |
| `CV04` | `CV-04_Notice_of_Claim_Against_a_Government_Entity.pdf` | government wizard, panel 3 |
| `CV05` | `CV-05_Small_Claims_Statement_of_Claim.pdf` | civil complaint step |
| `CV06` | `CV-06_Motion_to_Dismiss.pdf` | — |
| `CV07` | `CV-07_Request_for_Production_of_Documents.pdf` | — |
| `CV08` | `CV-08_Notice_of_Deposition.pdf` | — |
| `CV09` | `CV-09_Settlement_Agreement_and_Release_of_Claims.pdf` | — |
| `CV10` | `CV-10_Final_Judgment-Civil.pdf` | — |

**Traffic (TR)**

| Key | File | Used by |
|---|---|---|
| `TR01` | `TR-01_Uniform_Traffic_Citation.pdf` | — |
| `TR02` | `TR-02_Election_of_Options-Response_to_Citation.pdf` | — |
| `TR03` | `TR-03_Affidavit_of_Compliance-Correctable_Violation.pdf` | — |
| `TR04` | `TR-04_Request_for_Traffic_Hearing.pdf` | — |
| `TR05` | `TR-05_Driver_License_Suspension_and_Reinstatement_Order.pdf` | — |

**General practice (GN)**

| Key | File | Used by |
|---|---|---|
| `GN01` | `GN-01_General_Motion.pdf` | — |
| `GN02` | `GN-02_Notice_of_Hearing.pdf` | — |
| `GN03` | `GN-03_Subpoena.pdf` | — |
| `GN04` | `GN-04_Witness_List_and_Exhibit_List.pdf` | — |
| `GN05` | `GN-05_Filing_Cover_Sheet_and_Certificate_of_Service.pdf` | — |
| `GN06` | `GN-06_Motion_for_Continuance.pdf` | — |

**Clerk & administrative (AD)**

| Key | File | Used by |
|---|---|---|
| `AD01` | `AD-01_Civil_Cover_Sheet.pdf` | — |
| `AD02` | `AD-02_Notice_of_Appeal.pdf` | — |
| `AD03` | `AD-03_Public_Records_Request.pdf` | government wizard, panel 2 |
| `AD04` | `AD-04_Application_for_Admission_to_the_Clearwater_County_Bar.pdf` | — |
| `AD05` | `AD-05_Internal_Affairs_Complaint.pdf` | government wizard, panel 2 |
| `AD06` | `AD-06_Petition_to_Seal_or_Expunge_a_Criminal_Record.pdf` | — |
| `AD07` | `AD-07_Request_for_Transcript_and_Record_on_Appeal.pdf` | — |
| `AD08` | `AD-08_Jury_Summons_and_Juror_Questionnaire.pdf` | — |

**Rulings & appeals (AP / JR)**

| Key | File | Used by |
|---|---|---|
| `AP01` | `AP-01_Notice_of_Appeal_of_Sentence.pdf` | — |
| `AP02` | `AP-02_Notice_of_Appeal_to_the_Supreme_Court.pdf` | — |
| `AP03` | `AP-03_Appellate_Brief.pdf` | — |
| `JR01` | `JR-01_Judicial_Ruling_and_Order.pdf` | — |

`assets/reference/` holds the non-form documents: the Charge and Penalty Code
(PDF + spreadsheet), the Court Procedures Manual, the Quick-Start Guide and the
form index. Nothing reads them yet — they are there for the charge lookup and
sentencing features.

If a PDF is ever missing the bot does **not** crash: the message shows a short
note in place of the file, `npm run check` lists what is absent, and the bot logs
the same list on boot.

---

## Development

```bash
npm run check      # builds every message + modal and validates the layout rules
npm run simulate   # runs the whole case lifecycle against a fake Discord + temp DB
```

`npm run check` catches the mistakes that produce a bare `400 Bad Request` from
Discord: missing V2 flags, buttons outside action rows, galleries over ten items,
`attachment://` references with no matching file, oversized text blocks, illegal
modal children. `npm run simulate` exercises the real service layer end to end —
filing, denial, every stage transition, permission flips, exhibit lettering and
judge appointment — without a token.

### Layout

```
ecosystem.config.js       PM2 process definition
flgov-bot.service         systemd unit (alternative to PM2)
src/
  index.js                bootstrap + event wiring
  config.js               .env → typed config, court form registry
  db.js                   SQLite schema and prepared statements
  stages.js               the pipeline definition (single source of truth)
  commands.js             slash command definitions
  deploy-commands.js      registers them with Discord
  lib/
    ids.js                every custom_id in one registry
    perms.js              clerk / judge / admin checks
    format.js             case numbers, exhibit letters, link formatting
    pdf.js                poppler wrapper
    media.js              uploads → gallery items + file components
  ui/
    common.js             Components V2 primitives (container, banner, buttons…)
    messages.js           every message the bot sends
    modals.js             every modal
    govWizard.js          the four ephemeral government-claim panels
    lawyers.js            review panel, attorney profiles, request embeds
  services/
    caseService.js        the state machine: channels, permissions, transitions
    barService.js         the bar roll, attorney profiles
  handlers/
    buttons.js  modals.js  commands.js  messages.js  fields.js
scripts/
  check.js                offline layout validator
  simulate.js             lifecycle dry run
```

`src/stages.js` holds both pipelines (`person` and `department`) and is the only
place that knows what follows what. Adding a stage means an entry there, a body
in `stageBody()` plus a header in `STAGE_HEADERS` (`src/ui/messages.js`), and a
branch in `stepModal()`. The handlers pick it up automatically. A stage marked
`noSubmission: true` advances on the button press alone, with no upload and no
clerk review — that is how the department `notice` stage works.

---

## Data

Two things to back up:

- `data/court.db` — the docket (SQLite, WAL mode)
- `data/cases/` — every file ever filed, laid out as
  `<case number>/<stage>/<timestamp>-<n>-<original name>`

```bash
sqlite3 data/court.db ".backup '/root/court-backup.db'"
tar czf /root/case-files-backup.tar.gz data/cases
```

Tables: `cases`, `submissions`, `submission_files` (`local_path` points into
`data/cases/`), `exhibits`, `counters`. The schema migrates itself additively on
boot, so dropping in a newer version over a live database is safe.

---

## Known limits

- A single message can carry ten files and about 10 MB. Anything beyond that is
  still archived to `data/cases/` and named in the message, just not attached.
- Media galleries hold ten items, so a PDF longer than ten pages is truncated in
  the preview (the full PDF is always attached alongside it).
- Private discovery threads fall back to public threads if the server cannot
  create private ones.
- The panel's clerk ping uses `CLERK_ROLE_ID`; make sure that role is mentionable
  or that the bot has Mention Everyone on the category.
