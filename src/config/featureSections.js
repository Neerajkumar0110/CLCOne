// =============================================================================
// FEATURE SECTIONS — Sales, Marketing, Operations, LMS, HR, Messenger.
//
// Each section = one flat sidebar tab -> one page whose sub-areas are in-page
// tabs. A tab is one of:
//   • data tab  — `entity` + `fields[]`  -> <CrudTab> (GET list + Add/Edit/
//                 Delete via the generic IDURAR endpoints). `fields` mirrors
//                 the Mongoose model in backend/src/models/appModels (kept in
//                 sync with backend/scripts/genFeatureModels.cjs).
//   • embed     — `embed` key -> renders an existing app component
//                 (Messenger "Team Chat" reuses pages/Communication TeamChat).
//   • readOnly  — `kpis[]` + `columns[]` -> computed placeholder, no Add/Edit.
//
// field: { name, label, type, options?, required?, table?, group? }
//   type: text | textarea | number | date | select | email | tel | url | bool
//   table:false hides it from the list (still in the form)
//   group     is a form section heading
// =============================================================================

import {
  RiseOutlined,
  NotificationOutlined,
  DeploymentUnitOutlined,
  ReadOutlined,
  IdcardOutlined,
  CommentOutlined,
  DashboardOutlined,
  FunnelPlotOutlined,
  DollarOutlined,
  FileTextOutlined,
  ShoppingCartOutlined,
  AppstoreOutlined,
  MailOutlined,
  FilterOutlined,
  BarChartOutlined,
  ProjectOutlined,
  ShopOutlined,
  FileProtectOutlined,
  CheckSquareOutlined,
  TeamOutlined,
  UserOutlined,
  VideoCameraOutlined,
  TrophyOutlined,
  UsergroupAddOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  WhatsAppOutlined,
  MobileOutlined,
  ContactsOutlined,
  SolutionOutlined,
  PhoneOutlined,
  FieldTimeOutlined,
  ScheduleOutlined,
  CoffeeOutlined,
  WalletOutlined,
  BankOutlined,
  BookOutlined,
  LaptopOutlined,
  FolderOpenOutlined,
  CustomerServiceOutlined,
  SoundOutlined,
  GiftOutlined,
  LogoutOutlined,
} from '@ant-design/icons';

/* ---- shared option lists (must match genFeatureModels.cjs) ---- */
const CURRENCY = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
const DEPARTMENTS = ['Sales', 'Marketing', 'Operations', 'Engineering', 'HR', 'Finance', 'Support', 'Training', 'Admin'];

/* ---- field builders ---- */
const T = (name, label, o = {}) => ({ name, label, type: 'text', ...o });
const AREA = (name, label, o = {}) => ({ name, label, type: 'textarea', table: false, ...o });
const NUM = (name, label, o = {}) => ({ name, label, type: 'number', ...o });
const DT = (name, label, o = {}) => ({ name, label, type: 'date', ...o });
const SEL = (name, label, options, o = {}) => ({ name, label, type: 'select', options, ...o });
const EM = (name, label, o = {}) => ({ name, label, type: 'email', table: false, ...o });
const TEL = (name, label, o = {}) => ({ name, label, type: 'tel', table: false, ...o });
const URLF = (name, label, o = {}) => ({ name, label, type: 'url', table: false, ...o });
const BOOL = (name, label, o = {}) => ({ name, label, type: 'bool', table: false, ...o });
const grp = (group, arr) => arr.map((x) => ({ ...x, group }));

