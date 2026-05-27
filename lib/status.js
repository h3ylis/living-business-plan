const db = require('./db');
const settings = require('./settings');

// Fallback for when settings/partners aren't available
const ENV_REQUIRED = parseInt(process.env.REQUIRED_VOTES) || 2;

async function getRequiredVotes() {
  try {
    const mode = await settings.get('consensus_mode');

    if (mode === 'manual') {
      const threshold = parseInt(await settings.get('consensus_threshold'));
      if (threshold > 0) return threshold;
    }

    // Auto mode: derive from active vote-eligible partner count
    const { rows } = await db.query(
      "SELECT COUNT(*) AS cnt FROM bizplan.partners WHERE active = true AND role IN ('admin', 'partner')"
    );
    const count = parseInt(rows[0].cnt);

    if (count <= 0) return ENV_REQUIRED; // No partners table data yet
    if (count === 1) return 1;           // Solo — just sign-off
    if (count === 2) return 2;           // Two partners — unanimous
    return Math.ceil(count / 2) + 1;     // 3+ — majority (e.g. 2 of 3, 3 of 4, 3 of 5)
  } catch {
    return ENV_REQUIRED; // Fallback if tables don't exist yet
  }
}

async function recalculate(sectionId) {
  const { rows } = await db.query(
    'SELECT vote, voter_email FROM bizplan.votes WHERE section_id = $1',
    [sectionId]
  );

  const accepts = rows.filter(r => r.vote === 'accept');
  const rejects = rows.filter(r => r.vote === 'reject');
  const required = await getRequiredVotes();

  let status = 'draft';
  if (rows.length === 0) {
    status = 'draft';
  } else if (accepts.length >= required && rejects.length > 0) {
    status = 'approved_with_objection';
  } else if (accepts.length >= required) {
    status = 'approved';
  } else if (rejects.length >= required) {
    status = 'rejected';
  } else {
    status = 'under_review';
  }

  await db.query(
    'UPDATE bizplan.sections SET status = $1, updated_at = now() WHERE id = $2',
    [status, sectionId]
  );
  return status;
}

module.exports = { recalculate, getRequiredVotes };
