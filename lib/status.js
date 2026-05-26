const db = require('./db');

const REQUIRED_VOTES = 2;

async function recalculate(sectionId) {
  const { rows } = await db.query(
    'SELECT vote, voter_email FROM bizplan.votes WHERE section_id = $1',
    [sectionId]
  );

  const accepts = rows.filter(r => r.vote === 'accept');
  const rejects = rows.filter(r => r.vote === 'reject');

  let status = 'draft';
  if (rows.length === 0) {
    status = 'draft';
  } else if (accepts.length >= REQUIRED_VOTES && rejects.length > 0) {
    status = 'approved_with_objection';
  } else if (accepts.length >= REQUIRED_VOTES) {
    status = 'approved';
  } else if (rejects.length >= REQUIRED_VOTES) {
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

module.exports = { recalculate };
