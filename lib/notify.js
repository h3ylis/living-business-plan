const nodemailer = require('nodemailer');
const db = require('./db');

let transporter = null;

function init() {
  if (!process.env.SMTP_HOST) return;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function notify({ to, subject, html, sectionId, threadEntryId, type, deepLink }) {
  const link = deepLink || `${process.env.BASE_URL || 'http://localhost:8800'}/plan#section-${sectionId}`;

  await db.query(
    `INSERT INTO bizplan.notifications (recipient_email, section_id, thread_entry_id, notification_type, deep_link, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [to, sectionId || null, threadEntryId || null, type, link, transporter ? new Date() : null]
  );

  if (!transporter) return;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'exec@localhost',
    to,
    subject,
    html: html + `<p style="margin-top:20px"><a href="${link}">View in Exec</a></p>`
  });
}

async function notifyOthers({ excludeEmail, subject, html, sectionId, threadEntryId, type }) {
  // Use partners table instead of PARTNER_EMAILS env var
  try {
    const { rows: partners } = await db.query(
      "SELECT email FROM bizplan.partners WHERE active = true AND role IN ('admin', 'partner') AND email != $1",
      [excludeEmail]
    );
    for (const p of partners) {
      await notify({ to: p.email, subject, html, sectionId, threadEntryId, type });
    }
  } catch {
    // Fallback to env var if partners table doesn't exist
    const partnerEmails = (process.env.PARTNER_EMAILS || '').split(',').filter(Boolean);
    for (const email of partnerEmails) {
      if (email.trim() !== excludeEmail) {
        await notify({ to: email.trim(), subject, html, sectionId, threadEntryId, type });
      }
    }
  }
}

module.exports = { init, notify, notifyOthers };
