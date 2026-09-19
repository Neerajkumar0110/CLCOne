const { runEntity } = require('./_entityDashboard');
const { kpi, ratio, chart, R, groupBy, sumBy, bucketCounts } = require('../shared');

const OPEN = ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation'];
const WON = 'Closed Won';
const LOST = 'Closed Lost';
const FUNNEL = ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', WON];
const STAGE_PROB = { Qualification: 10, 'Needs Analysis': 25, Proposal: 50, Negotiation: 75 };

const SELECT =
  '_id title account stage amount currency probability expectedRevenue closeDate owner source lossReason created';

const TABLE_COLUMNS = [
  { key: 'title', label: 'Deal' },
  { key: 'account', label: 'Account' },
  { key: 'stage', label: 'Stage' },
  { key: 'amount', label: 'Amount' },
  { key: 'probability', label: 'Probability' },
  { key: 'owner', label: 'Owner' },
  { key: 'source', label: 'Source' },
  { key: 'closeDate', label: 'Close date' },
  { key: 'ageDays', label: 'Age (d)', get: (r) => Math.round((Date.now() - new Date(r.created)) / 86400000) },
  { key: 'lossReason', label: 'Loss reason' },
];

const DRAWER = {
  stage: { field: 'stage', kind: 'in' },
  source: { field: 'source', kind: 'in' },
  owner: { field: 'owner', kind: 'in' },
  minAmount: { field: 'amount', kind: 'gte' },
};

function stats(rows) {
  const open = rows.filter((d) => OPEN.includes(d.stage));
  const won = rows.filter((d) => d.stage === WON);
  const lost = rows.filter((d) => d.stage === LOST);
  const sum = (a) => a.reduce((s, d) => s + (d.amount || 0), 0);
  const weighted = open.reduce(
    (s, d) => s + (d.amount || 0) * ((d.probability || STAGE_PROB[d.stage] || 0) / 100),
    0
  );
  const closed = won.length + lost.length;
  const ages = open.map((d) => (Date.now() - new Date(d.created)) / 86400000);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
  const cycles = won
    .filter((d) => d.closeDate)
    .map((d) => (new Date(d.closeDate) - new Date(d.created)) / 86400000)
    .filter((n) => n >= 0);
  const avgCycle = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;
  const neg = rows.filter((d) => d.stage === 'Negotiation' || d.stage === WON).length;
  return {
    total: rows.length,
    open: open.length,
    pipelineValue: sum(open),
    weightedValue: Math.round(weighted),
    won: won.length,
    wonValue: sum(won),
    lost: lost.length,
    lostValue: sum(lost),
    winRate: closed ? (won.length / closed) * 100 : 0,
    lossRate: closed ? (lost.length / closed) * 100 : 0,
    avgAge,
    avgCycle,
    negToWon: R(won.length, neg),
    closed,
  };
}

function summary(ctx) {
  return runEntity({
    ...ctx,
    modelName: 'SalesDeal',
    dateFields: { created: 'created', closeDate: 'closeDate' },
    select: SELECT,
    tableColumns: TABLE_COLUMNS,
    ownerField: 'owner',
    drawerSpec: DRAWER,
    facetFields: { sources: 'source', owners: 'owner', stages: 'stage' },
    compute: ({ cur, prev, bkt, dateField }) => {
      const c = stats(cur);
      const p = stats(prev);
      const openSeries = bucketCounts(cur.filter((d) => OPEN.includes(d.stage)), dateField, bkt);
      const wonSeries = bucketCounts(cur.filter((d) => d.stage === WON), dateField, bkt);
      const valSeries = bucketCounts(cur, dateField, bkt, (d) => d.amount || 0);

      const byStageVal = FUNNEL.concat(LOST).map((s) => ({
        label: s,
        value: cur.filter((d) => d.stage === s).reduce((x, d) => x + (d.amount || 0), 0),
      }));
      const bySource = groupBy(cur, (d) => d.source || 'Other');
      const byOwner = groupBy(cur, (d) => d.owner || '—');
      const lossReasons = groupBy(cur.filter((d) => d.stage === LOST), (d) => d.lossReason || 'Unknown');

      return {
        totals: c,
        kpis: [
          kpi('open', 'Open Deals', c.open, p.open, openSeries),
          kpi('pipelineValue', 'Pipeline Value', c.pipelineValue, p.pipelineValue, valSeries, { fmt: 'money' }),
          kpi('weightedValue', 'Weighted Value', c.weightedValue, p.weightedValue, [], { fmt: 'money' }),
          kpi('won', 'Won Deals', c.won, p.won, wonSeries),
          kpi('wonValue', 'Won Value', c.wonValue, p.wonValue, [], { fmt: 'money' }),
          kpi('lost', 'Lost Deals', c.lost, p.lost, [], { positiveWhenDown: true }),
          kpi('winRate', 'Win Rate', c.winRate, p.winRate, [], { fmt: 'pct' }),
          kpi('avgAge', 'Avg Deal Age', c.avgAge, p.avgAge, [], { fmt: 'days' }),
        ],
        ratios: [
          ratio('winRate', 'Win rate', R(c.won, c.closed), R(p.won, p.closed)),
          ratio('lossRate', 'Loss rate', R(c.lost, c.closed), R(p.lost, p.closed), { positiveWhenDown: true }),
          ratio('avgCycle', 'Avg cycle (days)', { value: c.avgCycle, numerator: Math.round(c.avgCycle), denominator: c.won }, null),
          ratio('negToWon', 'Negotiation → Won', c.negToWon, null),
        ],
        charts: {
          trend: chart(bkt.labels, [
            { label: 'Created', data: bucketCounts(cur, dateField, bkt) },
            { label: 'Won', data: wonSeries },
          ]),
          pipelineByStage: chart(byStageVal.map((x) => x.label), [{ label: 'Value', data: byStageVal.map((x) => x.value) }]),
          bySource: chart(bySource.map((x) => x.label), [{ label: 'Deals', data: bySource.map((x) => x.value) }]),
          byOwner: chart(byOwner.map((x) => x.label), [{ label: 'Deals', data: byOwner.map((x) => x.value) }]),
          lossReasons: chart(lossReasons.map((x) => x.label), [{ label: 'Lost', data: lossReasons.map((x) => x.value) }]),
        },
        funnel: FUNNEL.map((s) => ({
          key: s,
          label: s,
          value: cur.filter((d) => d.stage === s || (s === WON && d.stage === WON)).length,
        })),
      };
    },
  });
}

module.exports = { summary };
