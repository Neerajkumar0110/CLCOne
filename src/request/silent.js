import axios from "axios";
import { API_BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";

// Bare GET/POST that return response.data and swallow every error (→ null).
// For background pollers (presence heartbeat, conversation/thread refresh,
// notification refresh) that run on a short interval and must NOT trigger
// request.js's error toast on each failed tick. A missed poll is silent;
// the next tick recovers.

function authHeaders() {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function silentGet(path) {
  try {
    const { data } = await axios.get(API_BASE_URL + path, { headers: authHeaders() });
    return data;
  } catch (e) {
    return null;
  }
}

export async function silentPost(path, body = {}) {
  try {
    const { data } = await axios.post(API_BASE_URL + path, body, { headers: authHeaders() });
    return data;
  } catch (e) {
    return null;
  }
}
