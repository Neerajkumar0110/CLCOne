import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/request";

// Serialise the shell's filter state into a query string the analytics API
// understands. Arrays → comma lists; empty values dropped.
export function buildQuery({ from, to, businessType, dateBasis, drawer }) {
  const params = new URLSearchParams();
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());
  if (businessType && businessType !== "all") params.set("businessType", businessType);
  if (dateBasis) params.set("dateBasis", dateBasis);
  Object.entries(drawer || {}).forEach(([k, v]) => {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    params.set(k, Array.isArray(v) ? v.join(",") : String(v));
  });
  return params.toString();
}

/**
 * Fetches GET /api/analytics/:module/summary for the given query. Debounced,
 * cancels the in-flight request on change, exposes {data,loading,error,reload}.
 */
export default function useDashboardData(module, query) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const qs = buildQuery(query);
  const reqId = useRef(0);
  const timer = useRef(null);

  const run = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError("");
    const r = await request.get({ entity: `analytics/${module}/summary?${qs}` });
    if (id !== reqId.current) return; // superseded
    if (r && r.success) {
      setData(r.result);
    } else {
      setError((r && r.message) || "Couldn't load this dashboard.");
    }
    setLoading(false);
  }, [module, qs]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, 150);
    return () => timer.current && clearTimeout(timer.current);
  }, [run]);

  return { data, loading, error, reload: run };
}
