const db = require('./db');
const crypto = require('crypto');

const AUTH_MODE = process.env.AUTH_MODE || 'dev';
const PUBLIC_PATHS = ['/login', '/auth/', '/static/', '/mockup', '/favicon'];

// ─── Cookie helpers (no dependency needed) ───
function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `exec_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `exec_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

// ─── Bootstrap: ensure admin partner exists ───
async function bootstrap() {
  const email = process.env.DEV_USER_EMAIL;
  const name = process.env.DEV_USER_NAME || 'Admin';
  if (!email) return;

  const { rows } = await db.query(
    'SELECT id FROM bizplan.partners WHERE email = $1', [email]
  );
  if (rows.length === 0) {
    await db.query(
      `INSERT INTO bizplan.partners (email, name, role, accepted_at, active)
       VALUES ($1, $2, 'admin', now(), true)`,
      [email, name]
    );
    console.log(`Bootstrapped admin partner: ${email}`);
  }

  // Also seed any PARTNER_EMAILS that aren't yet in the table (migration helper)
  const partnerEmails = (process.env.PARTNER_EMAILS || '').split(',').filter(Boolean);
  for (const pe of partnerEmails) {
    const trimmed = pe.trim();
    if (trimmed === email) continue;
    const { rows: existing } = await db.query(
      'SELECT id FROM bizplan.partners WHERE email = $1', [trimmed]
    );
    if (existing.length === 0) {
      await db.query(
        `INSERT INTO bizplan.partners (email, name, role, accepted_at, active)
         VALUES ($1, $2, 'partner', now(), true)`,
        [trimmed, trimmed.split('@')[0]]
      );
    }
  }
}

// ─── Auth strategies ───
async function devAuth(req, res, next) {
  const email = process.env.DEV_USER_EMAIL || 'dev@localhost';
  const name = process.env.DEV_USER_NAME || 'Dev';

  const { rows } = await db.query(
    'SELECT id, email, name, role FROM bizplan.partners WHERE email = $1 AND active = true',
    [email]
  );

  if (rows.length) {
    req.user = { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role };
  } else {
    // Fallback if partner record not found (shouldn't happen after bootstrap)
    req.user = { id: null, email, name, role: 'admin' };
  }
  req.user.isAdmin = req.user.role === 'admin';
  next();
}

async function magicLinkAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.exec_session;

  if (!token) return res.redirect('/login');

  const { rows } = await db.query(
    `SELECT p.id, p.email, p.name, p.role
     FROM bizplan.sessions s
     JOIN bizplan.partners p ON p.id = s.partner_id
     WHERE s.token = $1 AND s.expires_at > now() AND p.active = true`,
    [token]
  );

  if (!rows.length) {
    clearSessionCookie(res);
    return res.redirect('/login');
  }

  req.user = { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role };
  req.user.isAdmin = req.user.role === 'admin';
  next();
}

async function proxyAuth(req, res, next) {
  const email = req.headers['remote-email'];
  if (!email) return res.status(401).send('Not authenticated');

  const { rows } = await db.query(
    'SELECT id, email, name, role FROM bizplan.partners WHERE email = $1 AND active = true',
    [email]
  );

  if (!rows.length) {
    return res.status(403).send('You are not a registered partner. Contact an admin for access.');
  }

  req.user = { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role };
  // Update name from proxy header if it differs
  const proxyName = req.headers['remote-name'];
  if (proxyName && proxyName !== rows[0].name) {
    await db.query('UPDATE bizplan.partners SET name = $1 WHERE id = $2', [proxyName, rows[0].id]);
    req.user.name = proxyName;
  }
  req.user.isAdmin = req.user.role === 'admin';
  next();
}

// ─── Middleware ───
async function authMiddleware(req, res, next) {
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();

  try {
    switch (AUTH_MODE) {
      case 'dev': return await devAuth(req, res, next);
      case 'magic-link': return await magicLinkAuth(req, res, next);
      case 'proxy': return await proxyAuth(req, res, next);
      default: return await devAuth(req, res, next);
    }
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).send('Authentication error');
  }
}

// ─── Token generation ───
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = authMiddleware;
module.exports.bootstrap = bootstrap;
module.exports.generateToken = generateToken;
module.exports.setSessionCookie = setSessionCookie;
module.exports.clearSessionCookie = clearSessionCookie;
module.exports.parseCookies = parseCookies;
module.exports.AUTH_MODE = AUTH_MODE;
