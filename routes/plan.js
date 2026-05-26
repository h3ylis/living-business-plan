const { Router } = require('express');
const db = require('../lib/db');
const { marked } = require('marked');
const { notifyOthers } = require('../lib/notify');

const router = Router();

router.get('/', async (req, res) => {
  const { rows: sections } = await db.query(
    `SELECT s.*,
       (SELECT json_agg(json_build_object('voter_email', v.voter_email, 'voter_name', v.voter_name, 'vote', v.vote, 'reason', v.reason) ORDER BY v.created_at)
        FROM bizplan.votes v WHERE v.section_id = s.id) AS votes
     FROM bizplan.sections s
     WHERE s.parent_id IS NULL
     ORDER BY s.position`
  );

  for (const s of sections) {
    s.body_html = marked(s.body_md || '');
    s.votes = s.votes || [];
  }

  const lastUpdated = sections.reduce((latest, s) => {
    const d = new Date(s.updated_at);
    return d > latest ? d : latest;
  }, new Date(0)).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  res.render('plan', { sections, user: req.user, activeTab: 'plan', lastUpdated });
});

router.get('/section/:id', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM bizplan.sections WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Not found');
  const section = rows[0];
  section.body_html = marked(section.body_md || '');

  const { rows: votes } = await db.query(
    'SELECT * FROM bizplan.votes WHERE section_id = $1 ORDER BY created_at', [section.id]
  );
  section.votes = votes;

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

  const section = rows[0];
  section.body_html = marked(section.body_md || '');
  const { rows: votes } = await db.query(
    'SELECT * FROM bizplan.votes WHERE section_id = $1 ORDER BY created_at', [section.id]
  );
  section.votes = votes;

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