export const FEATURE_SECTIONS = [
  // ===========================================================================
  {
    key: 'sales',
    label: 'Sales',
    module: 'Sales',
    route: '/sales',
    Icon: RiseOutlined,
    blurb: 'Pipeline, deals, quotes, orders and forecasting for the sales desk.',
    tabs: [
      {
        key: 'pipeline',
        label: 'Pipeline',
        Icon: FunnelPlotOutlined,
        // Live weighted-funnel board computed from the Deals tab (salesdeal).
        embed: 'salesPipeline',
      },
      // Leads / Customers / Calls live under Sales now. `embed` renders the
      // existing full-featured pages (ads integrations, imports, etc.) inside
      // the section shell — see EMBED in pages/ModuleScaffold. Old top-level
      // routes /leads /customer /calls still resolve for saved links.
      { key: 'leads', label: 'Leads', Icon: SolutionOutlined, embed: 'leads' },
      { key: 'customers', label: 'Customers', Icon: CustomerServiceOutlined, embed: 'customer' },
      { key: 'calls', label: 'Calls', Icon: PhoneOutlined, embed: 'calls' },
      {
        key: 'deals',
        label: 'Deals',
        Icon: DollarOutlined,
        entity: 'salesdeal',
        fields: [
          ...grp('Overview', [
            T('title', 'Title', { required: true }),
            T('account', 'Account'),
            SEL('pipeline', 'Pipeline', ['Sales', 'Renewal', 'Upsell'], { table: false }),
            SEL('stage', 'Stage', ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']),
            T('owner', 'Owner'),
            SEL('source', 'Source', ['Website', 'Referral', 'Cold Call', 'Event', 'Partner', 'Ads', 'Other'], { table: false }),
          ]),
          ...grp('Contact', [
            T('contactName', 'Contact name', { table: false }),
            EM('contactEmail', 'Contact email'),
            TEL('contactPhone', 'Contact phone'),
          ]),
          ...grp('Value', [
            NUM('amount', 'Amount'),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            NUM('probability', 'Probability %', { table: false }),
            NUM('expectedRevenue', 'Expected revenue', { table: false }),
            DT('closeDate', 'Close date'),
          ]),
          ...grp('Tracking', [
            T('nextStep', 'Next step', { table: false }),
            T('competitors', 'Competitors', { table: false }),
            SEL('lossReason', 'Loss reason', ['Price', 'Timing', 'Features', 'Competitor', 'No Budget', 'No Decision', 'Other'], { table: false }),
            DT('lastActivityDate', 'Last activity', { table: false }),
            T('tags', 'Tags', { table: false }),
            AREA('description', 'Description'),
          ]),
        ],
      },
      {
        key: 'quotes',
        label: 'Quotes',
        Icon: FileTextOutlined,
        entity: 'salesquote',
        fields: [
          ...grp('Quote', [
            T('number', 'Quote #', { required: true }),
            T('title', 'Title', { table: false }),
            T('account', 'Account'),
            T('deal', 'Deal', { table: false }),
            SEL('status', 'Status', ['Draft', 'Pending Approval', 'Sent', 'Accepted', 'Rejected', 'Expired']),
            T('owner', 'Owner'),
          ]),
          ...grp('Contact', [
            T('contactName', 'Contact name', { table: false }),
            EM('contactEmail', 'Contact email'),
          ]),
          ...grp('Amounts', [
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            NUM('subtotal', 'Subtotal', { table: false }),
            NUM('discount', 'Discount', { table: false }),
            NUM('taxRate', 'Tax %', { table: false }),
            NUM('total', 'Total'),
            DT('issueDate', 'Issue date', { table: false }),
            DT('validTill', 'Valid till'),
          ]),
          ...grp('Notes', [AREA('terms', 'Terms'), AREA('notes', 'Notes')]),
        ],
      },
      {
        key: 'orders',
        label: 'Orders',
        Icon: ShoppingCartOutlined,
        entity: 'salesorder',
        fields: [
          ...grp('Order', [
            T('number', 'Order #', { required: true }),
            T('account', 'Account'),
            T('quoteRef', 'Quote ref', { table: false }),
            SEL('status', 'Status', ['Draft', 'Confirmed', 'Processing', 'Fulfilled', 'Partially Fulfilled', 'Invoiced', 'Cancelled']),
            T('owner', 'Owner', { table: false }),
          ]),
          ...grp('Amounts', [
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            NUM('subtotal', 'Subtotal', { table: false }),
            NUM('tax', 'Tax', { table: false }),
            NUM('shipping', 'Shipping', { table: false }),
            NUM('total', 'Total'),
            SEL('paymentStatus', 'Payment', ['Unpaid', 'Partial', 'Paid']),
            T('invoiceRef', 'Invoice ref', { table: false }),
          ]),
          ...grp('Dates', [
            DT('orderDate', 'Order date'),
            DT('expectedDelivery', 'Expected delivery', { table: false }),
            DT('deliveredDate', 'Delivered date', { table: false }),
          ]),
          ...grp('Addresses', [AREA('billingAddress', 'Billing address'), AREA('shippingAddress', 'Shipping address'), AREA('notes', 'Notes')]),
        ],
      },
      {
        key: 'products',
        label: 'Products',
        Icon: AppstoreOutlined,
        entity: 'product',
        fields: [
          ...grp('Product', [
            T('name', 'Name', { required: true }),
            T('sku', 'SKU'),
            T('category', 'Category'),
            SEL('type', 'Type', ['Service', 'Physical', 'Digital', 'Subscription']),
            SEL('status', 'Status', ['Active', 'Inactive', 'Discontinued']),
          ]),
          ...grp('Pricing', [
            NUM('unitPrice', 'Unit price'),
            NUM('costPrice', 'Cost price', { table: false }),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            NUM('taxRate', 'Tax %', { table: false }),
            SEL('unit', 'Unit', ['Unit', 'Hour', 'Day', 'Month', 'Year', 'License', 'Seat'], { table: false }),
            SEL('billingCycle', 'Billing cycle', ['One-time', 'Monthly', 'Quarterly', 'Yearly'], { table: false }),
          ]),
          ...grp('Inventory', [
            NUM('stockQty', 'Stock qty', { table: false }),
            NUM('reorderLevel', 'Reorder level', { table: false }),
            T('hsnCode', 'HSN code', { table: false }),
            AREA('description', 'Description'),
          ]),
        ],
      },
    ],
  },

  // ===========================================================================
  {
    key: 'marketing',
    label: 'Marketing',
    module: 'Marketing',
    route: '/marketing',
    Icon: NotificationOutlined,
    blurb: 'Campaigns, email/SMS, automation, segments and attribution.',
    tabs: [
      {
        key: 'overview',
        label: 'Overview',
        Icon: DashboardOutlined,
        readOnly: true,
        kpis: ['Leads (30d)', 'MQLs', 'Cost / Lead', 'Campaign ROI'],
        columns: ['Channel', 'Spend', 'Leads', 'MQLs', 'CPL', 'ROI'],
      },
      {
        key: 'campaigns',
        label: 'Campaigns',
        Icon: NotificationOutlined,
        entity: 'campaign',
        fields: [
          ...grp('Campaign', [
            T('name', 'Name', { required: true }),
            SEL('type', 'Type', ['Email', 'SMS', 'WhatsApp', 'Social', 'Paid Ads', 'Event', 'Webinar', 'Content', 'SEO']),
            SEL('objective', 'Objective', ['Awareness', 'Lead Gen', 'Nurture', 'Conversion', 'Retention'], { table: false }),
            SEL('status', 'Status', ['Draft', 'Scheduled', 'Active', 'Paused', 'Completed', 'Cancelled']),
            T('owner', 'Owner'),
            T('targetAudience', 'Target audience', { table: false }),
          ]),
          ...grp('Schedule & budget', [
            DT('startDate', 'Start date'),
            DT('endDate', 'End date', { table: false }),
            NUM('budget', 'Budget'),
            NUM('actualSpend', 'Actual spend', { table: false }),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
          ]),
          ...grp('Performance', [
            NUM('expectedLeads', 'Expected leads', { table: false }),
            NUM('leads', 'Leads'),
            NUM('conversions', 'Conversions', { table: false }),
            NUM('revenue', 'Revenue', { table: false }),
          ]),
          ...grp('Tracking', [
            T('utmSource', 'UTM source', { table: false }),
            T('utmMedium', 'UTM medium', { table: false }),
            T('utmCampaign', 'UTM campaign', { table: false }),
            AREA('description', 'Description'),
          ]),
        ],
      },
      {
        key: 'email',
        label: 'Email & SMS',
        Icon: MailOutlined,
        entity: 'emailbroadcast',
        fields: [
          ...grp('Broadcast', [
            T('name', 'Name', { required: true }),
            SEL('channel', 'Channel', ['Email', 'SMS', 'WhatsApp']),
            T('subject', 'Subject', { table: false }),
            T('audience', 'Audience'),
            SEL('status', 'Status', ['Draft', 'Scheduled', 'Sending', 'Sent', 'Paused', 'Failed']),
            BOOL('abTest', 'A/B test'),
          ]),
          ...grp('Sender', [
            T('fromName', 'From name', { table: false }),
            T('fromAddress', 'From address', { table: false }),
            T('templateRef', 'Template ref', { table: false }),
          ]),
          ...grp('Send & results', [
            DT('scheduledAt', 'Scheduled at'),
            DT('sentAt', 'Sent at', { table: false }),
            NUM('recipientCount', 'Recipients', { table: false }),
            NUM('sentCount', 'Sent'),
            NUM('deliveredCount', 'Delivered', { table: false }),
            NUM('openCount', 'Opens', { table: false }),
            NUM('clickCount', 'Clicks', { table: false }),
            NUM('bounceCount', 'Bounces', { table: false }),
            NUM('unsubscribeCount', 'Unsubscribes', { table: false }),
          ]),
          ...grp('Content', [AREA('content', 'Content')]),
        ],
      },
      {
        key: 'automation',
        label: 'Automation',
        Icon: DeploymentUnitOutlined,
        entity: 'journey',
        fields: [
          ...grp('Journey', [
            T('name', 'Name', { required: true }),
            SEL('triggerType', 'Trigger', ['Form Submission', 'Tag Added', 'List Join', 'Field Change', 'Date Based', 'Page Visit', 'Manual']),
            T('triggerDetail', 'Trigger detail', { table: false }),
            SEL('status', 'Status', ['Draft', 'Active', 'Paused', 'Archived']),
            T('goal', 'Goal', { table: false }),
            T('owner', 'Owner', { table: false }),
            NUM('steps', 'Steps', { table: false }),
          ]),
          ...grp('Performance', [
            NUM('enrolled', 'Enrolled'),
            NUM('inProgress', 'In progress', { table: false }),
            NUM('completed', 'Completed'),
            NUM('goalMet', 'Goal met', { table: false }),
            NUM('exitCount', 'Exits', { table: false }),
          ]),
          ...grp('Window', [DT('startDate', 'Start date', { table: false }), DT('endDate', 'End date', { table: false }), AREA('notes', 'Notes')]),
        ],
      },
      {
        key: 'segments',
        label: 'Segments',
        Icon: FilterOutlined,
        entity: 'segment',
        fields: [
          ...grp('Segment', [
            T('name', 'Name', { required: true }),
            SEL('type', 'Type', ['Dynamic', 'Static']),
            SEL('status', 'Status', ['Active', 'Archived']),
            SEL('source', 'Source', ['CRM', 'Import', 'Form', 'Manual', 'Integration'], { table: false }),
            T('owner', 'Owner', { table: false }),
            T('description', 'Description', { table: false }),
          ]),
          ...grp('Size', [
            NUM('contactCount', 'Contacts'),
            NUM('marketableCount', 'Marketable', { table: false }),
            NUM('usedInCount', 'Used in', { table: false }),
            DT('lastRefreshed', 'Last refreshed', { table: false }),
            T('tags', 'Tags', { table: false }),
          ]),
          ...grp('Rules', [AREA('criteria', 'Criteria')]),
        ],
      },
      {
        key: 'analytics',
        label: 'Analytics',
        Icon: BarChartOutlined,
        readOnly: true,
        kpis: ['Sessions', 'Leads', 'MQL to SQL %', 'Attributed Revenue'],
        columns: ['Source', 'Sessions', 'Leads', 'Opportunities', 'Revenue', 'ROI'],
      },
    ],
  },

  // ===========================================================================
  {
    key: 'operations',
    label: 'Operations',
    module: 'Operations',
    route: '/operations',
    Icon: DeploymentUnitOutlined,
    blurb: 'Projects, service delivery, procurement, documents and approvals.',
    tabs: [
      {
        key: 'overview',
        label: 'Overview',
        Icon: DashboardOutlined,
        readOnly: true,
        kpis: ['Active Projects', 'On-time %', 'Open Tasks', 'Overdue'],
        columns: ['Project', 'Owner', 'Progress', 'Due', 'Status'],
      },
      {
        key: 'projects',
        label: 'Projects & Tasks',
        Icon: ProjectOutlined,
        entity: 'opsproject',
        fields: [
          ...grp('Project', [
            T('name', 'Name', { required: true }),
            T('code', 'Code', { table: false }),
            T('client', 'Client'),
            SEL('type', 'Type', ['Implementation', 'Consulting', 'Support', 'Internal', 'Retainer'], { table: false }),
            T('owner', 'Owner'),
            T('team', 'Team', { table: false }),
          ]),
          ...grp('Status', [
            SEL('priority', 'Priority', ['Low', 'Medium', 'High', 'Critical']),
            SEL('status', 'Status', ['Planned', 'In Progress', 'On Hold', 'Blocked', 'Completed', 'Cancelled']),
            SEL('healthStatus', 'Health', ['On Track', 'At Risk', 'Off Track'], { table: false }),
            NUM('progress', 'Progress %'),
          ]),
          ...grp('Dates & effort', [
            DT('startDate', 'Start date', { table: false }),
            DT('dueDate', 'Due date'),
            DT('completedDate', 'Completed date', { table: false }),
            NUM('budget', 'Budget', { table: false }),
            NUM('billedAmount', 'Billed', { table: false }),
            NUM('estimatedHours', 'Est. hours', { table: false }),
            NUM('loggedHours', 'Logged hours', { table: false }),
          ]),
          ...grp('Notes', [AREA('description', 'Description')]),
        ],
      },
      {
        key: 'delivery',
        label: 'Service Delivery',
        Icon: DeploymentUnitOutlined,
        entity: 'opsdelivery',
        fields: [
          ...grp('Engagement', [
            T('engagement', 'Engagement', { required: true }),
            T('client', 'Client'),
            T('service', 'Service', { table: false }),
            SEL('stage', 'Stage', ['Kickoff', 'Discovery', 'Build', 'Review', 'UAT', 'Handover', 'Closed']),
            T('owner', 'Owner'),
          ]),
          ...grp('Status', [
            SEL('status', 'Status', ['In Delivery', 'Awaiting Client', 'Blocked', 'On Hold', 'Delivered']),
            SEL('health', 'Health', ['Green', 'Amber', 'Red']),
            BOOL('signedOff', 'Signed off'),
            NUM('cycleTimeDays', 'Cycle time (days)', { table: false }),
          ]),
          ...grp('Dates', [
            DT('startDate', 'Started', { table: false }),
            DT('eta', 'ETA'),
            DT('deliveredDate', 'Delivered date', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'vendors',
        label: 'Vendors & Procurement',
        Icon: ShopOutlined,
        entity: 'vendor',
        fields: [
          ...grp('Vendor', [
            T('name', 'Name', { required: true }),
            T('code', 'Code', { table: false }),
            SEL('category', 'Category', ['IT & Software', 'Marketing', 'Facilities', 'Professional Services', 'Logistics', 'Other']),
            SEL('status', 'Status', ['Active', 'Inactive', 'On Hold', 'Blacklisted']),
            NUM('rating', 'Rating'),
          ]),
          ...grp('Contact', [
            T('contactPerson', 'Contact person', { table: false }),
            EM('contactEmail', 'Email'),
            TEL('contactPhone', 'Phone'),
            URLF('website', 'Website'),
            AREA('address', 'Address'),
          ]),
          ...grp('Commercial', [
            T('gstin', 'GSTIN', { table: false }),
            SEL('paymentTerms', 'Payment terms', ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Advance', 'On Delivery'], { table: false }),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            DT('onboardedDate', 'Onboarded', { table: false }),
            DT('contractEnd', 'Contract end', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'documents',
        label: 'Documents & Contracts',
        Icon: FileProtectOutlined,
        entity: 'opsdocument',
        fields: [
          ...grp('Document', [
            T('title', 'Title', { required: true }),
            SEL('type', 'Type', ['Contract', 'MSA', 'NDA', 'SOW', 'Proposal', 'Invoice', 'Policy', 'Report', 'Other']),
            T('category', 'Category', { table: false }),
            SEL('status', 'Status', ['Draft', 'In Review', 'Pending Signature', 'Signed', 'Active', 'Expired', 'Terminated']),
            SEL('confidentiality', 'Confidentiality', ['Public', 'Internal', 'Confidential', 'Restricted'], { table: false }),
            T('version', 'Version', { table: false }),
          ]),
          ...grp('Linked', [
            SEL('linkedType', 'Linked type', ['Client', 'Vendor', 'Project', 'Employee', 'Deal', 'None'], { table: false }),
            T('linkedTo', 'Linked to'),
            T('owner', 'Owner'),
            URLF('fileUrl', 'File URL'),
          ]),
          ...grp('Dates', [
            DT('effectiveDate', 'Effective date', { table: false }),
            DT('expiryDate', 'Expiry'),
            DT('renewalReminderDate', 'Renewal reminder', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'approvals',
        label: 'Approvals',
        Icon: CheckSquareOutlined,
        entity: 'approval',
        fields: [
          ...grp('Request', [
            T('title', 'Title', { required: true }),
            SEL('type', 'Type', ['Discount', 'Purchase Order', 'Expense', 'Leave', 'Budget', 'Contract', 'Hiring', 'Other']),
            T('requestedBy', 'Requested by'),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            SEL('priority', 'Priority', ['Low', 'Normal', 'High', 'Urgent']),
          ]),
          ...grp('Decision', [
            NUM('amount', 'Amount'),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            T('currentStage', 'Current stage', { table: false }),
            T('approver', 'Approver', { table: false }),
            SEL('status', 'Status', ['Draft', 'Pending', 'In Review', 'Approved', 'Rejected', 'Withdrawn']),
          ]),
          ...grp('Dates', [
            DT('requestedDate', 'Requested date', { table: false }),
            DT('dueDate', 'Due date', { table: false }),
            DT('decisionDate', 'Decision date', { table: false }),
            AREA('justification', 'Justification'),
            AREA('decisionNote', 'Decision note'),
          ]),
        ],
      },
    ],
  },

  // ===========================================================================
  {
    key: 'project-management',
    label: 'Project Management',
    module: 'Project Management',
    route: '/project-management',
    Icon: ProjectOutlined,
    blurb: 'Delivery projects, tasks, service handovers and approvals.',
    tabs: [
      {
        key: 'overview',
        label: 'Overview',
        Icon: DashboardOutlined,
        readOnly: true,
        note: 'Live counts across every project area. Numbers update as records are added in the other tabs.',
        stats: [
          { label: 'Active Projects', entity: 'opsproject', filter: 'status', equal: 'In Progress' },
          { label: 'Planned Projects', entity: 'opsproject', filter: 'status', equal: 'Planned' },
          { label: 'On Hold', entity: 'opsproject', filter: 'status', equal: 'On Hold' },
          { label: 'Blocked', entity: 'opsproject', filter: 'status', equal: 'Blocked' },
          { label: 'Completed Projects', entity: 'opsproject', filter: 'status', equal: 'Completed' },
          { label: 'Total Projects', entity: 'opsproject' },
          { label: 'Deliveries In Progress', entity: 'opsdelivery', filter: 'status', equal: 'In Delivery' },
          { label: 'Awaiting Client', entity: 'opsdelivery', filter: 'status', equal: 'Awaiting Client' },
          { label: 'Delivered', entity: 'opsdelivery', filter: 'status', equal: 'Delivered' },
          { label: 'Approvals Pending', entity: 'approval', filter: 'status', equal: 'Pending' },
          { label: 'Approvals In Review', entity: 'approval', filter: 'status', equal: 'In Review' },
          { label: 'Approved', entity: 'approval', filter: 'status', equal: 'Approved' },
        ],
      },
      {
        key: 'projects',
        label: 'Projects & Tasks',
        Icon: ProjectOutlined,
        entity: 'opsproject',
        fields: [
          ...grp('Project', [
            T('name', 'Name', { required: true }),
            T('code', 'Code', { table: false }),
            T('client', 'Client'),
            SEL('type', 'Type', ['Implementation', 'Consulting', 'Support', 'Internal', 'Retainer'], { table: false }),
            T('owner', 'Owner'),
            T('team', 'Team', { table: false }),
          ]),
          ...grp('Status', [
            SEL('priority', 'Priority', ['Low', 'Medium', 'High', 'Critical']),
            SEL('status', 'Status', ['Planned', 'In Progress', 'On Hold', 'Blocked', 'Completed', 'Cancelled']),
            SEL('healthStatus', 'Health', ['On Track', 'At Risk', 'Off Track'], { table: false }),
            NUM('progress', 'Progress %'),
          ]),
          ...grp('Dates & effort', [
            DT('startDate', 'Start date', { table: false }),
            DT('dueDate', 'Due date'),
            DT('completedDate', 'Completed date', { table: false }),
            NUM('budget', 'Budget', { table: false }),
            NUM('billedAmount', 'Billed', { table: false }),
            NUM('estimatedHours', 'Est. hours', { table: false }),
            NUM('loggedHours', 'Logged hours', { table: false }),
          ]),
          ...grp('Notes', [AREA('description', 'Description')]),
        ],
      },
      {
        key: 'delivery',
        label: 'Service Delivery',
        Icon: DeploymentUnitOutlined,
        entity: 'opsdelivery',
        fields: [
          ...grp('Engagement', [
            T('engagement', 'Engagement', { required: true }),
            T('client', 'Client'),
            T('service', 'Service', { table: false }),
            SEL('stage', 'Stage', ['Kickoff', 'Discovery', 'Build', 'Review', 'UAT', 'Handover', 'Closed']),
            T('owner', 'Owner'),
          ]),
          ...grp('Status', [
            SEL('status', 'Status', ['In Delivery', 'Awaiting Client', 'Blocked', 'On Hold', 'Delivered']),
            SEL('health', 'Health', ['Green', 'Amber', 'Red']),
            BOOL('signedOff', 'Signed off'),
            NUM('cycleTimeDays', 'Cycle time (days)', { table: false }),
          ]),
          ...grp('Dates', [
            DT('startDate', 'Started', { table: false }),
            DT('eta', 'ETA'),
            DT('deliveredDate', 'Delivered date', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'approvals',
        label: 'Approvals',
        Icon: CheckSquareOutlined,
        entity: 'approval',
        fields: [
          ...grp('Request', [
            T('title', 'Title', { required: true }),
            SEL('type', 'Type', ['Discount', 'Purchase Order', 'Expense', 'Leave', 'Budget', 'Contract', 'Hiring', 'Other']),
            T('requestedBy', 'Requested by'),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            SEL('priority', 'Priority', ['Low', 'Normal', 'High', 'Urgent']),
          ]),
          ...grp('Decision', [
            NUM('amount', 'Amount'),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            T('currentStage', 'Current stage', { table: false }),
            T('approver', 'Approver', { table: false }),
            SEL('status', 'Status', ['Draft', 'Pending', 'In Review', 'Approved', 'Rejected', 'Withdrawn']),
          ]),
          ...grp('Dates', [
            DT('requestedDate', 'Requested date', { table: false }),
            DT('dueDate', 'Due date', { table: false }),
            DT('decisionDate', 'Decision date', { table: false }),
            AREA('justification', 'Justification'),
            AREA('decisionNote', 'Decision note'),
          ]),
        ],
      },
    ],
  },

  // ===========================================================================
  {
    key: 'lms',
    label: 'LMS',
    module: 'LMS',
    route: '/lms',
    Icon: ReadOutlined,
    blurb: 'Courses, batches, students, live classes, attendance and certificates.',
    tabs: [
      {
        key: 'overview',
        label: 'Overview',
        Icon: DashboardOutlined,
        readOnly: true,
        kpis: ['Active Students', 'Live Batches', 'Avg Completion', 'Certificates (30d)'],
        columns: ['Batch', 'Course', 'Students', 'Progress', 'Status'],
      },
      {
        key: 'courses',
        label: 'Courses',
        Icon: ReadOutlined,
        entity: 'course',
        fields: [
          ...grp('Course', [
            T('title', 'Title', { required: true }),
            T('code', 'Code', { table: false }),
            SEL('category', 'Category', ['Aptitude', 'Technical', 'Communication', 'Interview Prep', 'Domain', 'Soft Skills', 'Certification']),
            SEL('level', 'Level', ['Beginner', 'Intermediate', 'Advanced'], { table: false }),
            SEL('mode', 'Mode', ['Self-paced', 'Cohort', 'Live', 'Blended'], { table: false }),
            SEL('language', 'Language', ['English', 'Hindi', 'Bilingual'], { table: false }),
            SEL('status', 'Status', ['Draft', 'Published', 'Archived']),
            T('instructor', 'Instructor'),
          ]),
          ...grp('Structure', [
            NUM('durationHours', 'Duration (hrs)'),
            NUM('modules', 'Modules', { table: false }),
            NUM('lessons', 'Lessons', { table: false }),
            NUM('rating', 'Rating', { table: false }),
            NUM('enrolledCount', 'Enrolled', { table: false }),
            DT('publishedDate', 'Published date', { table: false }),
          ]),
          ...grp('Pricing', [
            NUM('price', 'Price'),
            NUM('discountPrice', 'Discount price', { table: false }),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
          ]),
          ...grp('Details', [
            URLF('thumbnailUrl', 'Thumbnail URL'),
            T('prerequisites', 'Prerequisites', { table: false }),
            AREA('outcomes', 'Outcomes'),
            AREA('description', 'Description'),
          ]),
        ],
      },
      {
        key: 'batches',
        label: 'Batches',
        Icon: TeamOutlined,
        entity: 'batch',
        fields: [
          ...grp('Batch', [
            T('name', 'Name', { required: true }),
            T('code', 'Code', { table: false }),
            T('course', 'Course'),
            SEL('mode', 'Mode', ['Online', 'Offline', 'Hybrid'], { table: false }),
            T('trainer', 'Trainer'),
            T('coordinator', 'Coordinator', { table: false }),
            SEL('status', 'Status', ['Planned', 'Open for Enrollment', 'Running', 'Completed', 'Cancelled']),
          ]),
          ...grp('Schedule', [
            DT('startDate', 'Start'),
            DT('endDate', 'End', { table: false }),
            T('schedule', 'Schedule', { table: false }),
            T('venue', 'Venue', { table: false }),
            URLF('meetingLink', 'Meeting link'),
          ]),
          ...grp('Seats', [
            NUM('seats', 'Seats'),
            NUM('enrolled', 'Enrolled'),
            NUM('waitlist', 'Waitlist', { table: false }),
            NUM('completionRate', 'Completion %', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'students',
        label: 'Students',
        Icon: UserOutlined,
        entity: 'student',
        fields: [
          ...grp('Student', [
            T('name', 'Name', { required: true }),
            EM('email', 'Email'),
            TEL('phone', 'Phone'),
            TEL('altPhone', 'Alt phone'),
            T('city', 'City', { table: false }),
            T('enrollmentId', 'Enrollment ID', { table: false }),
          ]),
          ...grp('Enrollment', [
            T('course', 'Course'),
            T('batch', 'Batch'),
            DT('enrolledOn', 'Enrolled on', { table: false }),
            SEL('status', 'Status', ['Active', 'On Hold', 'Completed', 'Dropped', 'Deferred']),
            SEL('source', 'Source', ['Website', 'Referral', 'Walk-in', 'Ads', 'Counselor', 'Partner'], { table: false }),
            T('counselor', 'Counselor', { table: false }),
          ]),
          ...grp('Progress', [
            NUM('progress', 'Progress %'),
            NUM('attendancePct', 'Attendance %', { table: false }),
            NUM('avgScore', 'Avg score', { table: false }),
          ]),
          ...grp('Fees', [
            NUM('feeTotal', 'Fee total', { table: false }),
            NUM('feePaid', 'Fee paid', { table: false }),
            SEL('feeStatus', 'Fee status', ['Paid', 'Partial', 'Unpaid', 'Waived']),
          ]),
          ...grp('Guardian', [
            T('guardianName', 'Guardian name', { table: false }),
            TEL('guardianPhone', 'Guardian phone'),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'classes',
        label: 'Live Classes',
        Icon: VideoCameraOutlined,
        entity: 'liveclass',
        fields: [
          ...grp('Session', [
            T('topic', 'Topic', { required: true }),
            T('course', 'Course', { table: false }),
            T('batch', 'Batch'),
            T('trainer', 'Trainer'),
            SEL('status', 'Status', ['Scheduled', 'Live', 'Completed', 'Cancelled', 'Rescheduled']),
          ]),
          ...grp('Schedule', [
            DT('scheduledAt', 'Date / time'),
            NUM('durationMin', 'Duration (min)', { table: false }),
            SEL('mode', 'Mode', ['Zoom', 'Google Meet', 'MS Teams', 'In-person'], { table: false }),
            URLF('joinUrl', 'Join URL'),
          ]),
          ...grp('Attendance & assets', [
            NUM('registeredCount', 'Registered', { table: false }),
            NUM('attendedCount', 'Attended', { table: false }),
            URLF('recordingUrl', 'Recording URL'),
            URLF('materialsUrl', 'Materials URL'),
            AREA('agenda', 'Agenda'),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'attendance',
        label: 'Attendance',
        Icon: CheckSquareOutlined,
        entity: 'attendancerecord',
        fields: [
          ...grp('Record', [
            T('student', 'Student', { required: true }),
            T('batch', 'Batch'),
            T('course', 'Course', { table: false }),
            T('sessionTopic', 'Session topic', { table: false }),
            DT('date', 'Date'),
            SEL('status', 'Status', ['Present', 'Absent', 'Late', 'Left Early', 'Excused']),
          ]),
          ...grp('Timing', [
            T('joinTime', 'Join time', { table: false }),
            T('leaveTime', 'Leave time', { table: false }),
            NUM('durationMin', 'Duration (min)', { table: false }),
            SEL('markedBy', 'Marked by', ['Auto', 'Manual'], { table: false }),
            T('remarks', 'Remarks', { table: false }),
          ]),
        ],
      },
      {
        key: 'certificates',
        label: 'Certificates',
        Icon: TrophyOutlined,
        entity: 'certificate',
        fields: [
          ...grp('Certificate', [
            T('student', 'Student', { required: true }),
            T('course', 'Course'),
            T('batch', 'Batch', { table: false }),
            T('certificateId', 'Certificate ID'),
            T('title', 'Title', { table: false }),
            SEL('type', 'Type', ['Completion', 'Participation', 'Merit', 'Achievement'], { table: false }),
            SEL('status', 'Status', ['Draft', 'Issued', 'Sent', 'Revoked']),
          ]),
          ...grp('Result & dates', [
            T('grade', 'Grade', { table: false }),
            NUM('score', 'Score', { table: false }),
            DT('issuedOn', 'Issued on'),
            DT('validUntil', 'Valid until', { table: false }),
            URLF('verificationUrl', 'Verification URL'),
            T('issuedBy', 'Issued by', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
    ],
  },

  // ===========================================================================
  {
    key: 'hr',
    label: 'HRMS',
    module: 'HRMS',
    route: '/hr',
    Icon: IdcardOutlined,
    blurb: 'People, hiring, attendance, leave, payroll and performance.',
    tabs: [
      {
        key: 'overview',
        label: 'Overview',
        Icon: DashboardOutlined,
        readOnly: true,
        note: 'Live counts across every HR area. Numbers update as records are added in the other tabs.',
        stats: [
          { label: 'Active Employees', entity: 'employee', filter: 'status', equal: 'Active' },
          { label: 'Total Employees', entity: 'employee' },
          { label: 'On Notice Period', entity: 'employee', filter: 'status', equal: 'Notice Period' },
          { label: 'Candidates in Pipeline', entity: 'candidate' },
          { label: 'Offers Out', entity: 'candidate', filter: 'stage', equal: 'Offer' },
          { label: 'Onboarding In Progress', entity: 'hronboarding', filter: 'status', equal: 'In Progress' },
          { label: 'Pending Leave', entity: 'leaverequest', filter: 'status', equal: 'Pending' },
          { label: 'Timesheets to Approve', entity: 'timesheet', filter: 'status', equal: 'Submitted' },
          { label: 'Expenses Submitted', entity: 'expenseclaim', filter: 'status', equal: 'Submitted' },
          { label: 'Loans Repaying', entity: 'loanadvance', filter: 'status', equal: 'Repaying' },
          { label: 'Payslips Paid', entity: 'payslip', filter: 'status', equal: 'Paid' },
          { label: 'Appraisals In Progress', entity: 'appraisal', filter: 'status', equal: 'Manager Review' },
          { label: 'Trainings Running', entity: 'trainingprogram', filter: 'status', equal: 'Running' },
          { label: 'Assets Assigned', entity: 'hrasset', filter: 'status', equal: 'Assigned' },
          { label: 'Assets In Stock', entity: 'hrasset', filter: 'status', equal: 'In Stock' },
          { label: 'Documents Pending', entity: 'hrdocument', filter: 'status', equal: 'Pending' },
          { label: 'Open HR Tickets', entity: 'hrticket', filter: 'status', equal: 'Open' },
          { label: 'Published Announcements', entity: 'announcement', filter: 'status', equal: 'Published' },
          { label: 'Recognitions Awarded', entity: 'recognition', filter: 'status', equal: 'Awarded' },
          { label: 'Exits In Progress', entity: 'exitrecord', filter: 'status', equal: 'Notice Period' },
        ],
      },
      {
        key: 'employees',
        label: 'Employees',
        Icon: IdcardOutlined,
        entity: 'employee',
        fields: [
          ...grp('Identity', [
            T('name', 'Name', { required: true }),
            T('employeeId', 'Employee ID'),
            EM('email', 'Work email'),
            TEL('phone', 'Phone'),
            EM('personalEmail', 'Personal email'),
            SEL('gender', 'Gender', ['Male', 'Female', 'Other', 'Prefer not to say'], { table: false }),
            DT('dateOfBirth', 'Date of birth', { table: false }),
          ]),
          ...grp('Job', [
            SEL('department', 'Department', DEPARTMENTS),
            T('designation', 'Designation'),
            T('reportingManager', 'Reporting manager', { table: false }),
            SEL('employmentType', 'Type', ['Permanent', 'Contract', 'Probation', 'Intern', 'Consultant']),
            SEL('workLocation', 'Work location', ['Office', 'Remote', 'Hybrid'], { table: false }),
            DT('dateOfJoining', 'Joined'),
            SEL('status', 'Status', ['Active', 'On Leave', 'Notice Period', 'Suspended', 'Resigned', 'Terminated']),
          ]),
          ...grp('Payroll', [
            NUM('ctc', 'CTC', { table: false }),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            T('bankAccount', 'Bank account', { table: false }),
            T('pan', 'PAN', { table: false }),
            T('uan', 'UAN', { table: false }),
          ]),
          ...grp('Other', [
            T('emergencyContactName', 'Emergency contact', { table: false }),
            TEL('emergencyContactPhone', 'Emergency phone'),
            T('skills', 'Skills', { table: false }),
            AREA('address', 'Address'),
          ]),
        ],
      },
      {
        key: 'recruitment',
        label: 'Recruitment',
        Icon: UsergroupAddOutlined,
        entity: 'candidate',
        fields: [
          ...grp('Candidate', [
            T('name', 'Name', { required: true }),
            EM('email', 'Email'),
            TEL('phone', 'Phone'),
            T('role', 'Role'),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            T('location', 'Location', { table: false }),
          ]),
          ...grp('Pipeline', [
            SEL('stage', 'Stage', ['Applied', 'Screening', 'Shortlisted', 'Interview', 'Assessment', 'Offer', 'Hired', 'Rejected', 'On Hold', 'Withdrawn']),
            SEL('source', 'Source', ['Job Portal', 'Referral', 'LinkedIn', 'Career Page', 'Agency', 'Walk-in', 'Campus'], { table: false }),
            T('recruiter', 'Recruiter'),
            NUM('rating', 'Rating', { table: false }),
            DT('appliedOn', 'Applied on'),
            DT('interviewDate', 'Interview date', { table: false }),
          ]),
          ...grp('Current & expected', [
            T('currentCompany', 'Current company', { table: false }),
            NUM('currentCtc', 'Current CTC', { table: false }),
            NUM('expectedCtc', 'Expected CTC', { table: false }),
            NUM('noticePeriodDays', 'Notice (days)', { table: false }),
            NUM('experienceYears', 'Experience (yrs)', { table: false }),
            URLF('resumeUrl', 'Resume URL'),
            AREA('feedback', 'Feedback'),
          ]),
        ],
      },
      {
        key: 'attendance',
        label: 'Attendance',
        Icon: ClockCircleOutlined,
        entity: 'hrattendance',
        fields: [
          ...grp('Record', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            DT('date', 'Date'),
            SEL('shift', 'Shift', ['General', 'Morning', 'Evening', 'Night', 'Flexible'], { table: false }),
            SEL('status', 'Status', ['Present', 'Absent', 'Half Day', 'Work From Home', 'On Leave', 'Holiday', 'Weekend']),
          ]),
          ...grp('Timing', [
            T('clockIn', 'Clock in'),
            T('clockOut', 'Clock out'),
            NUM('workedHours', 'Worked hours'),
            NUM('overtimeHours', 'Overtime hours', { table: false }),
            NUM('lateByMin', 'Late by (min)', { table: false }),
            T('location', 'Location', { table: false }),
            BOOL('regularized', 'Regularized'),
            T('remarks', 'Remarks', { table: false }),
          ]),
        ],
      },
      {
        key: 'leave',
        label: 'Leave',
        Icon: CalendarOutlined,
        entity: 'leaverequest',
        fields: [
          ...grp('Request', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            SEL('leaveType', 'Type', ['Casual', 'Sick', 'Earned', 'Unpaid', 'Comp Off', 'Maternity', 'Paternity', 'Bereavement']),
            SEL('status', 'Status', ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Withdrawn']),
          ]),
          ...grp('Duration', [
            DT('fromDate', 'From'),
            DT('toDate', 'To'),
            NUM('days', 'Days'),
            BOOL('halfDay', 'Half day'),
            AREA('reason', 'Reason'),
          ]),
          ...grp('Handling', [
            T('approver', 'Approver', { table: false }),
            DT('appliedOn', 'Applied on', { table: false }),
            DT('decisionDate', 'Decision date', { table: false }),
            TEL('contactDuringLeave', 'Contact during leave'),
            T('handoverTo', 'Handover to', { table: false }),
            T('decisionNote', 'Decision note', { table: false }),
          ]),
        ],
      },
      {
        key: 'payroll',
        label: 'Payroll',
        Icon: DollarOutlined,
        entity: 'payslip',
        fields: [
          ...grp('Payslip', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            T('payPeriod', 'Pay period'),
            DT('payDate', 'Pay date'),
            SEL('status', 'Status', ['Draft', 'Processed', 'Paid', 'On Hold']),
            SEL('paymentMode', 'Payment mode', ['Bank Transfer', 'Cheque', 'Cash', 'UPI'], { table: false }),
          ]),
          ...grp('Earnings', [
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            NUM('ctc', 'CTC', { table: false }),
            NUM('basic', 'Basic', { table: false }),
            NUM('hra', 'HRA', { table: false }),
            NUM('allowances', 'Allowances', { table: false }),
            NUM('grossEarnings', 'Gross earnings', { table: false }),
          ]),
          ...grp('Deductions', [
            NUM('pf', 'PF', { table: false }),
            NUM('esi', 'ESI', { table: false }),
            NUM('tds', 'TDS', { table: false }),
            NUM('otherDeductions', 'Other deductions', { table: false }),
            NUM('totalDeductions', 'Total deductions', { table: false }),
          ]),
          ...grp('Net', [
            NUM('netPay', 'Net pay'),
            NUM('paidDays', 'Paid days', { table: false }),
            NUM('lopDays', 'LOP days', { table: false }),
            T('notes', 'Notes', { table: false }),
          ]),
        ],
      },
      {
        key: 'performance',
        label: 'Performance',
        Icon: TrophyOutlined,
        entity: 'appraisal',
        fields: [
          ...grp('Cycle', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            T('cycle', 'Cycle'),
            DT('reviewPeriodStart', 'Period start', { table: false }),
            DT('reviewPeriodEnd', 'Period end', { table: false }),
            T('manager', 'Manager'),
            T('reviewer', 'Reviewer', { table: false }),
          ]),
          ...grp('Ratings', [
            NUM('selfRating', 'Self rating', { table: false }),
            NUM('managerRating', 'Manager rating', { table: false }),
            NUM('finalRating', 'Final rating'),
            SEL('ratingLabel', 'Rating label', ['Outstanding', 'Exceeds Expectations', 'Meets Expectations', 'Needs Improvement', 'Unsatisfactory'], { table: false }),
            SEL('status', 'Status', ['Not Started', 'Self Review', 'Manager Review', 'Calibration', 'Completed', 'Acknowledged']),
          ]),
          ...grp('Outcome', [
            BOOL('promotionRecommended', 'Promotion recommended'),
            NUM('incrementPct', 'Increment %', { table: false }),
            AREA('goals', 'Goals'),
            AREA('strengths', 'Strengths'),
            AREA('improvements', 'Improvements'),
            AREA('managerComments', 'Manager comments'),
          ]),
        ],
      },
      {
        key: 'onboarding',
        label: 'Onboarding',
        Icon: SolutionOutlined,
        entity: 'hronboarding',
        fields: [
          ...grp('Joiner', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS),
            T('designation', 'Designation', { table: false }),
            T('manager', 'Manager'),
            T('buddy', 'Buddy', { table: false }),
          ]),
          ...grp('Progress', [
            DT('joiningDate', 'Joining date'),
            DT('dueDate', 'Due date', { table: false }),
            SEL('status', 'Status', ['Not Started', 'In Progress', 'Completed', 'Delayed']),
            NUM('progress', 'Progress %'),
          ]),
          ...grp('Checklist', [
            BOOL('docsCollected', 'Docs collected'),
            BOOL('itSetupDone', 'IT setup done'),
            BOOL('assetsIssued', 'Assets issued'),
            BOOL('accessGranted', 'Access granted'),
            BOOL('inductionDone', 'Induction done'),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'timesheets',
        label: 'Timesheets',
        Icon: FieldTimeOutlined,
        entity: 'timesheet',
        fields: [
          ...grp('Entry', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            T('project', 'Project'),
            T('task', 'Task', { table: false }),
          ]),
          ...grp('Time', [
            DT('date', 'Date'),
            T('weekOf', 'Week of', { table: false }),
            NUM('hours', 'Hours'),
            BOOL('billable', 'Billable'),
            SEL('status', 'Status', ['Draft', 'Submitted', 'Approved', 'Rejected']),
            T('approver', 'Approver', { table: false }),
            AREA('description', 'Description'),
          ]),
        ],
      },
      {
        key: 'shifts',
        label: 'Shifts & Roster',
        Icon: ScheduleOutlined,
        entity: 'shiftroster',
        fields: [
          ...grp('Assignment', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            SEL('shiftName', 'Shift', ['General', 'Morning', 'Evening', 'Night', 'Split']),
            T('location', 'Location', { table: false }),
            SEL('status', 'Status', ['Scheduled', 'Active', 'Swapped', 'Cancelled']),
          ]),
          ...grp('Timing', [
            T('startTime', 'Start time'),
            T('endTime', 'End time'),
            T('weekOff', 'Week off', { table: false }),
            DT('fromDate', 'From', { table: false }),
            DT('toDate', 'To', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'holidays',
        label: 'Holidays',
        Icon: CoffeeOutlined,
        entity: 'holiday',
        fields: [
          ...grp('Holiday', [
            T('name', 'Name', { required: true }),
            DT('date', 'Date'),
            SEL('type', 'Type', ['National', 'Regional', 'Restricted', 'Company']),
            T('day', 'Day', { table: false }),
            NUM('year', 'Year'),
            BOOL('optional', 'Optional'),
          ]),
          ...grp('Scope', [
            T('applicableLocations', 'Applicable locations'),
            AREA('description', 'Description'),
          ]),
        ],
      },
      {
        key: 'expenses',
        label: 'Expenses & Claims',
        Icon: WalletOutlined,
        entity: 'expenseclaim',
        fields: [
          ...grp('Claim', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            SEL('category', 'Category', ['Travel', 'Food', 'Accommodation', 'Fuel', 'Office Supplies', 'Client Entertainment', 'Training', 'Other']),
            T('title', 'Title'),
          ]),
          ...grp('Amount', [
            NUM('amount', 'Amount'),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            DT('expenseDate', 'Expense date', { table: false }),
            DT('claimDate', 'Claim date'),
            SEL('status', 'Status', ['Draft', 'Submitted', 'Approved', 'Rejected', 'Reimbursed']),
          ]),
          ...grp('Settlement', [
            T('approver', 'Approver', { table: false }),
            DT('paymentDate', 'Payment date', { table: false }),
            URLF('receiptUrl', 'Receipt URL'),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'loans',
        label: 'Loans & Advances',
        Icon: BankOutlined,
        entity: 'loanadvance',
        fields: [
          ...grp('Request', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            SEL('type', 'Type', ['Salary Advance', 'Personal Loan', 'Emergency Loan', 'Travel Advance']),
            SEL('status', 'Status', ['Requested', 'Approved', 'Disbursed', 'Repaying', 'Closed', 'Rejected']),
          ]),
          ...grp('Amount', [
            NUM('amount', 'Amount'),
            SEL('currency', 'Currency', CURRENCY, { table: false }),
            NUM('tenureMonths', 'Tenure (months)', { table: false }),
            NUM('emi', 'EMI', { table: false }),
            NUM('outstanding', 'Outstanding'),
          ]),
          ...grp('Processing', [
            DT('requestDate', 'Request date', { table: false }),
            T('approver', 'Approver', { table: false }),
            DT('disbursedDate', 'Disbursed date', { table: false }),
            AREA('reason', 'Reason'),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'training',
        label: 'Training & Development',
        Icon: BookOutlined,
        entity: 'trainingprogram',
        fields: [
          ...grp('Program', [
            T('title', 'Title', { required: true }),
            SEL('category', 'Category', ['Onboarding', 'Compliance', 'Technical', 'Leadership', 'Soft Skills', 'Product', 'Safety']),
            SEL('mode', 'Mode', ['Online', 'Classroom', 'Workshop', 'Self-paced', 'External'], { table: false }),
            T('trainer', 'Trainer'),
            T('audience', 'Audience', { table: false }),
            SEL('status', 'Status', ['Planned', 'Open', 'Running', 'Completed', 'Cancelled']),
            BOOL('mandatory', 'Mandatory'),
          ]),
          ...grp('Schedule', [
            DT('startDate', 'Start date'),
            DT('endDate', 'End date', { table: false }),
            NUM('durationHours', 'Duration (hrs)', { table: false }),
            NUM('cost', 'Cost', { table: false }),
          ]),
          ...grp('Participation', [
            NUM('seats', 'Seats', { table: false }),
            NUM('enrolled', 'Enrolled'),
            NUM('completed', 'Completed', { table: false }),
            NUM('completionRate', 'Completion %', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'assets',
        label: 'Assets',
        Icon: LaptopOutlined,
        entity: 'hrasset',
        fields: [
          ...grp('Asset', [
            T('assetTag', 'Asset tag', { required: true }),
            SEL('category', 'Category', ['Laptop', 'Desktop', 'Monitor', 'Phone', 'SIM', 'Access Card', 'Headset', 'Furniture', 'Software License', 'Other']),
            T('model', 'Model'),
            T('serialNumber', 'Serial number', { table: false }),
            SEL('status', 'Status', ['In Stock', 'Assigned', 'In Repair', 'Retired', 'Lost']),
            SEL('condition', 'Condition', ['New', 'Good', 'Fair', 'Damaged', 'Retired'], { table: false }),
          ]),
          ...grp('Assignment', [
            T('assignedTo', 'Assigned to'),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            DT('issueDate', 'Issue date'),
            DT('returnDate', 'Return date', { table: false }),
            NUM('value', 'Value', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'documents',
        label: 'Documents',
        Icon: FolderOpenOutlined,
        entity: 'hrdocument',
        fields: [
          ...grp('Document', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('docType', 'Type', ['Offer Letter', 'Appointment Letter', 'Contract', 'ID Proof', 'Address Proof', 'PAN', 'Aadhaar', 'Educational', 'Experience', 'Relieving Letter', 'Payslip', 'Other']),
            T('title', 'Title', { table: false }),
            SEL('status', 'Status', ['Pending', 'Received', 'Verified', 'Rejected', 'Expired']),
            BOOL('confidential', 'Confidential'),
          ]),
          ...grp('Details', [
            URLF('fileUrl', 'File URL'),
            DT('issueDate', 'Issue date', { table: false }),
            DT('expiryDate', 'Expiry date', { table: false }),
            T('uploadedBy', 'Uploaded by', { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
      {
        key: 'helpdesk',
        label: 'HR Helpdesk',
        Icon: CustomerServiceOutlined,
        entity: 'hrticket',
        fields: [
          ...grp('Ticket', [
            T('raisedBy', 'Raised by', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            SEL('category', 'Category', ['Payroll', 'Leave', 'Attendance', 'Benefits', 'IT Access', 'Facilities', 'Grievance', 'Policy', 'Other']),
            T('subject', 'Subject'),
            SEL('priority', 'Priority', ['Low', 'Normal', 'High', 'Urgent']),
            SEL('status', 'Status', ['Open', 'In Progress', 'On Hold', 'Resolved', 'Closed']),
          ]),
          ...grp('Handling', [
            T('assignedTo', 'Assigned to'),
            DT('raisedOn', 'Raised on', { table: false }),
            DT('resolvedOn', 'Resolved on', { table: false }),
            AREA('description', 'Description'),
            AREA('resolution', 'Resolution'),
          ]),
        ],
      },
      {
        key: 'announcements',
        label: 'Announcements',
        Icon: SoundOutlined,
        entity: 'announcement',
        fields: [
          ...grp('Announcement', [
            T('title', 'Title', { required: true }),
            SEL('category', 'Category', ['General', 'Policy', 'Event', 'Holiday', 'Payroll', 'Benefits', 'Emergency', 'Celebration']),
            T('audience', 'Audience'),
            T('publishedBy', 'Published by', { table: false }),
            SEL('status', 'Status', ['Draft', 'Scheduled', 'Published', 'Archived']),
          ]),
          ...grp('Publishing', [
            DT('publishDate', 'Publish date'),
            DT('expiryDate', 'Expiry date', { table: false }),
            BOOL('pinned', 'Pinned'),
            BOOL('acknowledgementRequired', 'Acknowledgement required'),
            NUM('readCount', 'Read count', { table: false }),
          ]),
          ...grp('Content', [AREA('body', 'Body')]),
        ],
      },
      {
        key: 'recognition',
        label: 'Recognition',
        Icon: GiftOutlined,
        entity: 'recognition',
        fields: [
          ...grp('Award', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            SEL('awardType', 'Award type', ['Employee of the Month', 'Spot Award', 'Team Award', 'Long Service', 'Values Champion', 'Peer Recognition']),
            T('givenBy', 'Given by'),
          ]),
          ...grp('Details', [
            DT('date', 'Date'),
            NUM('points', 'Points'),
            SEL('status', 'Status', ['Nominated', 'Approved', 'Awarded', 'Rejected']),
            SEL('visibility', 'Visibility', ['Public', 'Team', 'Private'], { table: false }),
            AREA('reason', 'Reason'),
          ]),
        ],
      },
      {
        key: 'exit',
        label: 'Exit & Offboarding',
        Icon: LogoutOutlined,
        entity: 'exitrecord',
        fields: [
          ...grp('Exit', [
            T('employee', 'Employee', { required: true }),
            T('employeeId', 'Employee ID', { table: false }),
            SEL('department', 'Department', DEPARTMENTS, { table: false }),
            T('designation', 'Designation', { table: false }),
            SEL('exitType', 'Exit type', ['Resignation', 'Termination', 'Retirement', 'End of Contract', 'Absconding']),
            SEL('reason', 'Reason', ['Better Opportunity', 'Compensation', 'Relocation', 'Personal', 'Higher Studies', 'Work Environment', 'Performance', 'Other'], { table: false }),
          ]),
          ...grp('Timeline', [
            DT('resignationDate', 'Resignation date', { table: false }),
            DT('lastWorkingDay', 'Last working day'),
            NUM('noticePeriodServedDays', 'Notice served (days)', { table: false }),
            SEL('status', 'Status', ['Initiated', 'Notice Period', 'Clearance Pending', 'Exit Interview', 'FnF Pending', 'Completed']),
          ]),
          ...grp('Clearance', [
            BOOL('clearanceIT', 'IT cleared'),
            BOOL('clearanceFinance', 'Finance cleared'),
            BOOL('clearanceHR', 'HR cleared'),
            BOOL('clearanceManager', 'Manager cleared'),
            BOOL('exitInterviewDone', 'Exit interview done'),
          ]),
          ...grp('Settlement', [
            NUM('fnfAmount', 'FnF amount', { table: false }),
            DT('fnfSettledDate', 'FnF settled date', { table: false }),
            BOOL('rehireEligible', 'Rehire eligible'),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
    ],
  },

  // ===========================================================================
  {
    key: 'messenger',
    label: 'Messenger',
    module: 'Messenger',
    route: '/messenger',
    Icon: CommentOutlined,
    blurb: 'Team chat plus shared WhatsApp, SMS and email inboxes.',
    tabs: [
      { key: 'chat', label: 'Team Chat', Icon: CommentOutlined, embed: 'teamChat' },
      {
        key: 'whatsapp',
        label: 'WhatsApp',
        Icon: WhatsAppOutlined,
        entity: 'messengerconversation',
        fixedFilter: { field: 'channel', value: 'WhatsApp' },
        fields: messengerConversationFields('Number'),
      },
      {
        key: 'sms',
        label: 'SMS',
        Icon: MobileOutlined,
        entity: 'messengerconversation',
        fixedFilter: { field: 'channel', value: 'SMS' },
        fields: messengerConversationFields('Number'),
      },
      {
        key: 'email',
        label: 'Email',
        Icon: MailOutlined,
        entity: 'messengerconversation',
        fixedFilter: { field: 'channel', value: 'Email' },
        fields: messengerConversationFields('Address'),
      },
      {
        key: 'broadcasts',
        label: 'Broadcasts',
        Icon: NotificationOutlined,
        entity: 'messengerbroadcast',
        fields: [
          ...grp('Broadcast', [
            T('name', 'Name', { required: true }),
            SEL('channel', 'Channel', ['WhatsApp', 'SMS', 'Email']),
            T('templateRef', 'Template ref', { table: false }),
            T('audience', 'Audience'),
            SEL('status', 'Status', ['Draft', 'Scheduled', 'Sending', 'Sent', 'Paused', 'Failed', 'Cancelled']),
            T('owner', 'Owner', { table: false }),
          ]),
          ...grp('Send', [
            DT('scheduledAt', 'Scheduled at'),
            DT('sentAt', 'Sent at', { table: false }),
            NUM('recipientCount', 'Recipients', { table: false }),
            NUM('throttlePerMin', 'Throttle / min', { table: false }),
          ]),
          ...grp('Results', [
            NUM('sentCount', 'Sent'),
            NUM('deliveredCount', 'Delivered', { table: false }),
            NUM('readCount', 'Read', { table: false }),
            NUM('replyCount', 'Replies', { table: false }),
            NUM('failedCount', 'Failed', { table: false }),
          ]),
          ...grp('Message', [AREA('message', 'Message'), T('notes', 'Notes', { table: false })]),
        ],
      },
      {
        key: 'contacts',
        label: 'Contacts',
        Icon: ContactsOutlined,
        entity: 'messengercontact',
        fields: [
          ...grp('Contact', [
            T('name', 'Name', { required: true }),
            TEL('phone', 'Phone'),
            EM('email', 'Email'),
            T('company', 'Company', { table: false }),
            SEL('lifecycleStage', 'Lifecycle', ['Lead', 'Prospect', 'Customer', 'Churned'], { table: false }),
            T('owner', 'Owner', { table: false }),
            T('tags', 'Tags', { table: false }),
          ]),
          ...grp('Consent', [
            BOOL('whatsappOptIn', 'WhatsApp opt-in'),
            BOOL('smsOptIn', 'SMS opt-in'),
            BOOL('emailOptIn', 'Email opt-in'),
            SEL('consent', 'Consent', ['Opted-in', 'Opted-out', 'Pending', 'Unknown']),
            DT('consentDate', 'Consent date', { table: false }),
          ]),
          ...grp('Activity', [
            SEL('source', 'Source', ['Manual', 'Import', 'Web Form', 'CRM Sync', 'Inbound Message'], { table: false }),
            DT('lastContactedAt', 'Last contacted'),
            SEL('lastChannel', 'Last channel', ['WhatsApp', 'SMS', 'Email', 'Call'], { table: false }),
            AREA('notes', 'Notes'),
          ]),
        ],
      },
    ],
  },
];

function messengerConversationFields(handleLabel) {
  return [
    ...grp('Conversation', [
      T('contact', 'Contact', { required: true }),
      T('handle', handleLabel),
      T('subject', 'Subject', { table: false }),
      SEL('status', 'Status', ['Open', 'Pending', 'Snoozed', 'Resolved', 'Closed']),
      SEL('priority', 'Priority', ['Low', 'Normal', 'High', 'Urgent']),
    ]),
    ...grp('Assignment', [
      T('assignedTo', 'Assigned to'),
      T('team', 'Team', { table: false }),
      T('tags', 'Tags', { table: false }),
    ]),
    ...grp('Activity', [
      AREA('lastMessage', 'Last message'),
      DT('lastMessageAt', 'Last message at'),
      SEL('lastDirection', 'Last direction', ['Inbound', 'Outbound'], { table: false }),
      NUM('unreadCount', 'Unread', { table: false }),
      NUM('messageCount', 'Messages', { table: false }),
      NUM('firstResponseMin', 'First response (min)', { table: false }),
      BOOL('withinWindow', 'Within 24h window'),
      AREA('notes', 'Notes'),
    ]),
  ];
}

// One route per sub-tab: /<section>/<tab>. Consumed by router/routes.jsx,
// which also adds a /<section> -> first-tab redirect.
export const FEATURE_ROUTES = FEATURE_SECTIONS.flatMap((section) =>
  section.tabs.map((tab) => ({
    path: `${section.route}/${tab.key}`,
    section,
    tab,
  }))
);

// Resolve a section from a route path like '/hr' or '/hr/employees'.
export function findSection(pathname) {
  const seg = '/' + String(pathname || '').replace(/^\//, '').split('/')[0];
  return FEATURE_SECTIONS.find((s) => s.route === seg) || null;
}

// Resolve { section, tab } from a full path like '/hr/employees'.
export function findFeatureTab(pathname) {
  const parts = String(pathname || '').replace(/^\//, '').split('/');
  const section = FEATURE_SECTIONS.find((s) => s.route === '/' + parts[0]);
  if (!section) return null;
  const tab = section.tabs.find((t) => t.key === parts[1]) || section.tabs[0];
  return { section, tab };
}
