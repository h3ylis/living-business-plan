-- Migration 002: Audit log
-- Run: psql -U postgres -d exec -f db/migrate-002-audit-log.sql

CREATE TABLE IF NOT EXISTS bizplan.audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_email     TEXT NOT NULL,
    actor_name      TEXT NOT NULL DEFAULT '',
    action          TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'general'
                    CHECK (category IN ('auth', 'partner', 'section', 'vote', 'comment', 'settings', 'admin')),
    target_type     TEXT,           -- 'section', 'partner', 'setting', etc.
    target_id       TEXT,           -- UUID or key of the target
    detail          TEXT,           -- Human-readable description
    metadata        JSONB,          -- Structured data (old/new values, etc.)
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON bizplan.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON bizplan.audit_log(actor_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_category ON bizplan.audit_log(category);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON bizplan.audit_log(target_type, target_id);
