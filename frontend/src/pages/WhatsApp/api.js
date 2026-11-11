import axios from 'axios';
import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';

// /api/whatsapp/* client. Errors come back as { success:false, message } so
// screens can show the backend's own wording (e.g. "Scan the QR code first").
const http = () => {
  const token = storePersist.get('auth')?.current?.token;
  return axios.create({
    baseURL: API_BASE_URL + 'whatsapp/',
    withCredentials: true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
};

async function wrap(p) {
  try {
    const res = await p;
    return res.data;
  } catch (err) {
    return {
      success: false,
      status: err.response?.status,
      message: err.response?.data?.message || err.message || 'Something went wrong.',
    };
  }
}

const waApi = {
  me: () => wrap(http().get('me')),
  createDevice: (phoneNumber) => wrap(http().post('device', { phoneNumber })),
  removeDevice: () => wrap(http().delete('device')),
  deviceStatus: () => wrap(http().get('device/status')),
  // QR is a PNG behind auth — fetch as a blob and hand back an object URL.
  qrImage: async () => {
    try {
      const res = await http().get('device/qr', { responseType: 'blob' });
      return { success: true, url: URL.createObjectURL(res.data) };
    } catch (err) {
      let message = 'QR code is not available right now.';
      try {
        const text = await err.response?.data?.text?.();
        message = JSON.parse(text).message || message;
      } catch (_) {
        /* keep default */
      }
      return { success: false, status: err.response?.status, message };
    }
  },
  chats: (params = {}) => wrap(http().get('chats', { params })),
  openChat: (number, name) => wrap(http().post('chats', { number, name })),
  messages: (chatId) => wrap(http().get(`chats/${chatId}/messages`)),
  markRead: (chatId) => wrap(http().post(`chats/${chatId}/read`)),
  send: (chatId, message) => wrap(http().post(`chats/${chatId}/send`, { message })),
  getAccess: () => wrap(http().get('admin/access')),
  saveAccess: (body) => wrap(http().put('admin/access', body)),
  refreshDevices: () => wrap(http().post('admin/devices/refresh')),
};

export default waApi;
