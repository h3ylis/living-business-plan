# Living Business Plan

**Reads like a document. Edits like a conversation. Decides like a board vote.**

A collaborative business plan platform for small partnerships. Write your plan in Markdown, discuss each section in threaded conversations, and make decisions through structured voting with mandatory reasoning.

No signup walls. No SaaS fees. Run it on your own machine.

## What it does

- **13-section business plan template** — Executive Summary through Timeline & Milestones
- **Threaded discussion per section** — comment, debate, refine
- **Structured voting** — accept or reject with mandatory reasoning (no drive-by approvals)
- **2-of-3 consensus** — sections are approved when 2 partners agree, flagged when anyone objects
- **Version history** — every edit is recorded, nothing is lost
- **Section cross-references** — link related sections (manual or AI-suggested)
- **Email notifications** — partners get notified when sections change or votes are cast
- **MCP server** — read and edit the plan from any AI chat client (Claude, etc.)

## Stack

- **Express 5** + custom Handlebars-like template engine (no build step)
- **HTMX** — modals, in-place updates, thread loading
- **Pico CSS** — clean, classless responsive base
- **PostgreSQL** — 7 tables in a `bizplan` schema
- **Python FastMCP** — optional MCP server for AI access (14 tools)

No webpack. No React. No build step. Edit a file, refresh the browser.

## Quick start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (any OS)
- Python 3.10+ with `psycopg2` and `mcp` (only if you want the MCP server)

### Setup

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/living-business-plan.git
cd living-business-plan

# Create the database
psql -U postgres -c "CREATE DATABASE exec"
psql -U postgres -d exec -f db/schema.sql
psql -U postgres -d exec -f db/seed.sql

# Configure
cp .env.example .env
# Edit .env — set DATABASE_URL and partner emails

# Install & run
npm install
node server.js
```

Open `http://localhost:8800`. In dev mode it auto-logs you in.

### MCP server (optional)

The MCP server gives AI assistants direct access to read, discuss, and vote on the plan.

```bash
pip install psycopg2-binary mcp
python exec_mcp.py
```

Supports `stdio` (for Claude Desktop/Code), `sse`, and `streamable-http` transports. Configure via environment variables — see the top of `exec_mcp.py`.

## How voting works

```
No votes           → draft
Any vote cast      → under_review
2 accepts          → approved
2 rejects          → rejected
2 accepts + reject → approved_with_objection
```

Every vote requires a written reason. No silent approvals, no rubber stamps. The reasoning is preserved in the section's thread alongside comments and edits.

## Authentication

Two modes:

- **Development** — auto-login using `DEV_USER_EMAIL` / `DEV_USER_NAME` from `.env`
- **Production** — reads `Remote-Email` and `Remote-Name` headers from a reverse proxy (designed for [Authelia](https://www.authelia.com/), works with any SSO that injects headers)

There's no built-in user database — identity comes from your auth layer.

## Project structure

```
server.js           — Express app + template engine
lib/
  auth.js           — Authelia header parsing + dev mode bypass
  db.js             — PostgreSQL connection pool
  status.js         — Vote → status engine (2-of-3 consensus)
  notify.js         — Email notifications via Nodemailer
routes/
  dashboard.js      — Landing page with stats + activity feed
  plan.js           — Document view + section CRUD
  thread.js         — Threaded comments per section
  vote.js           — Accept/reject with mandatory reason
views/
  layout.html       — Page shell
  dashboard.html    — Dashboard template
  plan.html         — Full document view
  partials/         — Section card, thread modal
  emails/           — Notification email templates
static/
  style.css         — Custom styles
  exec.js           — Client-side JS (modals, inline edit, HTMX helpers)
  htmx.min.js       — HTMX (local copy)
  pico.min.css      — Pico CSS (local copy)
db/
  schema.sql        — PostgreSQL schema (7 tables)
  seed.sql          — 13 starter sections
exec_mcp.py         — MCP server (14 tools, direct PG access)
```

## Database

7 tables in the `bizplan` schema:

| Table | Purpose |
|-------|---------|
| `sections` | 13 business plan sections (hierarchical, Markdown body) |
| `thread_entries` | Threaded conversation per section |
| `votes` | Accept/reject with mandatory reasoning |
| `section_links` | Cross-references between sections |
| `notifications` | Email notification log |
| `section_history` | Immutable version history |

Reset everything:
```bash
psql -U postgres -c "DROP DATABASE exec"
psql -U postgres -c "CREATE DATABASE exec"
psql -U postgres -d exec -f db/schema.sql
psql -U postgres -d exec -f db/seed.sql
```

## MCP tools

The MCP server exposes 14 tools for AI-powered plan access:

**Read:** `list_sections`, `get_section`, `read_plan`, `get_thread`, `get_votes`, `dashboard`, `search_plan`, `get_history`, `get_links`

**Write:** `add_comment`, `cast_vote`, `edit_section`, `add_section`, `add_link`

This means you can discuss and refine your business plan directly from an AI chat — ask it to review a section, suggest improvements, or even cast a vote with reasoning.

## License

[AGPL-3.0](LICENSE) — free to use, modify, and self-host. If you run a modified version as a service, you must share your changes.
