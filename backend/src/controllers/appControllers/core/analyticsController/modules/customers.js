const { runEntity } = require('./_entityDashboard');
const { kpi, ratio, chart, R, groupBy, bucketCounts } = require('../shared');

// "Customers" = LMS Students seen through a revenue / retention lens
// (fees, course value, churn). Same source model as the Interns dashboard,
// different KPIs.
const SELECT =
  '_id name email phone city course batch status progress attendancePct avgScore feeTotal feeGrandTotal feePaid feeDue feeStatus source counselor enrolledOn created';

const TABLE_COLUMNS = [
  { key: 'name', label: 'Customer' },
  { key: 'course', label: 'Course' },
  { key: 'batch', label: 'Batch' },
  { key: 'status', label: 'Status' },
  { key: 'feePaid', label: 'Fee paid' },
  // GST-inclusive real total (what the student actually owes in total) —
  // feeTotal on the Student doc is the pre-GST base amount, which made
  // "Fee total"/"Fee Outstanding" understate reality by ~18%; feeGrandTotal
  // is the same field the enrollment email/receipt and student portal
  // already show as the real total (see studentProvision.js's
  // feeFieldsFromPlan), so this now matches everywhere the student sees it.
  { key: 'feeTotal', label: 'Fee total', get: (r) => r.feeGrandTotal ?? r.feeTotal },
  { key: 'feeDue', label: 'Fee due' },
  { key: 'feeStatus', label: 'Fee status' },
  { key: 'counselor', label: 'Counsellor' },
  { key: 'enrolledOn', label: 'Enrolled' },
];

const DRAWER = {
  status: { field: 'status', kind: 'in' },
  course: { field: 'course', kind: 'in' },
  feeStatus: { field: 'feeStatus', kind: 'in' },
  counselor: { field: 'counselor', kind: 'in' },
};

const FEE_STATUSES = ['Paid', 'Partial', 'Unpaid', 'Waived'];

// GST-inclusive real total for one row — feeGrandTotal when a plan/payment
// has actually set it, falling back to the pre-GST feeTotal for any record
// that predates it (e.g. one added by hand from the LMS Students tab,
// never through a PaymentRequest) rather than showing 0.
const grandTotalOf = (r) => (r.feeGrandTotal != null ? r.feeGrandTotal : r.feeTotal) || 0;

function stats(rows) {
  const by = (s) => rows.filter((r) => r.status === s);
  const feePaid = rows.reduce((s, r) => s + (r.feePaid || 0), 0);
  const feeTotal = rows.reduce((s, r) => s + grandTotalOf(r), 0);
  // feeDue is already computed per-row (feeFieldsFromPlan in
  // studentProvision.js) against the real GST-inclusive total — summing it
  // directly keeps this in lockstep with what the student's own portal/
  // receipt shows, rather than re-deriving it here and risking drift.
  const feeOutstanding = rows.reduce((s, r) => s + Math.max(0, r.feeDue != null ? r.feeDue : grandTotalOf(r) - (r.feePaid || 0)), 0);
  return {
    total: rows.length,
    active: by('Active').length,
    completed: by('Completed').length,
    dropped: by('Dropped').length,
    feePaid,
    feeOutstanding,
    feeTotal,
    avgFee: rows.length ? feeTotal / rows.length : 0,
    feeRealisation: R(feePaid, feeTotal),
    retention: R(rows.length - by('Dropped').length, rows.length),
  };
}

function summary(ctx) {
  return runEntity({
    ...ctx,
    modelName: 'Student',
    dateFields: { created: 'created', enrolledOn: 'enrolledOn' },
    select: SELECT,
    tableColumns: TABLE_COLUMNS,
    ownerField: 'counselor',
    ownerFacetKey: 'counsellors',
    drawerSpec: DRAWER,
    facetFields: { courses: 'course', counsellors: 'counselor', statuses: 'status' },
    compute: ({ cur, prev, bkt, dateField }) => {
      const c = stats(cur);
      const p = stats(prev);
      const enrolSeries = bucketCounts(cur, dateField, bkt);
      const paidSeries = bucketCounts(cur, dateField, bkt, (r) => r.feePaid || 0);
      const outSeries = bucketCounts(cur, dateField, bkt, (r) => Math.max(0, r.feeDue != null ? r.feeDue : grandTotalOf(r) - (r.feePaid || 0)));
      const byCourse = groupBy(cur, (r) => r.course || 'Unassigned');
      const byStatus = ['Active', 'On Hold', 'Completed', 'Dropped', 'Deferred'].map((s) => ({
        label: s,
        value: cur.filter((r) => r.status === s).length,
      }));
      const byCounsellor = groupBy(cur, (r) => r.counselor || '—');

      return {
        totals: c,
        kpis: [
          kpi('total', 'Candidates', c.total, p.total, enrolSeries),
          kpi('active', 'Active', c.active, p.active, []),
          kpi('completed', 'Completed', c.completed, p.completed, []),
          kpi('dropped', 'Dropped', c.dropped, p.dropped, [], { positiveWhenDown: true }),
          kpi('feePaid', 'Fee Collected', c.feePaid, p.feePaid, paidSeries, { fmt: 'money' }),
          kpi('feeOutstanding', 'Fee Outstanding', c.feeOutstanding, p.feeOutstanding, outSeries, { fmt: 'money', positiveWhenDown: true }),
          kpi('avgFee', 'Avg Fee / Candidate', c.avgFee, p.avgFee, [], { fmt: 'money' }),
          kpi('feeRealisationPct', 'Fee Realisation', c.feeRealisation.value * 100, p.feeRealisation.value * 100, [], { fmt: 'pct' }),
        ],
        ratios: [
          ratio('feeRealisation', 'Fee realisation', c.feeRealisation, p.feeRealisation),
          ratio('retention', 'Retention', c.retention, p.retention),
          ratio('activePct', 'Active %', R(c.active, c.total), R(p.active, p.total)),
        ],
        charts: {
          trend: chart(bkt.labels, [{ label: 'Enrolments', data: enrolSeries }]),
          feeByMonth: chart(bkt.labels, [
            { label: 'Collected', data: paidSeries },
            { label: 'Outstanding', data: outSeries },
          ]),
          byCourse: chart(byCourse.map((x) => x.label), [{ label: 'Candidates', data: byCourse.map((x) => x.value) }]),
          byStatus: chart(byStatus.map((x) => x.label), [{ label: 'Candidates', data: byStatus.map((x) => x.value) }]),
          byCounsellor: chart(byCounsellor.map((x) => x.label), [{ label: 'Candidates', data: byCounsellor.map((x) => x.value) }]),
        },
        funnel: FEE_STATUSES.map((s) => ({
          key: s,
          label: s,
          value: cur.filter((r) => r.feeStatus === s).length,
        })),
      };
    },
  });
}

module.exports = { summary };
