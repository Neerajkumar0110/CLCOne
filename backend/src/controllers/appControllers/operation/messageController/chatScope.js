const mongoose = require('mongoose');
const { SALES_ROLE_ORDER, CRM_ADMIN_ROLES } = require('../../../../config/roles');

// Team Chat reach. A Sales user (Sales Manager … Sales Intern) chats with
// the whole Sales team plus the admins; everyone else sees everyone.
const SALES_CHAT_ROLES = [...SALES_ROLE_ORDER, ...CRM_ADMIN_ROLES];

const isSalesUser = (admin) => SALES_ROLE_ORDER.includes(admin && admin.role);

// Extra Admin filter for "who can I see / message".
function peopleFilter(admin) {
  return isSalesUser(admin) ? { role: { $in: SALES_CHAT_ROLES } } : {};
}

async function canChatWith(admin, otherId) {
  if (!isSalesUser(admin)) return true;
  const other = await mongoose.model('Admin').findOne({ _id: otherId, removed: false }).select('role').lean();
  return !!other && SALES_CHAT_ROLES.includes(other.role);
}

module.exports = { peopleFilter, canChatWith, isSalesUser };
