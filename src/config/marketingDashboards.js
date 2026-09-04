// ── Marketing Analytics Hub — the full dashboard tree ──────────────────
// One config drives all ~60 dashboards. Each leaf has:
//   key         unique id (used in the URL + MarketingMetric.dashboardKey)
//   label       display name
//   region      'India' | 'USA' | null   (filter default)
//   source      one of DATA_SOURCES — how the leaf gets its numbers:
//                 'leads'     → computed from CRM Lead data (by channel + region/team)
//                 'campaigns' → computed from the `campaign` model
//                 'manual'    → entered monthly via the metrics form; ratios
//                               are derived from those inputs (see `template`)
//   template    (manual only) which METRIC_TEMPLATES entry defines its inputs + ratios
//   channel     (leads only) which lead `source` values roll up here
//
// India/USA + B2B/B2C + Human/AI/Combined System filters apply to every leaf
// (System via Team classification — see config/salesSystems.js).

const DATA_SOURCES = ['leads', 'campaigns', 'manual'];

// Lead `source` → channel bucket (for the Global Leads Platform family).
const CHANNEL_SOURCES = {
  ppc: ['Google Ads', 'PPC', 'Google', 'Search Ads', 'Bing Ads'],
  meta: ['Facebook Ads', 'Meta', 'Facebook', 'Instagram Ads', 'Instagram'],
  linkedin: ['LinkedIn Ads', 'LinkedIn'],
  youtube: ['YouTube', 'Youtube', 'YouTube Ads'],
  gmb: ['GMB', 'Google My Business', 'Google Business Profile', 'Maps'],
  other: [], // everything not matched above
};

