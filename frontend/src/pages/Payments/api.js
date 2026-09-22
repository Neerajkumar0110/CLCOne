import { request } from '@/request';

// Thin client for the CRM's /api/payments/* endpoints (admin, behind the
// normal CRM bearer token) — see backend/src/routes/appRoutes/payments/paymentsApi.js.

const qs = (o = {}) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
};

const paymentsApi = {
  create: (payload) => request.post({ entity: 'payments', jsonData: payload }),
  list: (params) => request.get({ entity: `payments${qs(params)}` }),
  get: (id) => request.get({ entity: `payments/${id}` }),
  resend: (id) => request.post({ entity: `payments/${id}/resend`, jsonData: {} }),
  refresh: (id) => request.post({ entity: `payments/${id}/refresh`, jsonData: {} }),
};

export default paymentsApi;
