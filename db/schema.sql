CREATE SCHEMA IF NOT EXISTS bizplan;

CREATE TABLE bizplan.sections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id       UUID REFERENCES bizplan.sections(id) ON DELETE SET NULL,
    position        INT NOT NULL DEFAULT 0,
    title           TEXT NOT NULL,
    body_md         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','under_review','approved','rejected','approved_with_objection')),
    version         INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bizplan.thread_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID NOT NULL REFERENCES bizplan.sections(id) ON DELETE CASCADE,
    author_email    TEXT NOT NULL,
    author_name     TEXT NOT NULL DEFAULT '',
    entry_type      TEXT NOT NULL DEFAULT 'comment'
                    CHECK (entry_type IN ('comment','edit','accept','reject','system')),
    body_md         TEXT NOT NULL,
    previous_body   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bizplan.votes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID NOT NULL REFERENCES bizplan.sections(id) ON DELETE CASCADE,
    voter_email     TEXT NOT NULL,
    voter_name      TEXT NOT NULL DEFAULT '',
    vote            TEXT NOT NULL CHECK (vote IN ('accept','reject')),
    reason          TEXT NOT NULL,
    thread_entry_id UUID REFERENCES bizplan.thread_entries(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(section_id, voter_email)
);

CREATE TABLE bizplan.section_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID NOT NULL REFERENCES bizplan.sections(id) ON DELETE CASCADE,
    target_id       UUID NOT NULL REFERENCES bizplan.sections(id) ON DELETE CASCADE,
    link_type       TEXT NOT NULL DEFAULT 'related'
                    CHECK (link_type IN ('related','depends_on','conflicts_with','supersedes')),
    suggested_by    TEXT NOT NULL DEFAULT 'manual'
                    CHECK (suggested_by IN ('manual','llm')),
    accepted        BOOLEAN,
    reason          TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bizplan.notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_email TEXT NOT NULL,
    section_id      UUID REFERENCES bizplan.sections(id) ON DELETE CASCADE,
    thread_entry_id UUID REFERENCES bizplan.thread_entries(id),
    notification_type TEXT NOT NULL,
    sent_at         TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    deep_link       TEXT NOT NULL
);

CREATE TABLE bizplan.section_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID NOT NULL REFERENCES bizplan.sections(id) ON DELETE CASCADE,
    version         INT NOT NULL,
    title           TEXT NOT NULL,
    body_md         TEXT NOT NULL,
    changed_by      TEXT NOT NULL,
    changed_at      TIMESTAMPTZ DEFAULT now()
);

-- Partners & auth
CREATE TABLE bizplan.partners (
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

CREATE TABLE bizplan.partner_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    token           VARCHAR(128) NOT NULL UNIQUE,
    invited_by      UUID NOT NULL REFERENCES bizplan.partners(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ
);

CREATE TABLE bizplan.sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token           VARCHAR(128) NOT NULL UNIQUE,
    partner_id      UUID NOT NULL REFERENCES bizplan.partners(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE bizplan.settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    updated_by      UUID REFERENCES bizplan.partners(id)
);

-- Audit log
CREATE TABLE bizplan.audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_email     TEXT NOT NULL,
    actor_name      TEXT NOT NULL DEFAULT '',
    action          TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'admin',
    target_type     TEXT,
    target_id       TEXT,
    detail          TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_thread_entries_section ON bizplan.thread_entries(section_id);
CREATE INDEX idx_votes_section ON bizplan.votes(section_id);
CREATE INDEX idx_section_links_source ON bizplan.section_links(source_id);
CREATE INDEX idx_section_links_target ON bizplan.section_links(target_id);
CREATE INDEX idx_notifications_recipient ON bizplan.notifications(recipient_email, read_at);
CREATE INDEX idx_section_history_section ON bizplan.section_history(section_id);
CREATE INDEX idx_sections_parent ON bizplan.sections(parent_id);
CREATE INDEX idx_sections_position ON bizplan.sections(parent_id, position);
CREATE INDEX idx_partners_active ON bizplan.partners(active);
CREATE INDEX idx_partner_invites_token ON bizplan.partner_invites(token);
CREATE INDEX idx_sessions_token ON bizplan.sessions(token);
CREATE INDEX idx_sessions_partner ON bizplan.sessions(partner_id);
CREATE INDEX idx_audit_log_created ON bizplan.audit_log(created_at DESC);
CREATE INDEX idx_audit_log_actor ON bizplan.audit_log(actor_email);
CREATE INDEX idx_audit_log_category ON bizplan.audit_log(category);
CREATE INDEX idx_audit_log_target ON bizplan.audit_log(target_type, target_id);
