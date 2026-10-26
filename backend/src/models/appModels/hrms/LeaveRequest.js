const mongoose = require('mongoose');
const { featureSchema } = require('../../utils/featureSchema');

// Auto-CRUD model for a feature-section tab — list/create/update/delete come
// from the generic controller. Field spec mirrors config/featureSections.js.
module.exports = mongoose.model(
  'LeaveRequest',
  featureSchema([
    { name: 'employee', type: 'String', required: true },
    { name: 'employeeId', type: 'String' },
    { name: 'department', type: 'String', enum: ["Sales","Marketing","Operations","Engineering","HR","Finance","Support","Training","Admin"] },
    { name: 'leaveType', type: 'String', enum: ["Casual","Sick","Earned","Unpaid","Comp Off","Maternity","Paternity","Bereavement"], default: "Casual" },
    { name: 'fromDate', type: 'Date' },
    { name: 'toDate', type: 'Date' },
    { name: 'days', type: 'Number', default: 1 },
    { name: 'halfDay', type: 'Boolean', default: false },
    { name: 'reason', type: 'String' },
    { name: 'status', type: 'String', enum: ["Pending","Approved","Rejected","Cancelled","Withdrawn"], default: "Pending" },
    { name: 'approver', type: 'String' },
    { name: 'appliedOn', type: 'Date' },
    { name: 'decisionDate', type: 'Date' },
    { name: 'contactDuringLeave', type: 'String' },
    { name: 'handoverTo', type: 'String' },
    { name: 'decisionNote', type: 'String' },
    // Self-service leave from the header (services/hr/workday.js) — the
    // applicant's Admin id, how long (1–2 hours / half day / day / days) and
    // the exact window: fromDate/toDate carry the start/end TIME too, which
    // is what pauses or keeps off their auto-dialer.
    { name: 'adminId', type: 'String' },
    { name: 'durationType', type: 'String', enum: ['hours', 'half', 'full', 'multi'] },
    { name: 'hours', type: 'Number' },
    { name: 'halfPart', type: 'String', enum: ['first', 'second'] },
    { name: 'fromTime', type: 'String' },
    { name: 'decisionToken', type: 'String' }, // one-click Approve/Reject link from the email
    { name: 'decisionBy', type: 'String' },
  ])
);
