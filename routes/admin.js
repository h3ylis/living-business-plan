const { Router } = require('express');
const db = require('../lib/db');
const settings = require('../lib/settings');
const { generateToken } = require('../lib/auth');
const { notify } = require('../lib/notify');

const router = Router();

// Admin-only guard
router.use((req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).send('Admin access required');
  next();
});

// ─── Admin dashboard ───
router.get('/', async (req, res) => {
  const { rows: partners } = await db.query(
    'SELECT * FROM bizplan.partners ORDER BY created_at'
  );
  const { rows: pendingInvites } = await db.query(
    'SELECT * FROM bizplan.partner_invites WHERE accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC'
  );

  const allSettings = await settings.getAll();

  // Count vote-eligible partners for consensus display
  const eligible = partners.filter(p => p.active && p.role !== 'viewer').length;
  let consensusDisplay;
  if (allSettings.consensus_mode === 'manual') {
    consensusDisplay = allSettings.consensus_threshold;
  } else if (eligible <= 1) {
    consensusDisplay = '1';
  } else if (eligible === 2) {
    consensusDisplay = '2 (unanimous)';
  } else {
    consensusDisplay = Math.ceil(eligible / 2) + 1 + ' of ' + eligible;
  }

  res.render('admin', {
    partners, pendingInvites, settings: allSettings,
    consensusDisplay, eligibleCount: eligible,
    user: req.user, activeTab: 'admin', pageTitle: 'Admin'
  });
});

// ─── Invite partner ───
router.post('/partners/invite', async (req, res) => {
  const { email, name } = req.body;
  if (!email || !email.trim()) return res.status(400).send('Email is required');
  const trimmedEmail = email.trim().toLowerCase();

  // Check if already a partner
  const { rows: existing } = await db.query(
    'SELECT id FROM bizplan.partners WHERE email = $1', [trimmedEmail]
  );
  if (existing.length) return res.status(400).send('Already a partner');

  // Check for pending invite
  const { rows: pending } = await db.query(
    'SELECT id FROM bizplan.partner_invites WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()',
    [trimmedEmail]
  );
  if (pending.length) return res.status(400).send('Invite already pending');

  const token = generateToken();
  await db.query(
    `INSERT INTO bizplan.partner_invites (email, token, invited_by, expires_at)
     VALUES ($1, $2, $3, now() + interval '7 days')`,
    [trimmedEmail, token, req.user.id]
  );

  // Send invite email
  const appName = await settings.get('app_name') || 'Exec';
  const baseUrl = process.env.BASE_URL || 'http://localhost:8800';
  const inviteLink = `${baseUrl}/login?email=${encodeURIComponent(trimmedEmail)}`;

  await notify({
    to: trimmedEmail,
    subject: `${appName} — You've been invited to collaborate`,
    html: `<p><strong>${req.user.name}</strong> has invited you to collaborate on <strong>${appName}</strong>.</p>
           <p><a href="${inviteLink}" style="display:inline-block; padding:12px 24px; background:#1565c0; color:#fff; border-radius:6px; text-decoration:none; font-weight:600;">Accept Invitation</a></p>
           <p style="color:#888; font-size:0.85rem;">This invitation expires in 7 days.</p>`,
    type: 'partner_invite'
  }).catch(() => {});

  res.set('HX-Trigger', 'partnersUpdated').send('');
});

// ─── Add partner directly (admin bypass — no invite needed) ───
router.post('/partners/add', async (req, res) => {
  const { email, name, role } = req.body;
  if (!email || !email.trim()) return res.status(400).send('Email is required');
  const trimmedEmail = email.trim().toLowerCase();
  const partnerRole = ['admin', 'partner', 'viewer'].includes(role) ? role : 'partner';

  const { rows: existing } = await db.query(
    'SELECT id FROM bizplan.partners WHERE email = $1', [trimmedEmail]
  );
  if (existing.length) return res.status(400).send('Already a partner');

  await db.query(
    `INSERT INTO bizplan.partners (email, name, role, invited_by, accepted_at, active)
     VALUES ($1, $2, $3, $4, now(), true)`,
    [trimmedEmail, (name || '').trim() || trimmedEmail.split('@')[0], partnerRole, req.user.id]
  );

  res.set('HX-Trigger', 'partnersUpdated').send('');
});

// ─── Update partner role ───
router.post('/partners/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'partner', 'viewer'].includes(role)) return res.status(400).send('Invalid role');

  // Prevent removing the last admin
  if (role !== 'admin') {
    const { rows: admins } = await db.query(
      "SELECT id FROM bizplan.partners WHERE role = 'admin' AND active = true AND id != $1",
      [req.params.id]
    );
    if (admins.length === 0) {
      return res.status(400).send('Cannot remove the last admin');
    }
  }

  await db.query(
    'UPDATE bizplan.partners SET role = $1 WHERE id = $2',
    [role, req.params.id]
  );
  res.set('HX-Trigger', 'partnersUpdated').send('');
});

// ─── Deactivate partner ───
router.post('/partners/:id/deactivate', async (req, res) => {
  // Prevent deactivating self
  if (req.params.id === req.user.id) {
    return res.status(400).send('Cannot deactivate yourself');
  }
  // Prevent deactivating the last admin
  const { rows: target } = await db.query(
    'SELECT role FROM bizplan.partners WHERE id = $1', [req.params.id]
  );
  if (target[0]?.role === 'admin') {
    const { rows: admins } = await db.query(
      "SELECT id FROM bizplan.partners WHERE role = 'admin' AND active = true AND id != $1",
      [req.params.id]
    );
    if (admins.length === 0) return res.status(400).send('Cannot deactivate the last admin');
  }

  await db.query('UPDATE bizplan.partners SET active = false WHERE id = $1', [req.params.id]);
  res.set('HX-Trigger', 'partnersUpdated').send('');
});

// ─── Activate partner ───
router.post('/partners/:id/activate', async (req, res) => {
  await db.query('UPDATE bizplan.partners SET active = true WHERE id = $1', [req.params.id]);
  res.set('HX-Trigger', 'partnersUpdated').send('');
});

// ─── Update partner name ───
router.post('/partners/:id/name', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).send('Name is required');
  await db.query('UPDATE bizplan.partners SET name = $1 WHERE id = $2', [name.trim(), req.params.id]);
  res.set('HX-Trigger', 'partnersUpdated').send('');
});

// ─── Update settings ───
router.post('/settings', async (req, res) => {
  const allowed = [
    'app_name', 'document_title', 'accent_color',
    'consensus_mode', 'consensus_threshold',
    'lock_approved', 'vote_reset_on_edit', 'allow_viewer_comments'
  ];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  // Checkboxes: if not in body, they're unchecked
  for (const checkbox of ['lock_approved', 'vote_reset_on_edit', 'allow_viewer_comments']) {
    if (!(checkbox in updates)) {
      updates[checkbox] = 'false';
    }
  }

  await settings.setMany(updates, req.user.id);
  res.set('HX-Trigger', 'settingsUpdated').redirect('/admin');
});

// ─── Partners list partial (for HTMX refresh) ───
router.get('/partners', async (req, res) => {
  const { rows: partners } = await db.query(
    'SELECT * FROM bizplan.partners ORDER BY created_at'
  );
  const { rows: pendingInvites } = await db.query(
    'SELECT * FROM bizplan.partner_invites WHERE accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC'
  );
  res.render('partials/partner-list', { partners, pendingInvites, user: req.user, layout: false });
});

module.exports = router;
