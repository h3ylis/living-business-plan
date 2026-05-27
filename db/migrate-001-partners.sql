-- Migration 001: Partners, sessions, settings, invites
-- Run: psql -U postgres -d exec -f db/migrate-001-partners.sql

-- Partners table (replaces PARTNER_EMAILS env var)
CREATE TABLE IF NOT EXISTS bizplan.partners (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL DEFAULT '',
    role            TEXT NOT NULL DEFAULT 'partner'
                    CHECK (role IN ('admin', 'partner', 'viewer')),
    invited_by      UUID REFERENCES bizplan.partners(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    accepted_at     TIMESTAMPTZ,
    active          BOOLEAN NOT NULL DEFAULT true
);

-- Partner invites (pending invitations)
CREATE TABLE IF NOT EXISTS bizplan.partner_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    token           VARCHAR(128) NOT NULL UNIQUE,
    invited_by      UUID NOT NULL REFERENCES bizplan.partners(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ
);

-- Sessions (for magic-link auth)
CREATE TABLE IF NOT EXISTS bizplan.sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token           VARCHAR(128) NOT NULL UNIQUE,
    partner_id      UUID NOT NULL REFERENCES bizplan.partners(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL
);

-- App settings (key-value store)
CREATE TABLE IF NOT EXISTS bizplan.settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    updated_by      UUID REFERENCES bizplan.partners(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_partners_active ON bizplan.partners(active);
CREATE INDEX IF NOT EXISTS idx_partner_invites_token ON bizplan.partner_invites(token);
CREATE INDEX IF NOT EXISTS idx_partner_invites_email ON bizplan.partner_invites(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON bizplan.sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_partner ON bizplan.sessions(partner_id);

-- Default settings
INSERT INTO bizplan.settings (key, value) VALUES
    ('app_name', 'Exec'),
    ('document_title', 'Business Plan'),
    ('accent_color', '#1565c0'),
    ('consensus_mode', 'auto'),
    ('consensus_threshold', '2'),
    ('lock_approved', 'false'),
    ('vote_reset_on_edit', 'false'),
    ('allow_viewer_comments', 'true')
ON CONFLICT (key) DO NOTHING;