// ── metric templates: inputs the user types + ratios derived from them ──
// kind: number | currency | percent | ratio   ·   input: shown in the form
// derived ratios reference input keys with {curly} placeholders in `formula`
// (a tiny safe expression: + - * / and the keys).
const METRIC_TEMPLATES = {
  visibility: {
    inputs: [
      { key: 'impressions', label: 'Impressions', kind: 'number' },
      { key: 'clicks', label: 'Clicks', kind: 'number' },
      { key: 'avgPosition', label: 'Avg Position', kind: 'number' },
      { key: 'keywordsRanked', label: 'Keywords Ranked', kind: 'number' },
      { key: 'traffic', label: 'Organic Traffic', kind: 'number' },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'enrolled', label: 'Enrolled', kind: 'number' },
      { key: 'spend', label: 'Spend', kind: 'currency' },
      { key: 'revenue', label: 'Revenue', kind: 'currency' },
    ],
    ratios: [
      { key: 'ctr', label: 'CTR', kind: 'percent', formula: '{clicks}/{impressions}' },
      { key: 'clickToLead', label: 'Click → Lead', kind: 'percent', formula: '{leads}/{clicks}' },
      { key: 'trafficToLead', label: 'Traffic → Lead', kind: 'percent', formula: '{leads}/{traffic}' },
      { key: 'leadToEnrolled', label: 'Lead → Enrolled', kind: 'percent', formula: '{enrolled}/{leads}' },
      { key: 'cpl', label: 'Cost / Lead', kind: 'currency', formula: '{spend}/{leads}' },
      { key: 'cac', label: 'CAC', kind: 'currency', formula: '{spend}/{enrolled}' },
      { key: 'roas', label: 'ROAS', kind: 'ratio', formula: '{revenue}/{spend}' },
      { key: 'roi', label: 'ROI', kind: 'percent', formula: '({revenue}-{spend})/{spend}' },
    ],
  },
  webAnalytics: {
    inputs: [
      { key: 'sessions', label: 'Sessions', kind: 'number' },
      { key: 'users', label: 'Users', kind: 'number' },
      { key: 'newUsers', label: 'New Users', kind: 'number' },
      { key: 'bounceRate', label: 'Bounce Rate %', kind: 'number' },
      { key: 'avgSessionSec', label: 'Avg Session (sec)', kind: 'number' },
      { key: 'pageViews', label: 'Page Views', kind: 'number' },
      { key: 'conversions', label: 'Conversions (leads)', kind: 'number' },
      { key: 'enrolled', label: 'Enrolled', kind: 'number' },
    ],
    ratios: [
      { key: 'pagesPerSession', label: 'Pages / Session', kind: 'ratio', formula: '{pageViews}/{sessions}' },
      { key: 'newUserShare', label: 'New User Share', kind: 'percent', formula: '{newUsers}/{users}' },
      { key: 'convRate', label: 'Conversion Rate', kind: 'percent', formula: '{conversions}/{sessions}' },
      { key: 'leadToEnrolled', label: 'Lead → Enrolled', kind: 'percent', formula: '{enrolled}/{conversions}' },
      { key: 'sessionsPerUser', label: 'Sessions / User', kind: 'ratio', formula: '{sessions}/{users}' },
    ],
  },
  orm: {
    inputs: [
      { key: 'reviews', label: 'Reviews (new)', kind: 'number' },
      { key: 'ratingSum', label: 'Sum of Ratings', kind: 'number' },
      { key: 'positive', label: 'Positive', kind: 'number' },
      { key: 'negative', label: 'Negative', kind: 'number' },
      { key: 'responded', label: 'Responded', kind: 'number' },
      { key: 'negativeResolved', label: 'Negative Resolved', kind: 'number' },
      { key: 'avgResponseHrs', label: 'Avg Response (hrs)', kind: 'number' },
    ],
    ratios: [
      { key: 'avgRating', label: 'Avg Rating', kind: 'ratio', formula: '{ratingSum}/{reviews}' },
      { key: 'positiveShare', label: 'Positive Share', kind: 'percent', formula: '{positive}/{reviews}' },
      { key: 'responseRate', label: 'Response Rate', kind: 'percent', formula: '{responded}/{reviews}' },
      { key: 'negativeResolutionRate', label: 'Negative Resolution', kind: 'percent', formula: '{negativeResolved}/{negative}' },
    ],
  },
  social: {
    inputs: [
      { key: 'followers', label: 'Followers', kind: 'number' },
      { key: 'followerGrowth', label: 'Follower Growth', kind: 'number' },
      { key: 'posts', label: 'Posts', kind: 'number' },
      { key: 'reach', label: 'Reach', kind: 'number' },
      { key: 'impressions', label: 'Impressions', kind: 'number' },
      { key: 'engagements', label: 'Engagements', kind: 'number' },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'enrolled', label: 'Enrolled', kind: 'number' },
      { key: 'spend', label: 'Spend', kind: 'currency' },
      { key: 'revenue', label: 'Revenue', kind: 'currency' },
    ],
    ratios: [
      { key: 'engagementRate', label: 'Engagement Rate', kind: 'percent', formula: '{engagements}/{reach}' },
      { key: 'reachPerPost', label: 'Reach / Post', kind: 'ratio', formula: '{reach}/{posts}' },
      { key: 'leadPerPost', label: 'Leads / Post', kind: 'ratio', formula: '{leads}/{posts}' },
      { key: 'cpl', label: 'Cost / Lead', kind: 'currency', formula: '{spend}/{leads}' },
      { key: 'roas', label: 'ROAS', kind: 'ratio', formula: '{revenue}/{spend}' },
      { key: 'roi', label: 'ROI', kind: 'percent', formula: '({revenue}-{spend})/{spend}' },
    ],
  },
  blogDA: {
    inputs: [
      { key: 'domainAuthority', label: 'Domain Authority', kind: 'number' },
      { key: 'backlinks', label: 'Backlinks', kind: 'number' },
      { key: 'referringDomains', label: 'Referring Domains', kind: 'number' },
      { key: 'blogsPublished', label: 'Blogs Published', kind: 'number' },
      { key: 'blogTraffic', label: 'Blog Traffic', kind: 'number' },
      { key: 'blogLeads', label: 'Blog Leads', kind: 'number' },
      { key: 'spend', label: 'Spend', kind: 'currency' },
    ],
    ratios: [
      { key: 'backlinksPerBlog', label: 'Backlinks / Blog', kind: 'ratio', formula: '{backlinks}/{blogsPublished}' },
      { key: 'trafficPerBlog', label: 'Traffic / Blog', kind: 'ratio', formula: '{blogTraffic}/{blogsPublished}' },
      { key: 'blogTrafficToLead', label: 'Blog Traffic → Lead', kind: 'percent', formula: '{blogLeads}/{blogTraffic}' },
      { key: 'cpl', label: 'Cost / Blog Lead', kind: 'currency', formula: '{spend}/{blogLeads}' },
    ],
  },
  content: {
    inputs: [
      { key: 'piecesPlanned', label: 'Pieces Planned', kind: 'number' },
      { key: 'piecesPublished', label: 'Pieces Published', kind: 'number' },
      { key: 'onTime', label: 'Published On Time', kind: 'number' },
      { key: 'views', label: 'Total Views', kind: 'number' },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'spend', label: 'Spend', kind: 'currency' },
    ],
    ratios: [
      { key: 'completionRate', label: 'Completion Rate', kind: 'percent', formula: '{piecesPublished}/{piecesPlanned}' },
      { key: 'onTimeRate', label: 'On-time Rate', kind: 'percent', formula: '{onTime}/{piecesPublished}' },
      { key: 'viewsPerPiece', label: 'Views / Piece', kind: 'ratio', formula: '{views}/{piecesPublished}' },
      { key: 'leadPerPiece', label: 'Leads / Piece', kind: 'ratio', formula: '{leads}/{piecesPublished}' },
      { key: 'costPerLead', label: 'Cost / Lead', kind: 'currency', formula: '{spend}/{leads}' },
    ],
  },
  email: {
    inputs: [
      { key: 'sent', label: 'Sent', kind: 'number' },
      { key: 'delivered', label: 'Delivered', kind: 'number' },
      { key: 'opens', label: 'Opens', kind: 'number' },
      { key: 'clicks', label: 'Clicks', kind: 'number' },
      { key: 'unsub', label: 'Unsubscribes', kind: 'number' },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'enrolled', label: 'Enrolled', kind: 'number' },
      { key: 'spend', label: 'Spend', kind: 'currency' },
      { key: 'revenue', label: 'Revenue', kind: 'currency' },
    ],
    ratios: [
      { key: 'deliveryRate', label: 'Delivery Rate', kind: 'percent', formula: '{delivered}/{sent}' },
      { key: 'openRate', label: 'Open Rate', kind: 'percent', formula: '{opens}/{delivered}' },
      { key: 'clickRate', label: 'Click Rate', kind: 'percent', formula: '{clicks}/{delivered}' },
      { key: 'ctor', label: 'Click-to-Open', kind: 'percent', formula: '{clicks}/{opens}' },
      { key: 'unsubRate', label: 'Unsub Rate', kind: 'percent', formula: '{unsub}/{delivered}' },
      { key: 'leadRate', label: 'Lead Rate', kind: 'percent', formula: '{leads}/{delivered}' },
      { key: 'cac', label: 'CAC', kind: 'currency', formula: '{spend}/{enrolled}' },
      { key: 'roi', label: 'ROI', kind: 'percent', formula: '({revenue}-{spend})/{spend}' },
    ],
  },
  whatsapp: {
    inputs: [
      { key: 'sent', label: 'Sent', kind: 'number' },
      { key: 'delivered', label: 'Delivered', kind: 'number' },
      { key: 'read', label: 'Read', kind: 'number' },
      { key: 'replies', label: 'Replies', kind: 'number' },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'enrolled', label: 'Enrolled', kind: 'number' },
      { key: 'spend', label: 'Spend', kind: 'currency' },
      { key: 'revenue', label: 'Revenue', kind: 'currency' },
    ],
    ratios: [
      { key: 'deliveryRate', label: 'Delivery Rate', kind: 'percent', formula: '{delivered}/{sent}' },
      { key: 'readRate', label: 'Read Rate', kind: 'percent', formula: '{read}/{delivered}' },
      { key: 'replyRate', label: 'Reply Rate', kind: 'percent', formula: '{replies}/{delivered}' },
      { key: 'leadRate', label: 'Lead Rate', kind: 'percent', formula: '{leads}/{delivered}' },
      { key: 'cac', label: 'CAC', kind: 'currency', formula: '{spend}/{enrolled}' },
      { key: 'roi', label: 'ROI', kind: 'percent', formula: '({revenue}-{spend})/{spend}' },
    ],
  },
  automation: {
    inputs: [
      { key: 'workflows', label: 'Active Workflows', kind: 'number' },
      { key: 'contactsProcessed', label: 'Contacts Processed', kind: 'number' },
      { key: 'touchpoints', label: 'Touchpoints Sent', kind: 'number' },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'enrolled', label: 'Enrolled', kind: 'number' },
      { key: 'hoursSaved', label: 'Manual Hours Saved', kind: 'number' },
      { key: 'spend', label: 'Tooling Spend', kind: 'currency' },
      { key: 'revenue', label: 'Revenue', kind: 'currency' },
    ],
    ratios: [
      { key: 'leadPerContact', label: 'Contacts → Lead', kind: 'percent', formula: '{leads}/{contactsProcessed}' },
      { key: 'leadToEnrolled', label: 'Lead → Enrolled', kind: 'percent', formula: '{enrolled}/{leads}' },
      { key: 'touchpointsPerLead', label: 'Touchpoints / Lead', kind: 'ratio', formula: '{touchpoints}/{leads}' },
      { key: 'cac', label: 'CAC', kind: 'currency', formula: '{spend}/{enrolled}' },
      { key: 'roi', label: 'ROI', kind: 'percent', formula: '({revenue}-{spend})/{spend}' },
    ],
  },
  partner: {
    // affiliate / influencer — same shape
    inputs: [
      { key: 'partners', label: 'Active Partners', kind: 'number' },
      { key: 'clicks', label: 'Clicks / Reach', kind: 'number' },
      { key: 'leads', label: 'Leads', kind: 'number' },
      { key: 'enrolled', label: 'Enrolled', kind: 'number' },
      { key: 'payout', label: 'Payout / Fees', kind: 'currency' },
      { key: 'spend', label: 'Other Spend', kind: 'currency' },
      { key: 'revenue', label: 'Revenue', kind: 'currency' },
    ],
    ratios: [
      { key: 'leadPerPartner', label: 'Leads / Partner', kind: 'ratio', formula: '{leads}/{partners}' },
      { key: 'clickToLead', label: 'Click → Lead', kind: 'percent', formula: '{leads}/{clicks}' },
      { key: 'leadToEnrolled', label: 'Lead → Enrolled', kind: 'percent', formula: '{enrolled}/{leads}' },
      { key: 'cpa', label: 'Cost / Acquisition', kind: 'currency', formula: '({payout}+{spend})/{enrolled}' },
      { key: 'roi', label: 'ROI', kind: 'percent', formula: '({revenue}-{payout}-{spend})/({payout}+{spend})' },
    ],
  },
  persona: {
    inputs: [
      { key: 'personas', label: 'Personas Defined', kind: 'number' },
      { key: 'leadsMatched', label: 'Leads Matched to Persona', kind: 'number' },
      { key: 'leadsTotal', label: 'Total Leads', kind: 'number' },
      { key: 'enrolledMatched', label: 'Enrolled (matched personas)', kind: 'number' },
      { key: 'enrolledTotal', label: 'Total Enrolled', kind: 'number' },
    ],
    ratios: [
      { key: 'personaCoverage', label: 'Persona Coverage', kind: 'percent', formula: '{leadsMatched}/{leadsTotal}' },
      { key: 'matchedConversion', label: 'Matched Conversion', kind: 'percent', formula: '{enrolledMatched}/{leadsMatched}' },
      { key: 'overallConversion', label: 'Overall Conversion', kind: 'percent', formula: '{enrolledTotal}/{leadsTotal}' },
      { key: 'lift', label: 'Persona Lift', kind: 'ratio', formula: '({enrolledMatched}/{leadsMatched})/({enrolledTotal}/{leadsTotal})' },
    ],
  },
};

