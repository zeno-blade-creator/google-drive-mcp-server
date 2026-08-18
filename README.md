# google-drive-mcp

A local MCP server that gives Claude Code **full-scope Google Drive** access —
search, read, upload, rename, move, and change sharing permissions — including on
files that already exist in your Drive (not just ones this app creates).

It requests the broad `https://www.googleapis.com/auth/drive` scope on purpose,
because the tasks it's built for (renaming, moving, and changing sharing on
existing course files) are impossible with the narrower `drive.file` scope.

---

## One-time setup

You do this **once**. After that, every Claude Code session can use the
`google-drive` tools.

### Step 1 — Create a Google Cloud project (skip if you already have one)

1. Go to <https://console.cloud.google.com/>.
2. Top bar → project dropdown → **New Project**.
3. Name it something like `app-integrations` → **Create**. Wait a few seconds, then
   make sure that project is selected in the top bar.

### Step 2 — Enable the Google Drive API

1. Go to <https://console.cloud.google.com/apis/library/drive.googleapis.com>.
2. Confirm your project is selected → click **Enable**.

### Step 3 — Configure the OAuth consent screen

1. Go to <https://console.cloud.google.com/auth/overview> (APIs & Services →
   OAuth consent screen).
2. If prompted, choose **User Type: External** → **Create**.
   (External is fine for a personal Google account; you'll just be a "test user".)
3. Fill the required fields:
   - **App name**: `google-drive-mcp` (anything is fine)
   - **User support email**: your email
   - **Developer contact email**: your email
   - Save and continue.
4. **Scopes** page: you don't have to add scopes here — the server requests them
   at auth time. Save and continue.
5. **Test users** page: click **+ Add users** and add **your own Google email**
   (your own Google account). This is required while the app is in "Testing".
   Save and continue.

> You do **not** need to publish the app or go through Google verification. A
> Testing-status app works indefinitely for the test users you list; a refresh
> token for a Testing app can expire after 7 days of disuse — if Drive tools ever
> start failing with an auth error, just re-run `npm run auth` (Step 6).

### Step 4 — Create the OAuth client (Desktop app)

1. Go to <https://console.cloud.google.com/auth/clients> (APIs & Services →
   Credentials).
2. **+ Create Credentials** → **OAuth client ID**.
3. **Application type: Desktop app**. Name it `desktop-mcp` → **Create**.
4. In the dialog, click **Download JSON**.

### Step 5 — Put the client file where the server expects it

Save that downloaded JSON to exactly this path/name:

```
~/.config/google-drive-mcp/gcp-oauth.keys.json
```

For example, if it downloaded to `~/Downloads/client_secret_XXXX.json`:

```bash
mkdir -p ~/.config/google-drive-mcp
mv ~/Downloads/client_secret_*.json ~/.config/google-drive-mcp/gcp-oauth.keys.json
```

### Step 6 — Authorize (one time)

```bash
cd ~/mcp-servers/google-drive-mcp
npm run auth
```

This prints a URL and opens your browser. Sign in with the Google account whose
Drive you want to manage. You'll see a "Google hasn't verified this app" warning
(expected, because the app is in Testing) → **Advanced** → **Go to
google-drive-mcp (unsafe)** → **Continue** → allow the Drive permission.

