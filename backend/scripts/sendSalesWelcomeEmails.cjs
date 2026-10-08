/* One-off backfill: send the Sales welcome email (login email + OTP login
 * URL — see src/services/sales/salesWelcomeEmail.js) to every Sales-pipeline
 * Admin account that already existed before that email was wired into
 * account creation (createUserController/create.js).
 *
 * Safe to re-run — skips any user whose email already has a 'sent' row in
 * EmailDeliveryLog for this exact subject, so it won't double-send.
 * Usage (from backend/):  node scripts/sendSalesWelcomeEmails.cjs
 */
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to send.');
    process.exit(1);
  }
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error('GMAIL_USER / GMAIL_APP_PASSWORD are not set — email sending is not configured.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  // Admin lives in the 'coreDb' logical database — must install multi-db
  // routing first, exactly like server.js does, or the query below silently
  // hits the wrong (empty) db.
  require('../src/config/multiDb').installMultiDbRouting();
  const Admin = require('../src/models/coreModels/Admin');
  const EmailDeliveryLog = require('../src/models/appModels/lms/EmailDeliveryLog');
  const { SALES_ROLES } = require('../src/config/roles');
  const { sendSalesWelcomeEmail } = require('../src/services/sales/salesWelcomeEmail');

  const SUBJECT = 'Your CRM account is ready — login details inside';

  const salesUsers = await Admin.find({ role: { $in: SALES_ROLES }, removed: false, enabled: true }).lean();
  console.log(`Found ${salesUsers.length} Sales-pipeline Admin account(s) (roles: ${SALES_ROLES.join(', ')}).`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of salesUsers) {
    const email = String(user.email || '').trim().toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }

    const already = await EmailDeliveryLog.findOne({ recipient: email, subject: SUBJECT, status: 'sent' }).lean();
    if (already) {
      console.log(`  skip (already sent): ${email}`);
      skipped++;
      continue;
    }

    try {
      const result = await sendSalesWelcomeEmail(user);
      if (result && result.sent) {
        console.log(`  sent: ${email} (${user.role})`);
        sent++;
      } else {
        console.log(`  not sent (${JSON.stringify(result)}): ${email}`);
        failed++;
      }
    } catch (e) {
      console.error(`  failed: ${email} —`, e.message);
      failed++;
    }
  }

  console.log(`\nDone. sent=${sent} skipped=${skipped} failed=${failed}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
