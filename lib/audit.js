const db = require('./db');

/**
 * Log an auditable action.
 * @param {object} opts
 * @param {object} opts.user       - { email, name } of the actor
 * @param {string} opts.action     - verb: 'login', 'vote_accept', 'edit_section', 'add_partner', etc.
 * @param {string} opts.category   - 'auth'|'partner'|'section'|'vote'|'comment'|'settings'|'admin'
 * @param {string} [opts.targetType] - 'section', 'partner', 'setting'
 * @param {string} [opts.targetId]   - UUID or key
 * @param {string} [opts.detail]     - human-readable summary
 * @param {object} [opts.metadata]   - structured data (old/new values, etc.)
 */
async function log({ user, action, category, targetType, targetId, detail, metadata }) {
  try {
    await db.query(
      `INSERT INTO bizplan.audit_log (actor_email, actor_name, action, category, target_type, target_id, detail, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        user?.email || 'system',
        user?.name || 'System',
        action,
        category || 'general',
        targetType || null,
        targetId || null,
        detail || null,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
  } catch (err) {
    // Never let audit logging break the main flow
    console.error('Audit log error:', err.message);
  }
}

module.exports = { log };