On success it writes `~/.config/google-drive-mcp/.gdrive-credentials.json`
(your refresh token — keep it private; it's already `chmod 600`).

### Step 7 — Use it

The server is already registered in `~/.claude.json` under the name
`google-drive`. Start a **new** Claude Code session and the `gdrive_*` tools will
be available. (MCP servers load at session start, so a session started before
registration won't see them.)

Quick manual smoke test (optional):

```bash
cd ~/mcp-servers/google-drive-mcp && npm start
# prints "google-drive-mcp: connected over stdio", then waits. Ctrl-C to quit.
```

---

## Tools

| Tool | What it does |
|---|---|
| `gdrive_search` | Search with a Drive `q` query (e.g. `name contains 'syllabus'`) |
| `gdrive_list_recent` | List recently-modified files |
| `gdrive_list_children` | List the direct children of a folder (trashed items excluded by default) |
| `gdrive_get_metadata` | Metadata + links for one file |
| `gdrive_get_links` | Get open-in-new-tab + iframe `.../preview` embed links |
| `gdrive_create_folder` | Create a folder (optionally nested) |
| `gdrive_upload_file` | Upload a **local file by path** (streamed — good for big PDFs) |
| `gdrive_create_text_file` | Create a text file from inline content |
| `gdrive_copy` | Copy a file (**not** folders — the Drive API can't copy a folder in one call) |
| `gdrive_create_shortcut` | Point a shortcut at an existing file/folder so one item can live in several places |
| `gdrive_rename` | Rename a file/folder |
| `gdrive_move` | Move via add/remove parents |
| `gdrive_trash` | Move to trash — **reversible**, Drive keeps it 30 days |
| `gdrive_untrash` | Restore from trash |
| `gdrive_delete` | **Permanent** delete, no trash, unrecoverable — guarded (see below) |
| `gdrive_list_permissions` | List permissions (emails + roles) |
| `gdrive_share` | Add a permission — `{type:'anyone',role:'reader'}` = link-Viewer; `{type:'user',role:'writer',emailAddress:...}` = Editor |
| `gdrive_unshare` | Remove a permission by id |

### Deleting things

`gdrive_trash` is the one to reach for. It's reversible, Drive holds trashed
items for 30 days, and `gdrive_untrash` puts them back where they were.

`gdrive_delete` is permanent and unrecoverable — nothing lands in the trash. It
requires a `confirmName` that exactly matches the item's current name, which
forces a metadata read before anything is destroyed, so a stale or mistyped file
ID fails loudly instead of deleting the wrong thing. Deleting a folder takes
everything inside it.

## Registration

Registered in **both** configs — they are read independently, so registering in
one does not make the server available in the other:

- `~/.claude.json` (Claude Code)
- `~/Library/Application Support/Claude/claude_desktop_config.json` (Desktop / Cowork)

Identical entry in each:

```json
"google-drive": {
  "command": "/opt/homebrew/bin/node",
  "args": ["/ABSOLUTE/PATH/TO/mcp-servers/google-drive-mcp/index.js"]
}
```

**The absolute path to `node` is required, not a style choice.** An app launched
from Finder or at login inherits the minimal launchd `PATH`
(`/usr/bin:/bin:/usr/sbin:/sbin`), in which Homebrew's `/opt/homebrew/bin/node`
is invisible entirely. A bare `"node"` works every time you test it from a
terminal and fails every morning. `~/mcp-servers/trello-mcp/doctor.py` checks
every server in both configs for this.

If you install the `claude` CLI later, the equivalent command is:

```bash
claude mcp add --scope user google-drive -- /opt/homebrew/bin/node ~/mcp-servers/google-drive-mcp/index.js
```

## Files

- `index.js` — the MCP server (tool definitions)
- `auth.js` — one-time `npm run auth` loopback OAuth flow
- `lib-auth.js` — shared OAuth/config helpers
- `~/.config/google-drive-mcp/gcp-oauth.keys.json` — **you provide** (Step 5)
- `~/.config/google-drive-mcp/.gdrive-credentials.json` — created by `npm run auth`

---

## For the resume / portfolio

Kept here so a future resume session has the honest version rather than
reconstructing it.

**Why this exists when a Drive connector already does.** It extends the built-in
connector rather than replacing it. The gap is bulk work: renaming a hundred
files after a naming convention changes mid-project is tedious by hand, trivial
to script, and worth solving permanently rather than once. That was the
motivating case.

**What I actually did:** set the goal and the constraint — a free solution that
saves the same time on every future project, not a one-off script for one
folder.

**Known operational caveat:** the OAuth app's publishing status governs how long
refresh tokens last. In "Testing" they expire roughly weekly (`invalid_grant`);
publishing the app removes that limit for every integration sharing the Cloud
project.

**Portfolio-length bullet:** see the shared version in
`~/mcp-servers/trello-mcp/README.md` — these three are best described together.

Full case study: https://zeno-blade-creator.github.io/projects/personal-integrations.html
