const express = require('express');
const mongoose = require('mongoose');
const { catchErrors } = require('../../../handlers/errorHandlers');
const auditLog = require('../../../services/lms/auditLog');

// Public certificate verification (design L15) — mounted before the bearer
// gate so anyone holding a certificate ID (or its QR) can check it without
// logging in. Returns only what a verifier needs: programme, holder's first
// name + last initial, issue date, ID and whether it is valid. Never marks,
// contact details or internal notes. Each lookup is audit-logged.
const router = express.Router();

const ID_RE = /^[A-Za-z0-9-]{6,40}$/;

function maskName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

router.get(
  '/:certificateId',
  catchErrors(async (req, res) => {
    const id = String(req.params.certificateId || '').trim();
    if (!ID_RE.test(id)) return res.status(400).json({ success: false, result: null, message: 'That does not look like a certificate ID.' });
    const c = await mongoose.model('Certificate').findOne({ certificateId: id, removed: false }).lean();
    if (!c || c.status === 'Draft') {
      return res.status(404).json({ success: false, result: { found: false }, message: 'No certificate with that ID.' });
    }
    await auditLog.record({ module: 'certificate', action: 'public-verify', entityType: 'Certificate', entityId: c._id, meta: { certificateId: id } });
    return res.status(200).json({
      success: true,
      result: {
        found: true,
        valid: ['Issued', 'Sent'].includes(c.status),
        status: c.status === 'Revoked' ? 'revoked' : c.status === 'Replaced' ? 'replaced' : 'valid',
        // §27 step 9: a corrected certificate names the ID that replaced it
        replacedBy: c.status === 'Replaced' ? c.replacedBy || null : null,
        certificateId: c.certificateId,
        title: c.title || c.course,
        course: c.course,
        issuedTo: maskName(c.student),
        issuedOn: c.issuedOn,
        validUntil: c.validUntil || null,
        issuedBy: c.issuedBy || 'Career Lab Consulting',
        checkedAt: new Date(),
      },
    });
  })
);

module.exports = router;
