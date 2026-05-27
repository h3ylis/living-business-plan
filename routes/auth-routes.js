const { Router } = require('express');
const db = require('../lib/db');
const { generateToken, setSessionCookie, clearSessionCookie, AUTH_MODE } = require('../lib/auth');
const { notify } = require('../lib/notify');
const settings = require('../lib/settings');

const router = Router();

// ─── Login page ───
router.get('/login', async (req, res) => {
  if (AUTH_MODE === 'dev') return res.redirect('/');
  const appName = await settings.get('app_name') || 'Exec';
  res.render('login', {
    appName,
    flash: req.query.msg || null,
    error: req.query.error || null,
    layout: false
  });
});

// ─── Send magic link ───
router.post('/login', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) return res.redirect('/login?error=Email is required');

  const trimmedEmail = email.trim().toLowerCase();
  const appName = await settings.get('app_name') || 'Exec';

  // Check if partner exists and is active
  const { rows: partners } = await db.query(
    'SELECT id, name FROM bizplan.partners WHERE email = $1 AND active = true',
    [trimmedEmail]
  );

  // Also check pending invites
  const { rows: invites } = await db.query(
    `SELECT id, token FROM bizplan.partner_invites
     WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [trimmedEmail]
  );

  if (!partners.length && !invites.length) {
    // Don't reveal whether email exists — just say "check your email"
    return res.redirect('/login?msg=If that email is registered, a login link has been sent.');
  }

  // If this is an invite acceptance, handle it
  let partnerId;
  if (invites.length && !partners.length) {
    // Accept the invite — create partner record
    const invite = invites[0];
    const { rows: newPartner } = await db.query(
      `INSERT INTO bizplan.partners (email, name, role, invited_by, accepted_at, active)
       SELECT $1, $1, 'partner', invited_by, now(), true FROM bizplan.partner_invites WHERE id = $2
       RETURNING id`,
      [trimmedEmail, invite.id]
    );
    await db.query(
      'UPDATE bizplan.partner_invites SET accepted_at = now() WHERE id = $1',
      [invite.id]
    );
    partnerId = newPartner[0].id;
  } else {
    partnerId = partners[0].id;
  }

  // Generate session token and send magic link
  const token = generateToken();
  await db.query(
    `INSERT INTO bizplan.sessions (token, partner_id, expires_at)
     VALUES ($1, $2, now() + interval '30 days')`,
    [token, partnerId]
  );

  const baseUrl = process.env.BASE_URL || 'http://localhost:8800';
  const magicLink = `${baseUrl}/auth/verify/${token}`;

  // Send email
  await notify({
    to: trimmedEmail,
    subject: `${appName} — Your login link`,
    html: `<p>Click the link below to sign in to <strong>${appName}</strong>:</p>
           <p><a href="${magicLink}" style="display:inline-block; padding:12px 24px; background:#1565c0; color:#fff; border-radius:6px; text-decoration:none; font-weight:600;">Sign in to ${appName}</a></p>
           <p style="color:#888; font-size:0.85rem;">This link expires in 30 days. If you didn't request this, ignore this email.</p>`,
    type: 'magic_link'
  });

  res.redirect('/login?msg=Check your email for a login link.');
});

// ─── Verify magic link token ───
router.get('/auth/verify/:token', async (req, res) => {
  const { token } = req.params;

  const { rows } = await db.query(
    `SELECT s.id, s.partner_id, p.email, p.name
     FROM bizplan.sessions s
     JOIN bizplan.partners p ON p.id = s.partner_id
     WHERE s.token = $1 AND s.expires_at > now() AND p.active = true`,
    [token]
  );

  if (!rows.length) {
    return res.redirect('/login?error=Invalid or expired link. Please request a new one.');
  }

  setSessionCookie(res, token);
  res.redirect('/');
});

// ─── Logout ───
router.post('/auth/logout', (req, res) => {
  const cookies = require('../lib/auth').parseCookies(req.headers.cookie);
  const token = cookies.exec_session;
  if (token) {
    db.query('DELETE FROM bizplan.sessions WHERE token = $1', [token]).catch(() => {});
  }
  clearSessionCookie(res);
  res.redirect('/login');
});

router.get('/auth/logout', (req, res) => {
  const cookies = require('../lib/auth').parseCookies(req.headers.cookie);
  const token = cookies.exec_session;
  if (token) {
    db.query('DELETE FROM bizplan.sessions WHERE token = $1', [token]).catch(() => {});
  }
  clearSessionCookie(res);
  res.redirect('/login');
});

module.exports = router;
