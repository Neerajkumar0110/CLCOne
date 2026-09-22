// The 21 policy/agreement types from the LMS functional-requirements spec
// (§12 Policies, Agreements & Acknowledgement Centre), plus 'Other' for
// anything management adds later. Shared by the PolicyDocument model and
// the policies controller. Frontend keeps its own copy in sync by hand
// (same convention as config/roles.js — can't share a literal import
// across the backend/frontend package boundary).
const CATEGORIES = [
  'Placement Assurance Agreement',
  'Program Terms & Conditions',
  'Attendance Policy',
  'Assessment & Examination Policy',
  'Attempt / Retake Policy',
  'Disqualification / Qualification Policy',
  'Project Submission & Evaluation Policy',
  'Code of Conduct',
  'Class Participation & Camera/Microphone Policy',
  'Academic Integrity / Plagiarism Policy',
  'AI Usage Policy',
  'Privacy Policy / Data Processing Notice',
  'Communication Consent Policy',
  'Refund / Cancellation Policy',
  'Leave / Absence Policy',
  'Certificate Eligibility Policy',
  'Placement Participation / Interview Policy',
  'Project Confidentiality / IP Policy',
  'Recording & Content Usage Policy',
  'Payment / Fee / EMI Policy',
  'Voucher / Coupon / Offer Terms',
  'Curriculum Change / Batch Transfer Policy',
  'Other',
];

module.exports = { CATEGORIES };