// ── the tree ──────────────────────────────────────────────────────────
const REG = ['India', 'USA'];
const leadsLeaves = (parentKey, label, channel) =>
  REG.map((r) => ({
    key: `${parentKey}-${r.toLowerCase()}`,
    label: `${label} — ${r}`,
    region: r,
    source: 'leads',
    channel,
  }));
const manualLeaves = (parentKey, label, template) =>
  REG.map((r) => ({
    key: `${parentKey}-${r.toLowerCase()}`,
    label: `${label} — ${r}`,
    region: r,
    source: 'manual',
    template,
  }));

const MARKETING_TREE = [
  {
    key: 'visibility',
    label: 'Online Visibility',
    children: ['SEO', 'AEO', 'GEO', 'LMO', 'AIO', 'SEM'].map((n) => ({
      key: `visibility-${n.toLowerCase()}`,
      label: `${n} Dashboard`,
      source: 'manual',
      template: 'visibility',
      region: null,
    })),
  },
  {
    key: 'web-analytics',
    label: 'Web Analytics & Traffic',
    children: manualLeaves('web-analytics', 'Web Analytics & Traffic', 'webAnalytics'),
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    children: REG.map((r) => ({ key: `campaigns-${r.toLowerCase()}`, label: `Campaigns Dashboard ${r}`, region: r, source: 'campaigns' })),
  },
  {
    key: 'orm',
    label: 'ORM Platforms Reputation',
    children: manualLeaves('orm', 'ORM Platform Reputation', 'orm'),
  },
  {
    key: 'global-leads',
    label: 'Global Leads Platform',
    children: [
      ...leadsLeaves('global-leads', 'All Leads', null),
      { key: 'global-leads--ppc', label: 'PPC Leads', group: true, children: leadsLeaves('global-leads-ppc', 'PPC Leads', 'ppc') },
      { key: 'global-leads--meta', label: 'Meta Leads', group: true, children: leadsLeaves('global-leads-meta', 'Meta Leads', 'meta') },
      { key: 'global-leads--linkedin', label: 'LinkedIn Leads', group: true, children: leadsLeaves('global-leads-linkedin', 'LinkedIn Leads', 'linkedin') },
      { key: 'global-leads--youtube', label: 'YouTube Leads', group: true, children: leadsLeaves('global-leads-youtube', 'YouTube Leads', 'youtube') },
      { key: 'global-leads--gmb', label: 'GMB Leads', group: true, children: leadsLeaves('global-leads-gmb', 'GMB Leads', 'gmb') },
      { key: 'global-leads--other', label: 'Other Platforms Leads', group: true, children: leadsLeaves('global-leads-other', 'Other Platforms Leads', 'other') },
    ],
  },
  {
    key: 'social',
    label: 'Social Media & Content Management',
    children: [
      ...manualLeaves('social-all', 'All Platforms & Content', 'social'),
      ...['Google', 'Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'GMB', 'Other'].map((p) => ({
        key: `social--${p.toLowerCase()}`,
        label: `${p} Management & Content`,
        group: true,
        children: manualLeaves(`social-${p.toLowerCase()}`, `${p} Platform & Content`, 'social'),
      })),
    ],
  },
  { key: 'blog-da', label: 'Blog & DA Management', children: manualLeaves('blog-da', 'Blog & DA Management', 'blogDA') },
  { key: 'content', label: 'Content Management', children: manualLeaves('content', 'Content Management', 'content') },
  { key: 'email', label: 'E-Mail Marketing', children: manualLeaves('email', 'Email Management', 'email') },
  { key: 'whatsapp', label: 'WhatsApp Marketing', children: manualLeaves('whatsapp', 'WhatsApp Management', 'whatsapp') },
  { key: 'automation', label: 'Marketing Automation', children: manualLeaves('automation', 'Marketing Automation', 'automation') },
  { key: 'affiliate', label: 'Affiliate Management', children: manualLeaves('affiliate', 'Affiliate Management', 'partner') },
  { key: 'influencer', label: 'Influencer Management', children: manualLeaves('influencer', 'Influencer Management', 'partner') },
  { key: 'persona', label: 'Persona Management', children: manualLeaves('persona', 'Persona Management', 'persona') },
];

// flat lookup: leafKey → leaf config
const LEAF_BY_KEY = {};
(function walk(nodes) {
  for (const n of nodes) {
    if (n.children) walk(n.children);
    else LEAF_BY_KEY[n.key] = n;
  }
})(MARKETING_TREE);

module.exports = {
  DATA_SOURCES,
  CHANNEL_SOURCES,
  METRIC_TEMPLATES,
  MARKETING_TREE,
  LEAF_BY_KEY,
};
