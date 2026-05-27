const { Router } = require('express');
const db = require('../lib/db');
const status = require('../lib/status');
const { notifyOthers } = require('../lib/notify');

const router = Router();

router.post('/:sectionId', async (req, res) => {
  // Viewers cannot vote
  if (req.user.role === 'viewer') return res.status(403).send('Viewers cannot vote');

  const { vote, reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).send('Reason is mandatory');
  if (!['accept', 'reject'].includes(vote)) return res.status(400).send('Invalid vote');

  const { rows: existing } = await db.query(
    'SELECT id FROM bizplan.votes WHERE section_id = $1 AND voter_email = $2',
    [req.params.sectionId, req.user.email]
  );

  if (existing.length) {
    await db.query(
      'UPDATE bizplan.votes SET vote = $1, reason = $2, created_at = now() WHERE id = $3',
      [vote, reason, existing[0].id]
    );
  } else {
    await db.query(
      `INSERT INTO bizplan.votes (section_id, voter_email, voter_name, vote, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.sectionId, req.user.email, req.user.name, vote, reason]
    );
  }

  const entryType = vote === 'accept' ? 'accept' : 'reject';
  await db.query(
    `INSERT INTO bizplan.thread_entries (section_id, author_email, author_name, entry_type, body_md)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.sectionId, req.user.email, req.user.name, entryType, reason]
  );

  const newStatus = await status.recalculate(req.params.sectionId);

  const { rows: sec } = await db.query('SELECT title FROM bizplan.sections WHERE id = $1', [req.params.sectionId]);
  const sectionTitle = sec[0]?.title || 'Unknown';
  const voteAction = vote === 'accept' ? 'accepted' : 'rejected';
  notifyOthers({
    excludeEmail: req.user.email,
    subject: `Exec: ${req.user.name} ${voteAction} "${sectionTitle}"`,
    html: `<p><strong>${req.user.name}</strong> ${voteAction} <strong>${sectionTitle}</strong></p><p><em>Reason:</em> ${reason}</p><p>Status is now <strong>${newStatus}</strong>.</p>`,
    sectionId: req.params.sectionId,
    type: 'vote_cast'
  }).catch(() => {});

  res.set('HX-Trigger', 'threadUpdated, sectionUpdated').send('');
});

module.exports = router;
