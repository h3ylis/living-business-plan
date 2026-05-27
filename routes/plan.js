const { Router } = require('express');
const db = require('../lib/db');
const { marked } = require('marked');
const { notifyOthers } = require('../lib/notify');
const settings = require('../lib/settings');
const status = require('../lib/status');

const router = Router();

router.get('/', async (req, res) => {
  const s = await settings.getAll();
  const lockApproved = s.lock_approved === 'true';

  const { rows: sections } = await db.query(
    `SELECT s.*,
       (SELECT json_agg(json_build_object('voter_email', v.voter_email, 'voter_name', v.voter_name, 'vote', v.vote, 'reason', v.reason) ORDER BY v.created_at)
        FROM bizplan.votes v WHERE v.section_id = s.id) AS votes
     FROM bizplan.sections s
     WHERE s.parent_id IS NULL
     ORDER BY s.position`
  );

  for (const sec of sections) {
    sec.body_html = marked(sec.body_md || '');
    sec.votes = sec.votes || [];
    sec.locked = lockApproved && (sec.status === 'approved' || sec.status === 'approved_with_objection');
  }

  const lastUpdated = sections.reduce((latest, sec) => {
    const d = new Date(sec.updated_at);
    return d > latest ? d : latest;
  }, new Date(0)).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  const documentTitle = s.document_title || 'Business Plan';

  res.render('plan', { sections, user: req.user, activeTab: 'plan', lastUpdated, documentTitle });
});

router.get('/section/:id', async (req, res) => {
  const s = await settings.getAll();
  const lockApproved = s.lock_approved === 'true';

  const { rows } = await db.query('SELECT * FROM bizplan.sections WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Not found');
  const section = rows[0];
  section.body_html = marked(section.body_md || '');

  const { rows: votes } = await db.query(
    'SELECT * FROM bizplan.votes WHERE section_id = $1 ORDER BY created_at', [section.id]
  );
  section.votes = votes;
  section.locked = lockApproved && (section.status === 'approved' || section.status === 'approved_with_objection');

  res.render('partials/section', { section, user: req.user, layout: false });
});

router.post('/section', async (req, res) => {
  const { title, body_md, parent_id } = req.body;
  const { rows: maxPos } = await db.query(
    'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM bizplan.sections WHERE parent_id IS NOT DISTINCT FROM $1',
    [parent_id || null]
  );
  const { rows } = await db.query(
    `INSERT INTO bizplan.sections (title, body_md, parent_id, position)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [title, body_md || '', parent_id || null, maxPos[0].next]
  );
  res.redirect('/plan');
});

router.put('/section/:id', async (req, res) => {
  const { title, body_md } = req.body;
  const s = await settings.getAll();

  // Check section locking
  if (s.lock_approved === 'true') {
    const { rows: current } = await db.query(
      'SELECT status FROM bizplan.sections WHERE id = $1', [req.params.id]
    );
    if (current[0]?.status === 'approved' || current[0]?.status === 'approved_with_objection') {
      return res.status(403).send('This section is approved and locked for editing.');
    }
  }

  // Check viewer restriction
  if (req.user.role === 'viewer') {
    return res.status(403).send('Viewers cannot edit sections.');
  }

  const { rows: old } = await db.query('SELECT * FROM bizplan.sections WHERE id = $1', [req.params.id]);
  if (!old.length) return res.status(404).send('Not found');

  await db.query(
    `INSERT INTO bizplan.section_history (section_id, version, title, body_md, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [old[0].id, old[0].version, old[0].title, old[0].body_md, req.user.email]
  );

  const { rows } = await db.query(
    `UPDATE bizplan.sections SET title = $1, body_md = $2, version = version + 1, updated_at = now()
     WHERE id = $3 RETURNING *`,
    [title, body_md, req.params.id]
  );

  await db.query(
    `INSERT INTO bizplan.thread_entries (section_id, author_email, author_name, entry_type, body_md, previous_body)
     VALUES ($1, $2, $3, 'edit', $4, $5)`,
    [req.params.id, req.user.email, req.user.name,
     `Updated section "${title}"`, old[0].body_md]
  );

  // Vote reset on edit (if enabled)
  if (s.vote_reset_on_edit === 'true') {
    const { rowCount } = await db.query(
      'DELETE FROM bizplan.votes WHERE section_id = $1', [req.params.id]
    );
    if (rowCount > 0) {
      await db.query(
        "UPDATE bizplan.sections SET status = 'draft', updated_at = now() WHERE id = $1",
        [req.params.id]
      );
      await db.query(
        `INSERT INTO bizplan.thread_entries (section_id, author_email, author_name, entry_type, body_md)
         VALUES ($1, $2, $3, 'system', 'Votes reset due to section edit')`,
        [req.params.id, req.user.email, req.user.name]
      );
    }
  }

  const section = rows[0];
  section.body_html = marked(section.body_md || '');
  const { rows: votes } = await db.query(
    'SELECT * FROM bizplan.votes WHERE section_id = $1 ORDER BY created_at', [section.id]
  );
  section.votes = votes;

  // Re-read status after potential vote reset
  const { rows: refreshed } = await db.query(
    'SELECT status FROM bizplan.sections WHERE id = $1', [section.id]
  );
  section.status = refreshed[0]?.status || section.status;
  section.locked = false; // Just edited, can't be locked

  notifyOthers({
    excludeEmail: req.user.email,
    subject: `Exec: "${title}" updated by ${req.user.name}`,
    html: `<p><strong>${req.user.name}</strong> updated <strong>${title}</strong>.</p>`,
    sectionId: req.params.id,
    type: 'section_updated'
  }).catch(() => {});

  res.render('partials/section', { section, user: req.user, layout: false });
});

module.exports = router;
