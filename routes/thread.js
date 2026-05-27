const { Router } = require('express');
const db = require('../lib/db');
const { marked } = require('marked');

const router = Router();

router.get('/:sectionId', async (req, res) => {
  const { rows: sections } = await db.query(
    'SELECT * FROM bizplan.sections WHERE id = $1', [req.params.sectionId]
  );
  if (!sections.length) return res.status(404).send('Not found');
  const section = sections[0];
  section.body_html = marked(section.body_md || '');

  const { rows: entries } = await db.query(
    'SELECT * FROM bizplan.thread_entries WHERE section_id = $1 ORDER BY created_at',
    [req.params.sectionId]
  );
  for (const e of entries) {
    e.body_html = marked(e.body_md || '');
    e.avatarLetter = (e.author_name || e.author_email || '?')[0].toUpperCase();
    e.avatarHue = Array.from(e.author_email || '').reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
    e.bubbleClass = e.entry_type === 'accept' ? 'vote-accept' : e.entry_type === 'reject' ? 'vote-reject' : '';
    e.isMe = e.author_email === req.user.email;
    e.isActivity = e.entry_type === 'edit';
    e.alignClass = e.isActivity ? 'thread-activity' : e.isMe ? 'thread-mine' : 'thread-theirs';
  }

  const { rows: votes } = await db.query(
    'SELECT * FROM bizplan.votes WHERE section_id = $1 ORDER BY created_at',
    [req.params.sectionId]
  );

  const { rows: links } = await db.query(
    `SELECT l.*, s.title AS target_title
     FROM bizplan.section_links l
     JOIN bizplan.sections s ON s.id = l.target_id
     WHERE l.source_id = $1
     UNION ALL
     SELECT l.*, s.title AS target_title
     FROM bizplan.section_links l
     JOIN bizplan.sections s ON s.id = l.source_id
     WHERE l.target_id = $1`,
    [req.params.sectionId]
  );

  const { rows: history } = await db.query(
    'SELECT * FROM bizplan.section_history WHERE section_id = $1 ORDER BY version DESC LIMIT 10',
    [req.params.sectionId]
  );

  res.render('partials/thread', {
    section, entries, votes, links, history, user: req.user, layout: false
  });
});

router.post('/:sectionId/comment', async (req, res) => {
  // Check viewer comment permission
  if (req.user.role === 'viewer') {
    const settings = require('../lib/settings');
    const allowed = await settings.get('allow_viewer_comments');
    if (allowed === 'false') return res.status(403).send('Viewers cannot comment on this plan');
  }

  const { body_md } = req.body;
  if (!body_md || !body_md.trim()) return res.status(400).send('Comment required');

  await db.query(
    `INSERT INTO bizplan.thread_entries (section_id, author_email, author_name, entry_type, body_md)
     VALUES ($1, $2, $3, 'comment', $4)`,
    [req.params.sectionId, req.user.email, req.user.name, body_md]
  );

  res.set('HX-Trigger', 'threadUpdated').send('');
});

module.exports = router;
