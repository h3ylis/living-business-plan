const { Router } = require('express');
const db = require('../lib/db');

const router = Router();

router.get('/', async (req, res) => {
  const { rows: needsReview } = await db.query(
    `SELECT s.* FROM bizplan.sections s
     WHERE s.status IN ('draft', 'under_review')
       AND s.id NOT IN (SELECT section_id FROM bizplan.votes WHERE voter_email = $1)
     ORDER BY s.updated_at DESC`,
    [req.user.email]
  );

  const { rows: recentActivity } = await db.query(
    `SELECT te.*, s.title AS section_title
     FROM bizplan.thread_entries te
     JOIN bizplan.sections s ON s.id = te.section_id
     ORDER BY te.created_at DESC LIMIT 20`
  );

  const { rows: stats } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'approved' OR status = 'approved_with_objection') AS approved,
       COUNT(*) FILTER (WHERE status = 'under_review') AS under_review,
       COUNT(*) FILTER (WHERE status = 'draft') AS draft,
       COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
       COUNT(*) AS total
     FROM bizplan.sections`
  );

  res.render('dashboard', {
    needsReview, recentActivity, stats: stats[0], user: req.user,
    needsReviewCount: needsReview.length,
    activeTab: 'home', pageTitle: 'Dashboard'
  });
});

module.exports = router;
