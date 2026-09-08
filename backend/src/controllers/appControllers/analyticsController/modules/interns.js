const { runEntity } = require('./_entityDashboard');
const { kpi, ratio, chart, R, groupBy, bucketCounts } = require('../shared');

// "Interns" = LMS Students through an internship-progress lens.
const SELECT =
  '_id name email phone course batch status progress attendancePct avgScore feeStatus source counselor enrolledOn created';

const TABLE_COLUMNS = [
  { key: 'name', label: 'Intern' },
  { key: 'course', label: 'Course' },
  { key: 'batch', label: 'Batch' },
  { key: 'status', label: 'Status' },
  { key: 'progress', label: 'Progress %' },
  { key: 'attendancePct', label: 'Attendance %' },
  { key: 'avgScore', label: 'Avg score' },
  { key: 'enrolledOn', label: 'Start date' },
];

const DRAWER = {
  status: { field: 'status', kind: 'in' },
  course: { field: 'course', kind: 'in' },
  batch: { field: 'batch', kind: 'in' },
};

const STATUSES = ['Active', 'On Hold', 'Completed', 'Dropped', 'Deferred'];
const BUCKETS = [
  { label: '0–25%', lo: 0, hi: 25 },
  { label: '25–50%', lo: 25, hi: 50 },
  { label: '50–75%', lo: 50, hi: 75 },
  { label: '75–100%', lo: 75, hi: 101 },
];

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function stats(rows) {
  const by = (s) => rows.filter((r) => r.status === s);
  const completed = by('Completed').length;
  const dropped = by('Dropped').length;
  const active = by('Active').length;
  return {
    total: rows.length,
    active,
    completed,
    dropped,
    onHoldDeferred: by('On Hold').length + by('Deferred').length,
    avgProgress: avg(rows.map((r) => r.progress || 0)),
    avgAttendance: avg(rows.map((r) => r.attendancePct || 0)),
    avgScore: avg(rows.map((r) => r.avgScore || 0)),
    completionRate: R(completed, completed + dropped + active),
    dropRate: R(dropped, completed + dropped + active),
  };
}

function summary(ctx) {
  return runEntity({
    ...ctx,
    modelName: 'Student',
    dateFields: { created: 'created', enrolledOn: 'enrolledOn' },
    select: SELECT,
    tableColumns: TABLE_COLUMNS,
    drawerSpec: DRAWER,
    facetFields: { courses: 'course', batches: 'batch', statuses: 'status' },
    compute: ({ cur, prev, bkt, dateField }) => {
      const c = stats(cur);
      const p = stats(prev);
      const enrolSeries = bucketCounts(cur, dateField, bkt);
      const byStatus = STATUSES.map((s) => ({ label: s, value: cur.filter((r) => r.status === s).length }));
      const byCourse = groupBy(cur, (r) => r.course || 'Unassigned');
      const byBatch = groupBy(cur, (r) => r.batch || 'Unassigned');
      const progressDist = BUCKETS.map((b) => ({
        label: b.label,
        value: cur.filter((r) => (r.progress || 0) >= b.lo && (r.progress || 0) < b.hi).length,
      }));
      const attendanceDist = BUCKETS.map((b) => ({
        label: b.label,
        value: cur.filter((r) => (r.attendancePct || 0) >= b.lo && (r.attendancePct || 0) < b.hi).length,
      }));

      return {
        totals: c,
        kpis: [
          kpi('total', 'Total Interns', c.total, p.total, enrolSeries),
          kpi('active', 'Active', c.active, p.active, []),
          kpi('completed', 'Completed', c.completed, p.completed, []),
          kpi('dropped', 'Dropped', c.dropped, p.dropped, [], { positiveWhenDown: true }),
          kpi('avgProgress', 'Avg Progress', c.avgProgress, p.avgProgress, [], { fmt: 'pct' }),
          kpi('avgAttendance', 'Avg Attendance', c.avgAttendance, p.avgAttendance, [], { fmt: 'pct' }),
          kpi('avgScore', 'Avg Score', c.avgScore, p.avgScore, []),
          kpi('onHoldDeferred', 'On Hold + Deferred', c.onHoldDeferred, p.onHoldDeferred, [], { positiveWhenDown: true }),
        ],
        ratios: [
          ratio('completionRate', 'Completion rate', c.completionRate, p.completionRate),
          ratio('dropRate', 'Drop rate', c.dropRate, p.dropRate, { positiveWhenDown: true }),
          ratio('attendancePct', 'Attendance %', { value: c.avgAttendance / 100, numerator: Math.round(c.avgAttendance), denominator: 100 }, null),
          ratio('avgProgressPct', 'Avg progress %', { value: c.avgProgress / 100, numerator: Math.round(c.avgProgress), denominator: 100 }, null),
        ],
        charts: {
          trend: chart(bkt.labels, [{ label: 'Interns', data: enrolSeries }]),
          byStatus: chart(byStatus.map((x) => x.label), [{ label: 'Interns', data: byStatus.map((x) => x.value) }]),
          byCourse: chart(byCourse.map((x) => x.label), [{ label: 'Interns', data: byCourse.map((x) => x.value) }]),
          byBatch: chart(byBatch.map((x) => x.label), [{ label: 'Interns', data: byBatch.map((x) => x.value) }]),
          progressDist: chart(progressDist.map((x) => x.label), [{ label: 'Interns', data: progressDist.map((x) => x.value) }]),
          attendanceDist: chart(attendanceDist.map((x) => x.label), [{ label: 'Interns', data: attendanceDist.map((x) => x.value) }]),
        },
        funnel: [
          { key: 'enrolled', label: 'Enrolled', value: c.total },
          { key: 'active', label: 'Active', value: c.active },
          { key: 'half', label: 'Progress ≥ 50%', value: cur.filter((r) => (r.progress || 0) >= 50).length },
          { key: 'completed', label: 'Completed', value: c.completed },
        ],
      };
    },
  });
}

module.exports = { summary };
