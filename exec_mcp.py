#!/usr/bin/env python3
"""
Exec MCP Server — living business plan as MCP tools.

Direct PostgreSQL access to the bizplan schema. Does NOT require the
Express server to be running.

Transports (set EXEC_MCP_TRANSPORT env var):
  stdio             — for Claude Desktop / Claude Code (default)
  sse               — Server-Sent-Events on /sse + POST /messages/
  streamable-http   — newer Streamable HTTP on /mcp

Env vars:
  EXEC_DATABASE_URL               PG connection string
                                  (default: postgresql://postgres:changeme@localhost:5432/exec)
  EXEC_MCP_TRANSPORT              stdio | sse | streamable-http
  EXEC_MCP_HOST                   bind host (default 0.0.0.0)
  EXEC_MCP_PORT                   bind port (default 8801)
  EXEC_MCP_USER_EMAIL             identity for write operations (default: mcp@localhost)
  EXEC_MCP_USER_NAME              display name (default: MCP)
  EXEC_MCP_DISABLE_REBINDING_GUARD  '1' to disable DNS-rebinding guard
  EXEC_MCP_ALLOWED_HOSTS          comma-separated Host allow-list
  EXEC_MCP_ALLOWED_ORIGINS        comma-separated Origin allow-list
"""

import json
import os
import sys
from typing import Any

import psycopg2
import psycopg2.extras
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get("EXEC_DATABASE_URL",
               os.environ.get("DATABASE_URL",
               "postgresql://postgres:changeme@localhost:5432/exec"))

USER_EMAIL = os.environ.get("EXEC_MCP_USER_EMAIL", "mcp@localhost")
USER_NAME  = os.environ.get("EXEC_MCP_USER_NAME", "MCP")

TRANSPORT = (os.environ.get("EXEC_MCP_TRANSPORT") or "stdio").lower().strip()
HOST      = os.environ.get("EXEC_MCP_HOST") or "0.0.0.0"
try:
    PORT = int(os.environ.get("EXEC_MCP_PORT") or "8801")
except ValueError:
    PORT = 8801

REQUIRED_VOTES = 2

# ---------------------------------------------------------------------------
# Transport security
# ---------------------------------------------------------------------------

def _build_transport_security():
    disable = (os.environ.get("EXEC_MCP_DISABLE_REBINDING_GUARD") or "").strip().lower() in ("1", "true", "yes", "on")
    hosts   = [h.strip() for h in (os.environ.get("EXEC_MCP_ALLOWED_HOSTS")   or "").split(",") if h.strip()]
    origins = [o.strip() for o in (os.environ.get("EXEC_MCP_ALLOWED_ORIGINS") or "").split(",") if o.strip()]
    if not (disable or hosts or origins):
        return None
    try:
        from mcp.server.transport_security import TransportSecuritySettings
        return TransportSecuritySettings(
            enable_dns_rebinding_protection=not disable,
            allowed_hosts=hosts if hosts else None,
            allowed_origins=origins if origins else None,
        )
    except ImportError:
        return None

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_conn():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn

def query(sql, params=None):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            try:
                return [dict(r) for r in cur.fetchall()]
            except psycopg2.ProgrammingError:
                return []

def execute(sql, params=None):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            try:
                return dict(cur.fetchone())
            except (psycopg2.ProgrammingError, TypeError):
                return {}

