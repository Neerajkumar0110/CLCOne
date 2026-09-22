const mongoose = require('mongoose');

// GET /api/payments?page=&limit=&q= — admin list, newest first. `q` matches
// student name/email/course/agent (simple case-insensitive contains). Capped
// well above the CRM's usual page sizes so the Finance "Payments" tab (which
// fetches the whole set once and filters client-side) can pull everything
// in one call.
async function list(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 20));
  const q = String(req.query.q || '').trim();

  const filter = { removed: false };
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ studentName: rx }, { studentEmail: rx }, { course: rx }, { createdByName: rx }];
  }

  const [items, count] = await Promise.all([
    PaymentRequest.find(filter)
      .sort({ created: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PaymentRequest.countDocuments(filter),
  ]);

  // Batched KYC-submitted lookup instead of N+1 — kycSubmitted already lives
  // on the PaymentRequest doc itself (set by submitKyc), so this is just a
  // straight map, no extra query needed.
  return res.status(200).json({
    success: true,
    result: items.map((p) => ({
      id: String(p._id),
      publicToken: p.publicToken,
      studentName: p.studentName,
      studentEmail: p.studentEmail,
      course: p.course,
      amount: p.amount,
      status: p.status,
      shortUrl: p.razorpayShortUrl,
      emailSent: p.emailSent,
      kycSubmitted: p.kycSubmitted,
      createdByName: p.createdByName,
      created: p.created,
      paidAt: p.paidAt,
      installmentNo: p.installmentNo,
      installmentCount: p.installmentCount,
    })),
    pagination: { page, pages: Math.max(1, Math.ceil(count / limit)), count },
  });
}

module.exports = list;
