// GET /api/utils/pincode/:code — resolves an Indian PIN code to its
// City (post office / block) and State, so the in-call modal's Pin Code
// field can auto-fill City/State (see components/ActiveCallModal). Proxied
// server-side (not called directly from the browser) so there's no CORS
// dependency on the third-party API staying reachable client-side, and so
// a slow/failed lookup never exposes an external hostname in the network
// tab. No local pincode dataset exists in this repo — see the 2026-10
// investigation that confirmed that — so this calls the free, keyless India
// Post pincode API rather than bundling/maintaining a ~19,000-row dataset.
const PINCODE_RE = /^\d{6}$/;

async function pincode(req, res) {
  const code = String(req.params.code || '').trim();
  if (!PINCODE_RE.test(code)) {
    return res.status(400).json({ success: false, result: null, message: 'Pin code must be exactly 6 digits.' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const apiRes = await fetch(`https://api.postalpincode.in/pincode/${code}`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await apiRes.json();

    const entry = Array.isArray(data) ? data[0] : null;
    const office = entry && entry.Status === 'Success' && Array.isArray(entry.PostOffice) ? entry.PostOffice[0] : null;

    if (!office) {
      return res.status(200).json({ success: false, result: null, message: 'No match found for this pin code.' });
    }

    return res.status(200).json({
      success: true,
      result: {
        city: office.Block && office.Block !== 'NA' ? office.Block : office.District,
        district: office.District,
        state: office.State,
        country: office.Country || 'India',
      },
      message: 'ok',
    });
  } catch (e) {
    return res.status(200).json({ success: false, result: null, message: 'Pin code lookup is unavailable right now.' });
  }
}

module.exports = pincode;
