/* Add the per-place logo Setting rows to an existing database.
 *
 * setup/defaultSettings/companySettings.json only seeds a fresh install, so
 * a running deployment needs these inserted once. Without the row,
 * settingController.updateBySettingKey finds nothing to update (it does not
 * upsert) and the upload silently does nothing.
 *
 * Each slot starts empty, which the frontend reads as "use the logo bundled
 * with the build" (config/logoSlots.js) — so nothing changes visually until
 * someone actually uploads one.
 *
 * Idempotent.
 *
 * Usage (from backend/):
 *   node scripts/seedLogoSlots.cjs            (dry run)
 *   node scripts/seedLogoSlots.cjs --apply
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const APPLY = process.argv.includes('--apply');

const SLOTS = [
  'logo_sidebar_expanded',
  'logo_sidebar_collapsed',
  'logo_login',
  'logo_public',
];

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  const files = globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js').split(String.fromCharCode(92)).join('/'));
  for (const f of files) require(path.resolve(f));

  const Setting = mongoose.model('Setting');
  console.log(APPLY ? 'APPLYING' : 'DRY RUN');

  for (const key of SLOTS) {
    const existing = await Setting.findOne({ settingKey: key }).lean();
    if (existing) {
      console.log(`  ${key.padEnd(24)} already present (value: ${existing.settingValue || '(empty — using bundled logo)'})`);
      continue;
    }
    console.log(`  ${key.padEnd(24)} MISSING -> will create`);
    if (APPLY) {
      await Setting.create({
        settingCategory: 'company_settings',
        settingKey: key,
        settingValue: '',
        valueType: 'image',
        isCoreSetting: false,
      });
    }
  }

  // company_logo already exists on every install; report it for completeness.
  const legacy = await Setting.findOne({ settingKey: 'company_logo' }).lean();
  console.log(`  ${'company_logo'.padEnd(24)} ${legacy ? 'present' : 'MISSING'} (invoices/PDFs)`);

  if (!APPLY) console.log('\nNothing written. Re-run with --apply.');
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
