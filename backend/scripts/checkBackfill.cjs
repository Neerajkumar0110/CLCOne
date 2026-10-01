const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  for (const f of globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js'))) require(path.resolve(f));
  const Batch = mongoose.model('Batch');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const names = ['July 2026 6 to 7:30 PM', 'July 2026 8 to 9:30 PM', 'Aug 2026 4 to 5:30 PM'];
  for (const name of names) {
    const b = await Batch.findOne({ name, removed: false }).lean();
    if (!b) { console.log(name, '| NOT FOUND'); continue; }
    const total = await LmsLiveSession.countDocuments({ batch: b._id, removed: false });
    const byStatus = await LmsLiveSession.aggregate([
      { $match: { batch: b._id, removed: false } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const first = await LmsLiveSession.findOne({ batch: b._id, removed: false }).sort({ scheduledStart: 1 }).select('scheduledStart').lean();
    const last = await LmsLiveSession.findOne({ batch: b._id, removed: false }).sort({ scheduledStart: -1 }).select('scheduledStart').lean();
    console.log(name, '| total:', total, '| by status:', JSON.stringify(byStatus), '| range:', first && first.scheduledStart, '->', last && last.scheduledStart);
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