def _serialise(obj):
    import datetime
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, list):
        return [_serialise(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _serialise(v) for k, v in obj.items()}
    return obj

# ---------------------------------------------------------------------------
# Status engine (mirrors lib/status.js)
# ---------------------------------------------------------------------------

def recalculate_status(section_id):
    votes = query("SELECT vote FROM bizplan.votes WHERE section_id = %s", (section_id,))
    accepts = [v for v in votes if v['vote'] == 'accept']
    rejects = [v for v in votes if v['vote'] == 'reject']

    if not votes:
        status = 'draft'
    elif len(accepts) >= REQUIRED_VOTES and len(rejects) > 0:
        status = 'approved_with_objection'
    elif len(accepts) >= REQUIRED_VOTES:
        status = 'approved'
    elif len(rejects) >= REQUIRED_VOTES:
        status = 'rejected'
    else:
        status = 'under_review'

    execute("UPDATE bizplan.sections SET status = %s, updated_at = now() WHERE id = %s",
            (status, section_id))
    return status

# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------

_fastmcp_kwargs: dict[str, Any] = {
    "instructions": (
        "Collaborative living business plan. "
        "Read the plan, discuss sections via threaded comments, "
        "cast votes (accept/reject with mandatory reasoning), and "
        "edit section content. 2-of-3 partner consensus required for approval."
    ),
    "host": HOST,
    "port": PORT,
}
_security = _build_transport_security()
if _security is not None:
    _fastmcp_kwargs["transport_security"] = _security

mcp = FastMCP("exec", **_fastmcp_kwargs)

# ── Read tools ─────────────────────────────────────────────────────────────

@mcp.tool()
def list_sections() -> str:
    """List all business plan sections with status, vote counts, and thread activity.
    Returns sections in document order."""
    rows = query("""
        SELECT s.id, s.position, s.title, s.status, s.version, s.updated_at,
               COALESCE(vc.accept_count, 0) AS accepts,
               COALESCE(vc.reject_count, 0) AS rejects,
               COALESCE(tc.thread_count, 0) AS thread_count,
               lt.entry_type AS last_thread_type,
               lt.author_name AS last_thread_author,
               lt.body_md AS last_thread_content,
               lt.created_at AS last_thread_at
        FROM bizplan.sections s
        LEFT JOIN (
            SELECT section_id,
                   COUNT(*) FILTER (WHERE vote = 'accept') AS accept_count,
                   COUNT(*) FILTER (WHERE vote = 'reject') AS reject_count
            FROM bizplan.votes GROUP BY section_id
        ) vc ON vc.section_id = s.id
        LEFT JOIN (
            SELECT section_id, COUNT(*) AS thread_count
            FROM bizplan.thread_entries GROUP BY section_id
        ) tc ON tc.section_id = s.id
        LEFT JOIN LATERAL (
            SELECT entry_type, author_name, body_md, created_at
            FROM bizplan.thread_entries
            WHERE section_id = s.id
            ORDER BY created_at DESC LIMIT 1
        ) lt ON true
        WHERE s.parent_id IS NULL
        ORDER BY s.position
    """)
    return json.dumps(_serialise(rows), indent=2)


@mcp.tool()
def get_section(section_id: str) -> str:
    """Get a single section's full content, status, and vote details.

    Args:
        section_id: UUID of the section
    """
    section = execute("""
        SELECT s.*,
               COALESCE(tc.thread_count, 0) AS thread_count
        FROM bizplan.sections s
        LEFT JOIN (
            SELECT section_id, COUNT(*) AS thread_count
            FROM bizplan.thread_entries GROUP BY section_id
        ) tc ON tc.section_id = s.id
        WHERE s.id = %s
    """, (section_id,))
    if not section:
        return json.dumps({"error": "Section not found"})

    votes = query("""
        SELECT voter_email, voter_name, vote, reason, created_at
        FROM bizplan.votes WHERE section_id = %s ORDER BY created_at
    """, (section_id,))
    section['votes'] = votes

    return json.dumps(_serialise(section), indent=2)


@mcp.tool()
def read_plan() -> str:
    """Read the full business plan as a document — all sections with their
    Markdown content, in document order. Good for getting the big picture."""
    rows = query("""
        SELECT position, title, body_md, status, version
        FROM bizplan.sections
        WHERE parent_id IS NULL
        ORDER BY position
    """)
    parts = []
    for r in rows:
        badge = f"[{r['status'].upper().replace('_', ' ')}]"
        parts.append(f"## {r['position']}. {r['title']}  {badge}  (v{r['version']})\n\n{r['body_md']}")
    return "\n\n---\n\n".join(parts)


@mcp.tool()
def get_thread(section_id: str) -> str:
    """Get the full discussion thread for a section, including comments,
    edits, and vote entries.

    Args:
        section_id: UUID of the section
    """
    section = execute("SELECT id, title, status FROM bizplan.sections WHERE id = %s", (section_id,))
    if not section:
        return json.dumps({"error": "Section not found"})

    entries = query("""
        SELECT id, author_email, author_name, entry_type, body_md, created_at
        FROM bizplan.thread_entries
        WHERE section_id = %s ORDER BY created_at
    """, (section_id,))

    return json.dumps(_serialise({
        "section": section,
        "entries": entries,
        "count": len(entries),
    }), indent=2)


@mcp.tool()
def get_votes(section_id: str) -> str:
    """Get all votes on a section with who voted, how, and their reasoning.

    Args:
        section_id: UUID of the section
    """
    votes = query("""
        SELECT voter_email, voter_name, vote, reason, created_at
        FROM bizplan.votes WHERE section_id = %s ORDER BY created_at
    """, (section_id,))
    section = execute("SELECT id, title, status FROM bizplan.sections WHERE id = %s", (section_id,))
    return json.dumps(_serialise({"section": section, "votes": votes}), indent=2)


@mcp.tool()
def dashboard() -> str:
    """Get a dashboard overview — section counts by status, recent activity,
    and sections needing attention."""
    statuses = query("""
        SELECT status, COUNT(*) AS count
        FROM bizplan.sections WHERE parent_id IS NULL
        GROUP BY status ORDER BY count DESC
    """)

    recent = query("""
        SELECT te.entry_type, te.author_name, te.body_md,
               te.created_at, s.title AS section_title, s.id AS section_id
        FROM bizplan.thread_entries te
        JOIN bizplan.sections s ON s.id = te.section_id
        ORDER BY te.created_at DESC LIMIT 10
    """)

    needs_votes = query("""
        SELECT s.id, s.position, s.title, s.status,
               COALESCE(vc.total_votes, 0) AS total_votes
        FROM bizplan.sections s
        LEFT JOIN (
            SELECT section_id, COUNT(*) AS total_votes
            FROM bizplan.votes GROUP BY section_id
        ) vc ON vc.section_id = s.id
        WHERE s.parent_id IS NULL
          AND s.status IN ('draft', 'under_review')
        ORDER BY COALESCE(vc.total_votes, 0), s.position
    """)

    return json.dumps(_serialise({
        "status_counts": statuses,
        "recent_activity": recent,
        "needs_attention": needs_votes,
    }), indent=2)


@mcp.tool()
def search_plan(query_text: str) -> str:
    """Search across all section titles and content.

    Args:
        query_text: Text to search for (case-insensitive)
    """
    pattern = f"%{query_text}%"
    rows = query("""
        SELECT id, position, title, status,
               SUBSTRING(body_md FROM 1 FOR 200) AS excerpt
        FROM bizplan.sections
        WHERE title ILIKE %s OR body_md ILIKE %s
        ORDER BY position
    """, (pattern, pattern))
    return json.dumps(_serialise(rows), indent=2)


@mcp.tool()
def get_history(section_id: str) -> str:
    """Get the edit history of a section — every version that was saved.

    Args:
        section_id: UUID of the section
    """
    rows = query("""
        SELECT version, title, changed_by, changed_at,
               SUBSTRING(body_md FROM 1 FOR 300) AS excerpt
        FROM bizplan.section_history
        WHERE section_id = %s ORDER BY version DESC
    """, (section_id,))
    return json.dumps(_serialise(rows), indent=2)


@mcp.tool()
def get_links(section_id: str) -> str:
    """Get cross-references for a section (related, depends_on, conflicts_with, supersedes).

    Args:
        section_id: UUID of the section
    """
    rows = query("""
        SELECT sl.id, sl.link_type, sl.suggested_by, sl.accepted, sl.reason,
               s_src.title AS source_title, s_src.id AS source_id,
               s_tgt.title AS target_title, s_tgt.id AS target_id
        FROM bizplan.section_links sl
        JOIN bizplan.sections s_src ON s_src.id = sl.source_id
        JOIN bizplan.sections s_tgt ON s_tgt.id = sl.target_id
        WHERE sl.source_id = %s OR sl.target_id = %s
        ORDER BY sl.created_at
    """, (section_id, section_id))
    return json.dumps(_serialise(rows), indent=2)


# ── Write tools ────────────────────────────────────────────────────────────

@mcp.tool()
def add_comment(section_id: str, comment: str, author_name: str = "", author_email: str = "") -> str:
    """Add a comment to a section's discussion thread.

    Args:
        section_id: UUID of the section
        comment: The comment text (Markdown supported)
        author_name: Who is commenting (default: MCP user)
        author_email: Email of commenter (default: MCP user)
    """
    name = author_name or USER_NAME
    email = author_email or USER_EMAIL
    entry = execute("""
        INSERT INTO bizplan.thread_entries (section_id, author_email, author_name, entry_type, body_md)
        VALUES (%s, %s, %s, 'comment', %s) RETURNING *
    """, (section_id, email, name, comment))
    return json.dumps(_serialise(entry), indent=2)


@mcp.tool()
def cast_vote(section_id: str, vote: str, reason: str, voter_name: str = "", voter_email: str = "") -> str:
    """Cast a vote on a section. Requires a mandatory reason.

    2-of-3 accepts = approved. 2-of-3 rejects = rejected.
    If both thresholds are met = approved_with_objection.

    Args:
        section_id: UUID of the section
        vote: 'accept' or 'reject'
        reason: Mandatory explanation for the vote
        voter_name: Who is voting (default: MCP user)
        voter_email: Email of voter (default: MCP user)
    """
    if vote not in ('accept', 'reject'):
        return json.dumps({"error": "vote must be 'accept' or 'reject'"})
    if not reason.strip():
        return json.dumps({"error": "reason is mandatory"})

    name = voter_name or USER_NAME
    email = voter_email or USER_EMAIL

    thread_entry = execute("""
        INSERT INTO bizplan.thread_entries (section_id, author_email, author_name, entry_type, body_md)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
    """, (section_id, email, name, vote, reason))

    v = execute("""
        INSERT INTO bizplan.votes (section_id, voter_email, voter_name, vote, reason, thread_entry_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (section_id, voter_email) DO UPDATE
            SET vote = EXCLUDED.vote, reason = EXCLUDED.reason,
                thread_entry_id = EXCLUDED.thread_entry_id, created_at = now()
        RETURNING *
    """, (section_id, email, name, vote, reason, thread_entry['id']))

    new_status = recalculate_status(section_id)
    v['new_status'] = new_status
    return json.dumps(_serialise(v), indent=2)


@mcp.tool()
def edit_section(section_id: str, body_md: str = "", title: str = "",
                 editor_name: str = "", editor_email: str = "") -> str:
    """Edit a section's content and/or title. Creates a history entry
    and a thread entry documenting the change.

    Args:
        section_id: UUID of the section
        body_md: New Markdown content (leave empty to keep current)
        title: New title (leave empty to keep current)
        editor_name: Who is editing (default: MCP user)
        editor_email: Email of editor (default: MCP user)
    """
    if not body_md and not title:
        return json.dumps({"error": "Provide body_md and/or title to update"})

    name = editor_name or USER_NAME
    email = editor_email or USER_EMAIL

    current = execute("SELECT * FROM bizplan.sections WHERE id = %s", (section_id,))
    if not current:
        return json.dumps({"error": "Section not found"})

    execute("""
        INSERT INTO bizplan.section_history (section_id, version, title, body_md, changed_by)
        VALUES (%s, %s, %s, %s, %s)
    """, (section_id, current['version'], current['title'], current['body_md'], email))

    new_title = title if title else current['title']
    new_body = body_md if body_md else current['body_md']

    updated = execute("""
        UPDATE bizplan.sections
        SET title = %s, body_md = %s, version = version + 1, updated_at = now()
        WHERE id = %s RETURNING *
    """, (new_title, new_body, section_id))

    execute("""
        INSERT INTO bizplan.thread_entries (section_id, author_email, author_name, entry_type, body_md, previous_body)
        VALUES (%s, %s, %s, 'edit', %s, %s)
    """, (section_id, email, name,
          f"Edited section: {new_title}", current['body_md']))

    return json.dumps(_serialise(updated), indent=2)


@mcp.tool()
def add_section(title: str, body_md: str = "", position: int = 0,
                parent_id: str = "", author_name: str = "", author_email: str = "") -> str:
    """Add a new section to the business plan.

    Args:
        title: Section title
        body_md: Section content in Markdown
        position: Order position (0 = auto-append at end)
        parent_id: Parent section UUID for nesting (optional)
        author_name: Who is adding (default: MCP user)
        author_email: Email (default: MCP user)
    """
    name = author_name or USER_NAME
    email = author_email or USER_EMAIL

    if position == 0:
        r = execute("SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM bizplan.sections WHERE parent_id IS NULL")
        position = r['next_pos']

    params = [position, title, body_md or '']
    sql = "INSERT INTO bizplan.sections (position, title, body_md"
    if parent_id:
        sql += ", parent_id) VALUES (%s, %s, %s, %s) RETURNING *"
        params.append(parent_id)
    else:
        sql += ") VALUES (%s, %s, %s) RETURNING *"

    section = execute(sql, params)

    execute("""
        INSERT INTO bizplan.thread_entries (section_id, author_email, author_name, entry_type, body_md)
        VALUES (%s, %s, %s, 'system', %s)
    """, (section['id'], email, name, f"Section created: {title}"))

    return json.dumps(_serialise(section), indent=2)


@mcp.tool()
def add_link(source_id: str, target_id: str, link_type: str = "related", reason: str = "") -> str:
    """Create a cross-reference between two sections.

    Args:
        source_id: UUID of the source section
        target_id: UUID of the target section
        link_type: One of: related, depends_on, conflicts_with, supersedes
        reason: Why these sections are linked
    """
    if link_type not in ('related', 'depends_on', 'conflicts_with', 'supersedes'):
        return json.dumps({"error": "link_type must be: related, depends_on, conflicts_with, supersedes"})

    link = execute("""
        INSERT INTO bizplan.section_links (source_id, target_id, link_type, suggested_by, accepted, reason)
        VALUES (%s, %s, %s, 'manual', true, %s) RETURNING *
    """, (source_id, target_id, link_type, reason))
    return json.dumps(_serialise(link), indent=2)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if TRANSPORT == "stdio":
        mcp.run(transport="stdio")
    elif TRANSPORT in ("sse", "streamable-http"):
        mcp.run(transport=TRANSPORT)
    else:
        print(f"Unknown transport: {TRANSPORT}", file=sys.stderr)
        sys.exit(1)
