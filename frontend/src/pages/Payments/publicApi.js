import axios from 'axios';
import { API_BASE_URL } from '@/config/serverApiConfig';

// The public KYC page (frontend/src/pages/Payments/PublicKycForm.jsx) is
// reached by a student who was never logged into the CRM — nothing has ever
// called request.js's includeToken(), so axios.defaults.baseURL may not be
// set yet. A dedicated instance avoids depending on that global side effect.
const client = axios.create({ baseURL: API_BASE_URL });

const paymentsPublicApi = {
  status: (token) => client.get(`payments/public/${token}`).then((r) => r.data),
  uploadDoc: (token, file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post(`payments/public/${token}/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  submitKyc: (token, payload) => client.post(`payments/public/${token}/kyc`, payload).then((r) => r.data),
};

export default paymentsPublicApi;
