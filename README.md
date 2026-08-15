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
| **Sue a Department** | Same, but the defendant is picked from a dropdown of state agencies |
| **Active Civil Cases** | Private list of every open case, its stage, judge, and channel |

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
| `/panel` | same | Same, as a slash command |
| `/add user:` | clerks & judges | Adds someone to the case channel and the discovery thread |
| `/addjudge` | clerks & judges | User-select modal, appoints the judge, posts the appointment notice |
| `/caseinfo` | anyone in the channel | The docket entry: parties, stage, judge, exhibit count |
| `/exhibits` | anyone in the channel | Every exhibit filed in the case, with links |

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

### 3. Run it as a service

```bash
cp /opt/flgov-bot/flgov-bot.service /etc/systemd/system/
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
| `JUDGE_ROLE_ID` | Read/write on every case channel; assigned via `/addjudge` |
| `CIVIL_CASE_CATEGORY_ID` | Where case channels are created |
| `SUPPORT_CHANNEL_ID` | Linked in the "if you have questions" copy |
| `CASE_YEAR_OVERRIDE` | Force the `YY` prefix (blank = real current year) |
| `DENIED_CASE_ACTION` | `lock` keeps denied channels as a record, `delete` removes them |
| `DEPARTMENTS` | Comma-separated dropdown for the Sue a Department modal |
| `LOG_CHANNEL_ID` | Optional audit trail of every case action |
| `WELCOME_CHANNEL_ID` | Optional welcome message for new members |

### Swapping the court forms

Drop replacements into `assets/forms/` using the **exact same filenames**. The
names are referenced by `attachment://` inside the messages, so renaming a file
means also updating `config.forms` in `src/config.js`.

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
  services/
    caseService.js        the state machine: channels, permissions, transitions
  handlers/
    buttons.js  modals.js  commands.js  messages.js  fields.js
scripts/
  check.js                offline layout validator
  simulate.js             lifecycle dry run
```

Adding a stage means adding an entry to `src/stages.js`, a body in
`stageBody()` and a header in `STAGE_HEADERS` in `src/ui/messages.js`, and a modal
branch in `stepModal()`. The handlers pick it up automatically.

---

## Data

Everything is in `data/court.db` (SQLite, WAL mode). Back it up by copying the
`.db`, `.db-wal` and `.db-shm` files, or:

```bash
sqlite3 /opt/flgov-bot/data/court.db ".backup '/root/court-backup.db'"
```

Tables: `cases`, `submissions`, `submission_files`, `exhibits`, `counters`.

---

## Known limits

- Files larger than ~9 MB are not mirrored into review cards; the bot posts a link
  to the original upload instead so nothing is lost.
- Media galleries hold ten items, so a PDF longer than ten pages is truncated in
  the preview (the full PDF is always attached alongside it).
- Private discovery threads fall back to public threads if the server cannot
  create private ones.
- The panel's clerk ping uses `CLERK_ROLE_ID`; make sure that role is mentionable
  or that the bot has Mention Everyone on the category.
# lawsuit
