import React, { useState, useEffect } from "react";
import axios from "axios";
import { message } from "antd";
import { request } from "@/request";
import { API_BASE_URL, BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
import {
  GlobalOutlined,
  FacebookOutlined,
  GoogleOutlined,
  LinkedinOutlined,
  PlusOutlined,
  LeftOutlined,
  RightOutlined,
  LinkOutlined,
  RocketOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  DisconnectOutlined,
} from "@ant-design/icons";
import { LeadDetailModal } from "@/pages/Leads";

// Moved out of Leads/index.jsx (Sales) into Marketing — this is ad-platform
// lead capture: the embeddable capture form field config plus the
// Facebook/Google/LinkedIn Ads connection + campaign setup flows that back
// it. Nothing here changed, only where it's mounted (see
// config/featureSections.js's 'marketing' section + ModuleScaffold's
// 'marketingCaptureForm' embed).

// Brand-colored icon badge per lead source, used on the "Where does this
// form run?" toggle and anywhere else a platform needs a quick visual tag.
const PLATFORM_ICON_META = {
  Website: { icon: <GlobalOutlined />, color: "#0ea5e9" },
  "Facebook Ads": { icon: <FacebookOutlined />, color: "#1877F2" },
  "Google Ads": { icon: <GoogleOutlined />, color: "#EA4335" },
  "LinkedIn Ads": { icon: <LinkedinOutlined />, color: "#0A66C2" },
};

const FIELD_LIBRARY = [
  { key: "name", label: "Full Name", type: "Text" },
  { key: "email", label: "Email Address", type: "Email" },
  { key: "phone", label: "Phone Number", type: "Text" },
  { key: "whatsapp", label: "WhatsApp Number", type: "WhatsApp" },
  { key: "course", label: "Course / Interest", type: "Text" },
  { key: "city", label: "City", type: "Text" },
  { key: "source", label: "How did you hear about us?", type: "Dropdown", options: ["Facebook", "Instagram", "Google Search", "LinkedIn", "YouTube", "Referral", "Other"] },
  { key: "budget", label: "Budget Range", type: "Dropdown", options: ["Under ₹10,000", "₹10,000 – ₹25,000", "₹25,000 – ₹50,000", "₹50,000+"] },
  { key: "howSoon", label: "How Soon to Start?", type: "Dropdown", options: ["Immediate", "Within 1 Week", "Within 15 Days", "Within 30 Days", "Just exploring"] },
  { key: "message", label: "Message", type: "Textarea" },
];

const DEFAULT_ENABLED = {
  name: true,
  email: true,
  phone: true,
  whatsapp: false,
  course: true,
  city: false,
  source: true,
  budget: false,
  howSoon: false,
  message: false,
};

const CTA_OPTIONS = ["LEARN_MORE", "SIGN_UP", "APPLY_NOW", "GET_QUOTE", "CONTACT_US", "SUBSCRIBE"];

// Maps the "Where does this form run?" toggle value to the `source` value
// captured leads are filtered by (see loadCapturedLeads below) — kept as a
// lookup rather than a growing ternary now that there are four platforms.
const PLATFORM_SOURCE_MAP = {
  "Facebook Ads": "Facebook Ads",
  "Google Ads": "Google Ads",
  "LinkedIn Ads": "LinkedIn Ads",
  Website: "Website",
};

// DELETE a lead without request.js's automatic per-call success toast, so
// a bulk delete can show a single summary message instead of one toast
// per row. Same auth-header pattern as the disconnect helpers below.
async function deleteLeadRaw(id) {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.delete(`${API_BASE_URL}lead/delete/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// Raw axios call for the one action request.js's helpers don't fit — DELETE
// with no id suffix. Mirrors downloadLeadsExport's auth-header pattern above.
async function disconnectFacebookConnection() {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.delete(`${API_BASE_URL}facebook/connection`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// Same shape as disconnectFacebookConnection above, for Google Ads.
async function disconnectGoogleConnection() {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.delete(`${API_BASE_URL}google/connection`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// Same shape as disconnectFacebookConnection above, for LinkedIn Ads.
async function disconnectLinkedinConnection() {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.delete(`${API_BASE_URL}linkedin/connection`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

function CaptureForm() {
  const [enabled, setEnabled] = useState(DEFAULT_ENABLED);
  const [platform, setPlatform] = useState("Website");
  const [configId, setConfigId] = useState(null);
  const [metaFormId, setMetaFormId] = useState(null);
  const [formStatus, setFormStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [viewLead, setViewLead] = useState(null);

  // Hosted landing-page link builder (for pointing ads straight at the CRM).
  const [lpCampaign, setLpCampaign] = useState("");
  const [lpSource, setLpSource] = useState("Facebook");
  const [lpCopyMessage, setLpCopyMessage] = useState("");

  // Real Facebook connection state — never a hard-coded boolean.
  const [connection, setConnection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [pages, setPages] = useState([]);
  const [adAccounts, setAdAccounts] = useState([]);
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState("");
  const [creatingForm, setCreatingForm] = useState(false);

  // Real Google Ads connection state — mirrors the Facebook state above.
  // Google's webhook has no subscribe step (see the connection card below).
  const [googleConnection, setGoogleConnection] = useState(null);
  const [googleConnectionLoading, setGoogleConnectionLoading] = useState(true);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleConnectionMessage, setGoogleConnectionMessage] = useState("");
  const [googleAccounts, setGoogleAccounts] = useState([]);
  const [googleCopyMessage, setGoogleCopyMessage] = useState("");

  // Real LinkedIn Ads connection state — mirrors the Facebook state above.
  // There's no Organization-listing endpoint (only ad-accounts is exposed —
  // see linkedinApi.js), so Organization is a typed ID, not a <select>.
  const [linkedinConnection, setLinkedinConnection] = useState(null);
  const [linkedinConnectionLoading, setLinkedinConnectionLoading] = useState(true);
  const [linkedinConnecting, setLinkedinConnecting] = useState(false);
  const [linkedinConnectionMessage, setLinkedinConnectionMessage] = useState("");
  const [linkedinAdAccounts, setLinkedinAdAccounts] = useState([]);
  const [orgIdInput, setOrgIdInput] = useState("");
  const [orgNameInput, setOrgNameInput] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);

  const [capturedLeads, setCapturedLeads] = useState([]);
  const [capturedLoading, setCapturedLoading] = useState(true);
  const [capturedPage, setCapturedPage] = useState(1);
  const [capturedPages, setCapturedPages] = useState(1);
  const [capturedCount, setCapturedCount] = useState(0);

  const activeFields = FIELD_LIBRARY.filter((f) => enabled[f.key]);

  const loadConfig = async (plat) => {
    const res = await request.listAll({ entity: "captureformconfig" });
    const all = res?.success ? res.result : [];
    const found = all.find((c) => c.platform === plat && !c.removed);
    if (found) {
      setConfigId(found._id);
      const map = { ...DEFAULT_ENABLED };
      Object.keys(map).forEach((k) => (map[k] = false));
      (found.fields || []).forEach((f) => {
        map[f.key] = !!f.enabled;
      });
      setEnabled(map);
      setMetaFormId(found.metaFormId || null);
      setFormStatus(found.status || "draft");
    } else {
      setConfigId(null);
      setEnabled(DEFAULT_ENABLED);
      setMetaFormId(null);
      setFormStatus("draft");
    }
  };

  const loadConnection = async () => {
    setConnectionLoading(true);
    const res = await request.get({ entity: "facebook/connection" });
    setConnection(res?.success ? res.result : null);
    setConnectionLoading(false);
  };

  const loadPagesAndAdAccounts = async () => {
    const [pagesRes, adAccRes] = await Promise.all([
      request.get({ entity: "facebook/pages" }),
      request.get({ entity: "facebook/ad-accounts" }),
    ]);
    setPages(pagesRes?.success ? pagesRes.result : []);
    setAdAccounts(adAccRes?.success ? adAccRes.result : []);
  };

  const loadGoogleConnection = async () => {
    setGoogleConnectionLoading(true);
    const res = await request.get({ entity: "google/connection" });
    setGoogleConnection(res?.success ? res.result : null);
    setGoogleConnectionLoading(false);
  };

  const loadGoogleAccounts = async () => {
    const res = await request.get({ entity: "google/customer-accounts" });
    setGoogleAccounts(res?.success ? res.result : []);
  };

  const loadLinkedinConnection = async () => {
    setLinkedinConnectionLoading(true);
    const res = await request.get({ entity: "linkedin/connection" });
    setLinkedinConnection(res?.success ? res.result : null);
    setLinkedinConnectionLoading(false);
  };

  const loadLinkedinAdAccounts = async () => {
    const res = await request.get({ entity: "linkedin/ad-accounts" });
    setLinkedinAdAccounts(res?.success ? res.result : []);
  };

  const loadCapturedLeads = async (targetPage = 1) => {
    setCapturedLoading(true);
    const options = {
      page: targetPage,
      items: 10,
      filter: "source",
      equal: PLATFORM_SOURCE_MAP[platform] || "Website",
    };
    const res = await request.list({ entity: "lead", options });
    setCapturedLeads(res?.success ? res.result : []);
    setCapturedPages(res?.pagination?.pages || 1);
    setCapturedCount(res?.pagination?.count || 0);
    setCapturedPage(targetPage);
    setCapturedLoading(false);
  };

  useEffect(() => {
    loadConfig(platform);
    loadCapturedLeads(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  useEffect(() => {
    loadConnection();
  }, []);

  useEffect(() => {
    if (connection?.connected) loadPagesAndAdAccounts();
  }, [connection?.connected]);

  // Listens for the OAuth popup's postMessage (see backend facebookController
  // /callback.js) — no full-page navigation away from the app.
  useEffect(() => {
    const handler = (event) => {
      if (!event.data || !String(event.data.type || "").startsWith("fb-oauth-")) return;
      if (event.data.type === "fb-oauth-success") {
        loadConnection();
      } else {
        setConnectionMessage(event.data.message || "Facebook connection failed.");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    loadGoogleConnection();
    loadLinkedinConnection();
  }, []);

  useEffect(() => {
    if (googleConnection?.connected) loadGoogleAccounts();
  }, [googleConnection?.connected]);

  useEffect(() => {
    if (linkedinConnection?.connected) loadLinkedinAdAccounts();
  }, [linkedinConnection?.connected]);

  // Listens for the Google OAuth popup's postMessage (see backend
  // googleController/callback.js) — mirrors the Facebook listener above.
  useEffect(() => {
    const handler = (event) => {
      if (!event.data || !String(event.data.type || "").startsWith("google-oauth-")) return;
      if (event.data.type === "google-oauth-success") {
        loadGoogleConnection();
      } else {
        setGoogleConnectionMessage(event.data.message || "Google Ads connection failed.");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Listens for the LinkedIn OAuth popup's postMessage (see backend
  // linkedinController/callback.js) — mirrors the Facebook listener above.
  useEffect(() => {
    const handler = (event) => {
      if (!event.data || !String(event.data.type || "").startsWith("li-oauth-")) return;
      if (event.data.type === "li-oauth-success") {
        loadLinkedinConnection();
      } else {
        setLinkedinConnectionMessage(event.data.message || "LinkedIn connection failed.");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const connectFacebook = async () => {
    setConnecting(true);
    setConnectionMessage("");
    // Opened synchronously, before the await below, so browsers still treat
    // it as a direct result of the click — window.open() called after an
    // await falls outside the click's "user activation" window and gets
    // silently popup-blocked (looked like "nothing happens on connect").
    const popup = window.open("", "fb-oauth", "width=620,height=720");
    const res = await request.get({ entity: "facebook/connect" });
    setConnecting(false);
    if (!res?.success) {
      setConnectionMessage(res?.message || "Could not start the Facebook connection.");
      popup?.close();
      return;
    }
    if (popup) popup.location.href = res.result.url;
    else window.open(res.result.url, "fb-oauth", "width=620,height=720");
  };

  const disconnectFacebook = async () => {
    const res = await disconnectFacebookConnection();
    if (res?.success) {
      setConnection(res.result);
      setPages([]);
      setAdAccounts([]);
    }
  };

  const selectPage = async (pageId) => {
    const res = await request.patch({ entity: "facebook/connection", jsonData: { pageId } });
    if (res?.success) setConnection(res.result);
  };

  const selectAdAccount = async (adAccountId) => {
    const acc = adAccounts.find((a) => a.id === adAccountId);
    const res = await request.patch({
      entity: "facebook/connection",
      jsonData: { adAccountId, adAccountName: acc?.name },
    });
    if (res?.success) setConnection(res.result);
  };

  const connectGoogle = async () => {
    setGoogleConnecting(true);
    setGoogleConnectionMessage("");
    // See the comment in connectFacebook — same popup-blocked-by-await fix.
    const popup = window.open("", "google-oauth", "width=620,height=720");
    const res = await request.get({ entity: "google/connect" });
    setGoogleConnecting(false);
    if (!res?.success) {
      setGoogleConnectionMessage(res?.message || "Could not start the Google Ads connection.");
      popup?.close();
      return;
    }
    if (popup) popup.location.href = res.result.url;
    else window.open(res.result.url, "google-oauth", "width=620,height=720");
  };

  const disconnectGoogle = async () => {
    const res = await disconnectGoogleConnection();
    if (res?.success) {
      setGoogleConnection(res.result);
      setGoogleAccounts([]);
    }
  };

  const selectGoogleCustomer = async (customerId) => {
    const acc = googleAccounts.find((a) => a.id === customerId);
    const res = await request.patch({
      entity: "google/connection",
      jsonData: { customerId, customerName: acc?.name },
    });
    if (res?.success) setGoogleConnection(res.result);
  };

  const copyGoogleValue = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setGoogleCopyMessage("Copied to clipboard.");
    } catch (e) {
      setGoogleCopyMessage("Could not copy automatically — select and copy manually.");
    }
  };

  const connectLinkedin = async () => {
    setLinkedinConnecting(true);
    setLinkedinConnectionMessage("");
    // See the comment in connectFacebook — same popup-blocked-by-await fix.
    const popup = window.open("", "linkedin-oauth", "width=620,height=720");
    const res = await request.get({ entity: "linkedin/connect" });
    setLinkedinConnecting(false);
    if (!res?.success) {
      setLinkedinConnectionMessage(res?.message || "Could not start the LinkedIn connection.");
      popup?.close();
      return;
    }
    if (popup) popup.location.href = res.result.url;
    else window.open(res.result.url, "linkedin-oauth", "width=620,height=720");
  };

  const disconnectLinkedin = async () => {
    const res = await disconnectLinkedinConnection();
    if (res?.success) {
      setLinkedinConnection(res.result);
      setLinkedinAdAccounts([]);
    }
  };

  const saveOrganization = async () => {
    if (!orgIdInput.trim()) return;
    setSavingOrg(true);
    const res = await request.patch({
      entity: "linkedin/connection",
      jsonData: { organizationId: orgIdInput.trim(), organizationName: orgNameInput.trim() },
    });
    setSavingOrg(false);
    if (res?.success) {
      setLinkedinConnection(res.result);
      setOrgIdInput("");
      setOrgNameInput("");
    }
  };

  const selectLinkedinAdAccount = async (adAccountId) => {
    const acc = linkedinAdAccounts.find((a) => a.id === adAccountId);
    const res = await request.patch({
      entity: "linkedin/connection",
      jsonData: { adAccountId, adAccountName: acc?.name },
    });
    if (res?.success) setLinkedinConnection(res.result);
  };

  const saveForm = async () => {
    setSaving(true);
    setSaveMessage("");
    const fields = FIELD_LIBRARY.map((f, i) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      enabled: !!enabled[f.key],
      required: false,
      sortOrder: i,
    }));

    const res = configId
      ? await request.update({ entity: "captureformconfig", id: configId, jsonData: { fields } })
      : await request.create({ entity: "captureformconfig", jsonData: { platform, fields } });

    setSaving(false);
    if (res?.success) {
      if (!configId) setConfigId(res.result._id);
      setSaveMessage("Form saved.");
    } else {
      setSaveMessage(res?.message || "Could not save the form.");
    }
  };

  const copyEmbedCode = async () => {
    const fieldHtml = activeFields
      .map((f) => {
        if (f.type === "Textarea") {
          return `<textarea name="${f.key}" placeholder="${f.label}"></textarea>`;
        }
        if (f.type === "Dropdown") {
          const opts = f.options.map((o) => `<option value="${o}">${o}</option>`).join("");
          return `<select name="${f.key}"><option value="">${f.label}</option>${opts}</select>`;
        }
        const type = f.type === "Email" ? "email" : "text";
        return `<input type="${type}" name="${f.key}" placeholder="${f.label}"${f.key === "name" ? " required" : ""} />`;
      })
      .join("\n    ");

    const endpoint = `${BASE_URL}public/leads/website`;

    const snippet = `<form id="clc-lead-form">
    ${fieldHtml}
    <input type="text" name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true" />
    <button type="submit">Submit</button>
  </form>
  <script>
    document.getElementById('clc-lead-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(e.target).forEach(function (v, k) { data[k] = v; });
      // Forward campaign attribution from the page URL so every ad's leads are tagged.
      var qp = new URLSearchParams(location.search);
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','campaign','source'].forEach(function (k) {
        if (qp.get(k)) data[k] = qp.get(k);
      });
      data.landing_page = location.href;
      fetch('${endpoint}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          alert(res.message || 'Thanks!');
          e.target.reset();
        })
        .catch(function () { alert('Something went wrong — please try again.'); });
    });
  </script>`;

    try {
      await navigator.clipboard.writeText(snippet);
      setCopyMessage("Embed code copied to clipboard.");
    } catch (e) {
      setCopyMessage("Could not copy automatically — select and copy the code manually.");
    }
  };

  const createMetaForm = async () => {
    if (!privacyPolicyUrl.trim()) return;
    setCreatingForm(true);
    const res = await request.post({
      entity: "facebook/forms",
      jsonData: { name: "Website Lead Form", privacyPolicyUrl: privacyPolicyUrl.trim() },
    });
    setCreatingForm(false);
    if (res?.success) {
      setMetaFormId(res.result.metaFormId);
      setFormStatus(res.result.status);
      setSaveMessage("Meta Lead Form created.");
    } else {
      setSaveMessage(res?.message || "Could not create the Meta Lead Form.");
    }
  };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header" style={{ marginBottom: 12 }}>
          <h3>Where does this form run?</h3>
        </div>
        <div className="hub-btn-group">
          {["Website", "Facebook Ads", "Google Ads", "LinkedIn Ads"].map((p) => {
            const meta = PLATFORM_ICON_META[p];
            return (
              <button
                key={p}
                type="button"
                className="hub-btn"
                style={
                  platform === p
                    ? { background: "var(--hub-blue)", color: "#fff", borderColor: "var(--hub-blue)" }
                    : {}
                }
                onClick={() => setPlatform(p)}
              >
                <span
                  className="platform-icon-badge"
                  style={{ background: meta.color, color: meta.iconColor || "#fff" }}
                >
                  {meta.icon}
                </span>
                {p}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "var(--hub-muted)", marginTop: 10 }}>
          <strong>Facebook / Google / LinkedIn Ads connections niche optional hain</strong> — sirf leads ke
          auto-sync ke liye. Bina kisi account connect kiye, <strong>Website</strong> ka
          <em> Hosted Landing Page</em> link ya <em>Embed Code</em> use karke abhi se ads chala ke leads le sakte ho.
        </div>
      </div>

      {platform === "Website" && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><LinkOutlined /> Hosted Landing Page — point your ads here</h3>
            <span className="hub-badge hub-badge-green">No connection needed</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 12 }}>
            Ye ek ready lead-capture page hai jo aapke saved form fields se banta hai. Iska link
            Facebook / Instagram / Google / YouTube ad ke <strong>destination URL</strong> me daalo —
            leads seedhe CRM me aayenge, campaign ke naam se tag hoke (Marketing → Analytics Hub me dikhega).
          </div>
          <div className="hub-form-row" style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
            <div>
              <label>Campaign name (optional)</label>
              <input className="hub-input" placeholder="e.g. diwali-sale-2026" value={lpCampaign}
                onChange={(e) => setLpCampaign(e.target.value)} />
            </div>
            <div>
              <label>Source</label>
              <select className="hub-select" value={lpSource} onChange={(e) => setLpSource(e.target.value)}>
                {["Facebook", "Instagram", "Google Ads", "YouTube", "LinkedIn", "Referral", "Other"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          {(() => {
            const base = `${BASE_URL}public/lead-form/website`;
            const qs = new URLSearchParams();
            if (lpSource) qs.set("utm_source", lpSource);
            if (lpCampaign.trim()) qs.set("utm_campaign", lpCampaign.trim().replace(/\s+/g, "-").toLowerCase());
            const url = qs.toString() ? `${base}?${qs.toString()}` : base;
            return (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  fontFamily: "monospace", fontSize: 12, background: "var(--hub-bg-soft)", border: "1px solid var(--hub-border)",
                  borderRadius: 8, padding: "10px 12px", wordBreak: "break-all", color: "var(--hub-text)",
                }}>{url}</div>
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" className="hub-btn hub-btn-primary" onClick={async () => {
                    try { await navigator.clipboard.writeText(url); setLpCopyMessage("Link copied!"); }
                    catch { setLpCopyMessage("Copy failed — select the text manually."); }
                    setTimeout(() => setLpCopyMessage(""), 2500);
                  }}><CopyOutlined /> Copy Link</button>
                  <a className="hub-btn" href={url} target="_blank" rel="noreferrer"><LinkOutlined /> Open / Preview</a>
                  {lpCopyMessage && <span className="hub-badge hub-badge-blue">{lpCopyMessage}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 8 }}>
                  Tip: har alag ad ke liye alag <strong>Campaign name</strong> rakho — Analytics Hub me har campaign
                  ki leads / cost / ROI alag dikhegi. Form fields niche "Form Fields" me on/off karke <strong>Save Form</strong> dabao.
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {platform === "Facebook Ads" && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><FacebookOutlined /> Facebook Lead Ads Connection</h3>
            <span className={`hub-badge ${connection?.connected ? "hub-badge-green" : "hub-badge-gray"}`}>
              {connectionLoading ? "Checking…" : connection?.connected ? <><CheckCircleOutlined /> Connected</> : "Not Connected"}
            </span>
          </div>

          <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 16 }}>
            Connect a real Facebook account, then pick the Page and Ad Account leads from
            your Facebook ads should flow into — no manual entry, no hard-coded IDs.
          </div>

          {!connection?.connected ? (
            <>
              <button type="button" className="hub-btn hub-btn-primary" disabled={connecting} onClick={connectFacebook}>
                <LinkOutlined /> {connecting ? "Opening Facebook…" : "Connect Facebook"}
              </button>
              {connectionMessage && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{connectionMessage}</div>
              )}
            </>
          ) : (
            <>
              <div className="hub-grid-2" style={{ marginBottom: 16 }}>
                <div className="hub-form-row">
                  <label>Facebook Page</label>
                  <select
                    className="hub-select"
                    value={connection.page?.id || ""}
                    onChange={(e) => selectPage(e.target.value)}
                  >
                    <option value="" disabled>{pages.length ? "Select a Page…" : "Loading Pages…"}</option>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Account</label>
                  <select
                    className="hub-select"
                    value={connection.adAccount?.id || ""}
                    onChange={(e) => selectAdAccount(e.target.value)}
                  >
                    <option value="" disabled>{adAccounts.length ? "Select an Ad Account…" : "Loading Ad Accounts…"}</option>
                    {adAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} · {a.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginBottom: 14 }}>
                {connection.webhookSubscribed ? (
                  <span className="hub-badge hub-badge-green">Webhook subscribed — new leads arrive automatically</span>
                ) : connection.page ? (
                  <span className="hub-badge hub-badge-yellow">Webhook not subscribed yet</span>
                ) : (
                  "Select a Page to subscribe its lead webhook."
                )}
                {connection.lastError && (
                  <div style={{ marginTop: 6, color: "#dc2626" }}>{connection.lastError}</div>
                )}
              </div>

              <button type="button" className="hub-btn" onClick={disconnectFacebook}>
                <DisconnectOutlined /> Disconnect Facebook
              </button>
            </>
          )}
        </div>
      )}

      {platform === "Google Ads" && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><GoogleOutlined /> Google Ads Connection</h3>
            <span className={`hub-badge ${googleConnection?.connected ? "hub-badge-green" : "hub-badge-gray"}`}>
              {googleConnectionLoading ? "Checking…" : googleConnection?.connected ? <><CheckCircleOutlined /> Connected</> : "Not Connected"}
            </span>
          </div>

          <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 16 }}>
            Connect a real Google Ads account, then pick the account leads from your
            Google Ads Lead Form campaigns should flow into.
          </div>

          {!googleConnection?.connected ? (
            <>
              <button type="button" className="hub-btn hub-btn-primary" disabled={googleConnecting} onClick={connectGoogle}>
                <LinkOutlined /> {googleConnecting ? "Opening Google…" : "Connect Google Ads"}
              </button>
              {googleConnectionMessage && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{googleConnectionMessage}</div>
              )}
            </>
          ) : (
            <>
              <div className="hub-grid-2" style={{ marginBottom: 16 }}>
                <div className="hub-form-row">
                  <label>Google Ads Account</label>
                  <select
                    className="hub-select"
                    value={googleConnection.customer?.id || ""}
                    onChange={(e) => selectGoogleCustomer(e.target.value)}
                  >
                    <option value="" disabled>{googleAccounts.length ? "Select an account…" : "Loading accounts…"}</option>
                    {googleAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} · {a.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              {googleConnection.customer ? (
                <div style={{ paddingTop: 14, borderTop: "1px solid var(--hub-border)", marginBottom: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Connect leads from Google Ads</div>
                  <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginBottom: 10 }}>
                    In Google Ads, open your Lead Form asset → Connect to a CRM using webhook integration →
                    paste the URL and key below.
                  </div>
                  <div className="hub-form-row" style={{ marginBottom: 10 }}>
                    <label>Webhook URL</label>
                    <div className="hub-row" style={{ gap: 8 }}>
                      <input className="hub-input" readOnly style={{ flex: 1 }} value={googleConnection.webhookUrl || ""} />
                      <button type="button" className="hub-btn" onClick={() => copyGoogleValue(googleConnection.webhookUrl)}>
                        <CopyOutlined /> Copy
                      </button>
                    </div>
                  </div>
                  <div className="hub-form-row">
                    <label>Webhook Key</label>
                    <div className="hub-row" style={{ gap: 8 }}>
                      <input className="hub-input" readOnly style={{ flex: 1 }} value={googleConnection.webhookKey || ""} />
                      <button type="button" className="hub-btn" onClick={() => copyGoogleValue(googleConnection.webhookKey)}>
                        <CopyOutlined /> Copy
                      </button>
                    </div>
                  </div>
                  {googleCopyMessage && (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--hub-blue)" }}>{googleCopyMessage}</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginBottom: 14 }}>
                  Select a Google Ads account to see the webhook URL and key to paste into Google Ads.
                </div>
              )}

              {googleConnection.lastError && (
                <div style={{ marginBottom: 14, fontSize: 11.5, color: "#dc2626" }}>{googleConnection.lastError}</div>
              )}

              <button type="button" className="hub-btn" onClick={disconnectGoogle}>
                <DisconnectOutlined /> Disconnect Google Ads
              </button>
            </>
          )}
        </div>
      )}

      {platform === "LinkedIn Ads" && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3><LinkedinOutlined /> LinkedIn Ads Connection</h3>
            <span
              className={`hub-badge ${
                linkedinConnection?.connected
                  ? "hub-badge-green"
                  : linkedinConnection?.status === "expired"
                  ? "hub-badge-yellow"
                  : "hub-badge-gray"
              }`}
            >
              {linkedinConnectionLoading ? (
                "Checking…"
              ) : linkedinConnection?.connected ? (
                <><CheckCircleOutlined /> Connected</>
              ) : linkedinConnection?.status === "expired" ? (
                "Expired"
              ) : (
                "Not Connected"
              )}
            </span>
          </div>

          <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 16 }}>
            Connect a real LinkedIn account, then set the Organization and Ad Account leads from
            your LinkedIn ads should flow into.
          </div>

          {linkedinConnection?.status === "expired" && (
            <div className="hub-badge hub-badge-yellow" style={{ marginBottom: 12 }}>
              Your LinkedIn connection expired — LinkedIn issues no refresh token, so reconnect below.
            </div>
          )}

          {!linkedinConnection?.connected ? (
            <>
              <button type="button" className="hub-btn hub-btn-primary" disabled={linkedinConnecting} onClick={connectLinkedin}>
                <LinkOutlined /> {linkedinConnecting ? "Opening LinkedIn…" : "Connect LinkedIn"}
              </button>
              {linkedinConnectionMessage && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{linkedinConnectionMessage}</div>
              )}
            </>
          ) : (
            <>
              <div className="hub-grid-2" style={{ marginBottom: 16 }}>
                <div className="hub-form-row">
                  <label>Organization (no listing API — type the ID)</label>
                  <div className="hub-row" style={{ gap: 8 }}>
                    <input
                      className="hub-input"
                      style={{ flex: 1 }}
                      placeholder="Organization ID"
                      value={orgIdInput}
                      onChange={(e) => setOrgIdInput(e.target.value)}
                    />
                    <input
                      className="hub-input"
                      style={{ flex: 1 }}
                      placeholder="Organization Name"
                      value={orgNameInput}
                      onChange={(e) => setOrgNameInput(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="hub-btn"
                    style={{ marginTop: 8 }}
                    disabled={!orgIdInput.trim() || savingOrg}
                    onClick={saveOrganization}
                  >
                    {savingOrg ? "Saving…" : "Save Organization"}
                  </button>
                  {linkedinConnection.organization && (
                    <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 6 }}>
                      Current: {linkedinConnection.organization.name} · {linkedinConnection.organization.id}
                    </div>
                  )}
                </div>
                <div className="hub-form-row">
                  <label>Ad Account</label>
                  <select
                    className="hub-select"
                    value={linkedinConnection.adAccount?.id || ""}
                    onChange={(e) => selectLinkedinAdAccount(e.target.value)}
                  >
                    <option value="" disabled>{linkedinAdAccounts.length ? "Select an Ad Account…" : "Loading Ad Accounts…"}</option>
                    {linkedinAdAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} · {a.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginBottom: 14 }}>
                <span className="hub-badge hub-badge-blue">
                  LinkedIn has no live webhook — new leads are pulled by a background sync every few minutes
                </span>
                <div style={{ marginTop: 6 }}>
                  Last synced: {linkedinConnection.lastPolledAt ? new Date(linkedinConnection.lastPolledAt).toLocaleString() : "never yet"}
                </div>
                {linkedinConnection.lastError && (
                  <div style={{ marginTop: 6, color: "#dc2626" }}>{linkedinConnection.lastError}</div>
                )}
              </div>

              <button type="button" className="hub-btn" onClick={disconnectLinkedin}>
                <DisconnectOutlined /> Disconnect LinkedIn
              </button>
            </>
          )}
        </div>
      )}

      <div className="hub-grid-2">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Form Fields</h3>
          </div>

          <div className="hub-stack" style={{ gap: 10 }}>
            {FIELD_LIBRARY.map((f) => (
              <div
                key={f.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  border: "1px solid var(--hub-border)",
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{f.type} field</div>
                </div>

                <button
                  type="button"
                  className={`hub-switch ${enabled[f.key] ? "on" : ""}`}
                  onClick={() =>
                    setEnabled((prev) => ({ ...prev, [f.key]: !prev[f.key] }))
                  }
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="hub-btn hub-btn-primary" type="button" disabled={saving} onClick={saveForm}>
              {saving ? "Saving…" : "Save Form"}
            </button>
            <button className="hub-btn" type="button" onClick={copyEmbedCode}>
              <CopyOutlined /> Copy Embed Code
            </button>
            {(saveMessage || copyMessage) && (
              <span className="hub-badge hub-badge-blue">{saveMessage || copyMessage}</span>
            )}
          </div>

          {platform === "Facebook Ads" && (
            <div className="hub-form-row" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <label>Meta Lead Form</label>
              {metaFormId ? (
                <span className="hub-badge hub-badge-green">
                  <CheckCircleOutlined /> Created — Meta form ID {metaFormId}
                </span>
              ) : (
                <>
                  <input
                    className="hub-input"
                    style={{ marginBottom: 8 }}
                    placeholder="Privacy policy URL (required by Meta)"
                    value={privacyPolicyUrl}
                    onChange={(e) => setPrivacyPolicyUrl(e.target.value)}
                  />
                  <button
                    type="button"
                    className="hub-btn"
                    disabled={!connection?.connected || !connection?.page || !privacyPolicyUrl.trim() || creatingForm}
                    onClick={createMetaForm}
                  >
                    {creatingForm ? "Creating…" : "Create Meta Lead Form"}
                  </button>
                  {!connection?.connected && (
                    <span style={{ fontSize: 11.5, color: "var(--hub-muted)" }}>Connect Facebook and select a Page first.</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Live Preview</h3>
            <span className="hub-badge hub-badge-blue">
              {platform === "Facebook Ads"
                ? "Facebook Lead Ad"
                : platform === "Google Ads"
                ? "Google Lead Form"
                : platform === "LinkedIn Ads"
                ? "LinkedIn Lead Gen Form"
                : "Website Form"}
            </span>
          </div>

          <div
            style={{
              border: "1px solid var(--hub-border)",
              borderRadius: 10,
              padding: 20,
              background: "var(--hub-bg-soft)",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              Get in touch with us
            </div>
            <div style={{ fontSize: 12, color: "var(--hub-muted)", marginBottom: 16 }}>
              Fill this form and our team will reach out within 24 hours.
            </div>

            <div className="hub-stack" style={{ gap: 12 }}>
              {activeFields.length === 0 && (
                <div className="hub-empty">Turn on a field to preview it here.</div>
              )}

              {activeFields.map((f) => (
                <div key={f.key}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>
                    {f.label}
                  </div>
                  {f.type === "Textarea" ? (
                    <div
                      style={{
                        height: 60,
                        border: "1px solid #e3e9f5",
                        borderRadius: 6,
                        background: "var(--hub-surface)",
                      }}
                    />
                  ) : f.type === "Dropdown" ? (
                    <select className="hub-select" style={{ width: "100%" }} defaultValue="">
                      <option value="" disabled>Select…</option>
                      {f.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <div
                      style={{
                        height: 32,
                        border: "1px solid #e3e9f5",
                        borderRadius: 6,
                        background: "var(--hub-surface)",
                      }}
                    />
                  )}
                </div>
              ))}

              {activeFields.length > 0 && (
                <button
                  className="hub-btn hub-btn-primary"
                  type="button"
                  style={{ marginTop: 4, alignSelf: "flex-start" }}
                >
                  Submit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Captured Leads from {platform}</h3>
          <span className="hub-badge hub-badge-blue">{capturedCount} lead{capturedCount === 1 ? "" : "s"}</span>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Captured</th>
              </tr>
            </thead>
            <tbody>
              {capturedLoading && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">Loading captured leads…</div>
                  </td>
                </tr>
              )}
              {!capturedLoading && capturedLeads.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">No leads captured from {platform} yet.</div>
                  </td>
                </tr>
              )}
              {!capturedLoading &&
                capturedLeads.map((l) => (
                  <tr key={l._id} style={{ cursor: "pointer" }} onClick={() => setViewLead(l)}>
                    <td>{l.name}</td>
                    <td>{l.email || "—"}</td>
                    <td>{l.phone || "—"}</td>
                    <td>
                      <span className={`hub-badge ${STATUS_META[l.status]}`}>{l.status}</span>
                    </td>
                    <td>{new Date(l.created).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {capturedPages > 1 && (
          <div className="hub-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>
              Page {capturedPage} of {capturedPages} · {capturedCount} leads total
            </span>
            <div className="hub-row" style={{ gap: 8 }}>
              <button type="button" className="hub-btn" disabled={capturedPage <= 1} onClick={() => loadCapturedLeads(capturedPage - 1)}>
                <LeftOutlined /> Prev
              </button>
              <button type="button" className="hub-btn" disabled={capturedPage >= capturedPages} onClick={() => loadCapturedLeads(capturedPage + 1)}>
                Next <RightOutlined />
              </button>
            </div>
          </div>
        )}
      </div>

      {platform === "Facebook Ads" && <CampaignSetup connection={connection} metaFormId={metaFormId} />}
      {platform === "Google Ads" && <GoogleCampaignSetup connection={googleConnection} />}
      {platform === "LinkedIn Ads" && <LinkedInCampaignSetup connection={linkedinConnection} />}

      <LeadDetailModal lead={viewLead} onClose={() => setViewLead(null)} />
    </div>
  );
}

// Raw axios call for creative media upload — multipart, doesn't fit any
// request.js helper's fixed URL suffix convention (see disconnectFacebookConnection above).
async function createFacebookCreative(formData) {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.post(`${API_BASE_URL}facebook/creatives`, formData, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// Same shape as createFacebookCreative above, for LinkedIn Creatives (a
// LinkedIn Creative absorbs both FacebookAdCreative's and FacebookAd's roles
// — see linkedinController/creatives.js).
async function createLinkedinCreative(formData) {
  const auth = storePersist.get("auth");
  const token = auth?.current?.token;
  const res = await axios.post(`${API_BASE_URL}linkedin/creatives`, formData, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.data;
}

// New, additive UI — Campaign -> Ad Set -> Ad Creative -> Ad, each created
// PAUSED on Meta and only flipped ACTIVE by an explicit Publish click.
function CampaignSetup({ connection, metaFormId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [adSets, setAdSets] = useState([]);
  const [creatives, setCreatives] = useState([]);
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [newCampaignName, setNewCampaignName] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const [adSetCampaignId, setAdSetCampaignId] = useState("");
  const [newAdSetName, setNewAdSetName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [countries, setCountries] = useState("IN");
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [creatingAdSet, setCreatingAdSet] = useState(false);

  const [creativeCampaignId, setCreativeCampaignId] = useState("");
  const [newCreativeName, setNewCreativeName] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [cta, setCta] = useState(CTA_OPTIONS[0]);
  const [mediaFile, setMediaFile] = useState(null);
  const [creatingCreative, setCreatingCreative] = useState(false);

  const [adCampaignId, setAdCampaignId] = useState("");
  const [adSetIdForAd, setAdSetIdForAd] = useState("");
  const [creativeIdForAd, setCreativeIdForAd] = useState("");
  const [newAdName, setNewAdName] = useState("");
  const [creatingAd, setCreatingAd] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [c, a, cr, ad] = await Promise.all([
      request.get({ entity: "facebook/campaigns" }),
      request.get({ entity: "facebook/adsets" }),
      request.get({ entity: "facebook/creatives" }),
      request.get({ entity: "facebook/ads" }),
    ]);
    setCampaigns(c?.success ? c.result : []);
    setAdSets(a?.success ? a.result : []);
    setCreatives(cr?.success ? cr.result : []);
    setAds(ad?.success ? ad.result : []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const ready = connection?.connected && connection?.page && connection?.adAccount;

  const createCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setCreatingCampaign(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "facebook/campaigns",
      jsonData: { name: newCampaignName.trim(), objective: "OUTCOME_LEADS" },
    });
    setCreatingCampaign(false);
    if (res?.success) {
      setNewCampaignName("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the campaign.");
    }
  };

  const createAdSet = async () => {
    if (!newAdSetName.trim() || !adSetCampaignId || !dailyBudget) return;
    setCreatingAdSet(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "facebook/adsets",
      jsonData: {
        name: newAdSetName.trim(),
        campaignId: adSetCampaignId,
        dailyBudget: Number(dailyBudget),
        countries: countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
        ageMin: Number(ageMin),
        ageMax: Number(ageMax),
      },
    });
    setCreatingAdSet(false);
    if (res?.success) {
      setNewAdSetName("");
      setDailyBudget("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad set.");
    }
  };

  const createCreative = async () => {
    if (!newCreativeName.trim() || !mediaFile || !metaFormId) return;
    setCreatingCreative(true);
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", mediaFile);
    formData.append("name", newCreativeName.trim());
    formData.append("campaignId", creativeCampaignId);
    formData.append("primaryText", primaryText);
    formData.append("headline", headline);
    formData.append("callToAction", cta);
    formData.append("metaFormId", metaFormId);
    formData.append("mediaType", mediaFile.type.startsWith("video/") ? "video" : "image");

    const res = await createFacebookCreative(formData);
    setCreatingCreative(false);
    if (res?.success) {
      setNewCreativeName("");
      setPrimaryText("");
      setHeadline("");
      setMediaFile(null);
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad creative.");
    }
  };

  const createAd = async () => {
    if (!newAdName.trim() || !adCampaignId || !adSetIdForAd || !creativeIdForAd) return;
    setCreatingAd(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "facebook/ads",
      jsonData: { name: newAdName.trim(), campaignId: adCampaignId, adSetId: adSetIdForAd, creativeId: creativeIdForAd },
    });
    setCreatingAd(false);
    if (res?.success) {
      setNewAdName("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad.");
    }
  };

  const publish = async (kind, id) => {
    setBusyId(id);
    setErrorMsg("");
    const res = await request.post({ entity: `facebook/${kind}/${id}/publish`, jsonData: {} });
    setBusyId(null);
    if (res?.success) {
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not publish.");
    }
  };

  const STATUS_BADGE = { PAUSED: "hub-badge-gray", ACTIVE: "hub-badge-green", ARCHIVED: "hub-badge-red" };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><RocketOutlined /> Campaign Setup</h3>
          {errorMsg && <span className="hub-badge hub-badge-red">{errorMsg}</span>}
        </div>

        {!ready && (
          <div className="hub-empty">
            Connect Facebook, select a Page and an Ad Account above before creating campaigns.
          </div>
        )}

        {ready && (
          <div className="hub-stack" style={{ gap: 20 }}>
            {/* CAMPAIGN */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>1. Campaign</div>
              <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className="hub-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder="Campaign name"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                />
                <button type="button" className="hub-btn hub-btn-primary" disabled={!newCampaignName.trim() || creatingCampaign} onClick={createCampaign}>
                  <PlusOutlined /> {creatingCampaign ? "Creating…" : "Create Campaign (PAUSED)"}
                </button>
              </div>
              {campaigns.length > 0 && (
                <div className="hub-table-wrapper">
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Objective</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={c._id}>
                          <td>{c.name}</td>
                          <td>{c.objective}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                          <td>
                            {c.status === "PAUSED" && c.metaCampaignId && (
                              <button type="button" className="hub-btn" disabled={busyId === c._id} onClick={() => publish("campaigns", c._id)}>
                                <RocketOutlined /> {busyId === c._id ? "Publishing…" : "Publish"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* AD SET */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>2. Ad Set</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={adSetCampaignId} onChange={(e) => setAdSetCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.metaCampaignId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Set Name</label>
                  <input className="hub-input" value={newAdSetName} onChange={(e) => setNewAdSetName(e.target.value)} placeholder="e.g. Delhi NCR — 25-45" />
                </div>
                <div className="hub-form-row">
                  <label>Daily Budget (smallest currency unit, e.g. paise)</label>
                  <input className="hub-input" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 50000" />
                </div>
                <div className="hub-form-row">
                  <label>Countries (comma-separated)</label>
                  <input className="hub-input" value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="IN" />
                </div>
                <div className="hub-form-row">
                  <label>Age Min</label>
                  <input className="hub-input" value={ageMin} onChange={(e) => setAgeMin(e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="hub-form-row">
                  <label>Age Max</label>
                  <input className="hub-input" value={ageMax} onChange={(e) => setAgeMax(e.target.value.replace(/\D/g, ""))} />
                </div>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newAdSetName.trim() || !adSetCampaignId || !dailyBudget || creatingAdSet}
                onClick={createAdSet}
              >
                <PlusOutlined /> {creatingAdSet ? "Creating…" : "Create Ad Set (PAUSED)"}
              </button>
              {adSets.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Daily Budget</th><th>Status</th></tr></thead>
                    <tbody>
                      {adSets.map((a) => (
                        <tr key={a._id}>
                          <td>{a.name}</td>
                          <td>{a.dailyBudget}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* AD CREATIVE */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>3. Ad Creative</div>
              {!metaFormId ? (
                <div className="hub-empty">Create the Meta Lead Form above first — creatives need it to attach the lead form.</div>
              ) : (
                <>
                  <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                    <div className="hub-form-row">
                      <label>Campaign</label>
                      <select className="hub-select" value={creativeCampaignId} onChange={(e) => setCreativeCampaignId(e.target.value)}>
                        <option value="">Select a campaign…</option>
                        {campaigns.filter((c) => c.metaCampaignId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="hub-form-row">
                      <label>Creative Name</label>
                      <input className="hub-input" value={newCreativeName} onChange={(e) => setNewCreativeName(e.target.value)} />
                    </div>
                    <div className="hub-form-row">
                      <label>Headline</label>
                      <input className="hub-input" value={headline} onChange={(e) => setHeadline(e.target.value)} />
                    </div>
                    <div className="hub-form-row">
                      <label>Call To Action</label>
                      <select className="hub-select" value={cta} onChange={(e) => setCta(e.target.value)}>
                        {CTA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="hub-form-row">
                    <label>Primary Text</label>
                    <textarea className="hub-input" rows={2} value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} />
                  </div>
                  <div className="hub-form-row">
                    <label>Image or Video</label>
                    <input type="file" accept="image/*,video/*" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} />
                  </div>
                  <button
                    type="button"
                    className="hub-btn hub-btn-primary"
                    disabled={!newCreativeName.trim() || !mediaFile || creatingCreative}
                    onClick={createCreative}
                  >
                    <PlusOutlined /> {creatingCreative ? "Uploading…" : "Create Ad Creative"}
                  </button>
                  {creatives.length > 0 && (
                    <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                      <table className="hub-table">
                        <thead><tr><th>Name</th><th>Media</th><th>Status</th></tr></thead>
                        <tbody>
                          {creatives.map((c) => (
                            <tr key={c._id}>
                              <td>{c.name}</td>
                              <td>{c.mediaType}</td>
                              <td><span className={`hub-badge ${c.status === "created" ? "hub-badge-green" : c.status === "error" ? "hub-badge-red" : "hub-badge-gray"}`}>{c.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* AD */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>4. Ad — Review &amp; Publish</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={adCampaignId} onChange={(e) => setAdCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.metaCampaignId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Name</label>
                  <input className="hub-input" value={newAdName} onChange={(e) => setNewAdName(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Ad Set</label>
                  <select className="hub-select" value={adSetIdForAd} onChange={(e) => setAdSetIdForAd(e.target.value)}>
                    <option value="">Select an ad set…</option>
                    {adSets.filter((a) => a.metaAdSetId).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Creative</label>
                  <select className="hub-select" value={creativeIdForAd} onChange={(e) => setCreativeIdForAd(e.target.value)}>
                    <option value="">Select a creative…</option>
                    {creatives.filter((c) => c.metaCreativeId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newAdName.trim() || !adCampaignId || !adSetIdForAd || !creativeIdForAd || creatingAd}
                onClick={createAd}
              >
                <PlusOutlined /> {creatingAd ? "Creating…" : "Create Ad (PAUSED)"}
              </button>
              {ads.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {ads.map((a) => (
                        <tr key={a._id}>
                          <td>{a.name}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                          <td>
                            {a.status === "PAUSED" && a.metaAdId && (
                              <button type="button" className="hub-btn hub-btn-primary" disabled={busyId === a._id} onClick={() => publish("ads", a._id)}>
                                <RocketOutlined /> {busyId === a._id ? "Publishing…" : "Publish Campaign"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// New, additive UI — Campaign -> Ad Group -> Ad, each created PAUSED on
// Google Ads and only flipped ENABLED by an explicit Publish click. Google
// has no separate "Ad Creative" object the way Meta does — headlines,
// descriptions and final URLs live directly on the Ad (see
// googleController/ads.js) — so this is a 3-step flow, not 4 like
// CampaignSetup above. Mirrors CampaignSetup's structure exactly.
function GoogleCampaignSetup({ connection }) {
  const [campaigns, setCampaigns] = useState([]);
  const [adGroups, setAdGroups] = useState([]);
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [newCampaignName, setNewCampaignName] = useState("");
  const [dailyBudgetMicros, setDailyBudgetMicros] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const [adGroupCampaignId, setAdGroupCampaignId] = useState("");
  const [newAdGroupName, setNewAdGroupName] = useState("");
  const [cpcBidMicros, setCpcBidMicros] = useState("");
  const [creatingAdGroup, setCreatingAdGroup] = useState(false);

  const [adCampaignId, setAdCampaignId] = useState("");
  const [adGroupIdForAd, setAdGroupIdForAd] = useState("");
  const [newAdName, setNewAdName] = useState("");
  const [headline1, setHeadline1] = useState("");
  const [headline2, setHeadline2] = useState("");
  const [headline3, setHeadline3] = useState("");
  const [description1, setDescription1] = useState("");
  const [description2, setDescription2] = useState("");
  const [finalUrl, setFinalUrl] = useState("");
  const [creatingAd, setCreatingAd] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [c, ag, ad] = await Promise.all([
      request.get({ entity: "google/campaigns" }),
      request.get({ entity: "google/adgroups" }),
      request.get({ entity: "google/ads" }),
    ]);
    setCampaigns(c?.success ? c.result : []);
    setAdGroups(ag?.success ? ag.result : []);
    setAds(ad?.success ? ad.result : []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const ready = connection?.connected && connection?.customer;

  const createCampaign = async () => {
    if (!newCampaignName.trim() || !dailyBudgetMicros) return;
    setCreatingCampaign(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "google/campaigns",
      jsonData: { name: newCampaignName.trim(), dailyBudgetMicros: Number(dailyBudgetMicros) },
    });
    setCreatingCampaign(false);
    if (res?.success) {
      setNewCampaignName("");
      setDailyBudgetMicros("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the campaign.");
    }
  };

  const createAdGroup = async () => {
    if (!newAdGroupName.trim() || !adGroupCampaignId) return;
    setCreatingAdGroup(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "google/adgroups",
      jsonData: {
        name: newAdGroupName.trim(),
        campaignId: adGroupCampaignId,
        cpcBidMicros: cpcBidMicros ? Number(cpcBidMicros) : undefined,
      },
    });
    setCreatingAdGroup(false);
    if (res?.success) {
      setNewAdGroupName("");
      setCpcBidMicros("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad group.");
    }
  };

  const createAd = async () => {
    const headlines = [headline1, headline2, headline3].map((h) => h.trim()).filter(Boolean);
    const descriptions = [description1, description2].map((d) => d.trim()).filter(Boolean);
    if (!adCampaignId || !adGroupIdForAd || headlines.length < 3 || descriptions.length < 2 || !finalUrl.trim()) return;
    setCreatingAd(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "google/ads",
      jsonData: {
        name: newAdName.trim() || undefined,
        campaignId: adCampaignId,
        adGroupId: adGroupIdForAd,
        headlines,
        descriptions,
        finalUrls: [finalUrl.trim()],
      },
    });
    setCreatingAd(false);
    if (res?.success) {
      setNewAdName("");
      setHeadline1("");
      setHeadline2("");
      setHeadline3("");
      setDescription1("");
      setDescription2("");
      setFinalUrl("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the ad.");
    }
  };

  const publish = async (kind, id) => {
    setBusyId(id);
    setErrorMsg("");
    const res = await request.post({ entity: `google/${kind}/${id}/publish`, jsonData: {} });
    setBusyId(null);
    if (res?.success) {
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not publish.");
    }
  };

  const STATUS_BADGE = { PAUSED: "hub-badge-gray", ENABLED: "hub-badge-green", REMOVED: "hub-badge-red" };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><RocketOutlined /> Google Ads Campaign Setup</h3>
          {errorMsg && <span className="hub-badge hub-badge-red">{errorMsg}</span>}
        </div>

        {!ready && (
          <div className="hub-empty">
            Connect Google Ads and select an account above before creating campaigns.
          </div>
        )}

        {ready && (
          <div className="hub-stack" style={{ gap: 20 }}>
            {/* CAMPAIGN */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>1. Campaign</div>
              <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className="hub-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder="Campaign name"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                />
                <input
                  className="hub-input"
                  style={{ flex: "1 1 260px" }}
                  placeholder="Daily budget (micros — 1,000,000 = 1 currency unit)"
                  value={dailyBudgetMicros}
                  onChange={(e) => setDailyBudgetMicros(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  type="button"
                  className="hub-btn hub-btn-primary"
                  disabled={!newCampaignName.trim() || !dailyBudgetMicros || creatingCampaign}
                  onClick={createCampaign}
                >
                  <PlusOutlined /> {creatingCampaign ? "Creating…" : "Create Campaign (PAUSED)"}
                </button>
              </div>
              {campaigns.length > 0 && (
                <div className="hub-table-wrapper">
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Channel</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={c._id}>
                          <td>{c.name}</td>
                          <td>{c.advertisingChannelType}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                          <td>
                            {c.status === "PAUSED" && c.googleCampaignResourceName && (
                              <button type="button" className="hub-btn" disabled={busyId === c._id} onClick={() => publish("campaigns", c._id)}>
                                <RocketOutlined /> {busyId === c._id ? "Publishing…" : "Publish"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* AD GROUP */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>2. Ad Group</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={adGroupCampaignId} onChange={(e) => setAdGroupCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.googleCampaignResourceName).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Group Name</label>
                  <input className="hub-input" value={newAdGroupName} onChange={(e) => setNewAdGroupName(e.target.value)} placeholder="e.g. Career Coaching — Broad" />
                </div>
                <div className="hub-form-row">
                  <label>CPC Bid (micros, optional)</label>
                  <input className="hub-input" value={cpcBidMicros} onChange={(e) => setCpcBidMicros(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1000000" />
                </div>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newAdGroupName.trim() || !adGroupCampaignId || creatingAdGroup}
                onClick={createAdGroup}
              >
                <PlusOutlined /> {creatingAdGroup ? "Creating…" : "Create Ad Group (PAUSED)"}
              </button>
              {adGroups.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>CPC Bid</th><th>Status</th></tr></thead>
                    <tbody>
                      {adGroups.map((a) => (
                        <tr key={a._id}>
                          <td>{a.name}</td>
                          <td>{a.cpcBidMicros || "—"}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* AD */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>3. Ad — Responsive Search Ad</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={adCampaignId} onChange={(e) => setAdCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.googleCampaignResourceName).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Group</label>
                  <select className="hub-select" value={adGroupIdForAd} onChange={(e) => setAdGroupIdForAd(e.target.value)}>
                    <option value="">Select an ad group…</option>
                    {adGroups.filter((a) => a.googleAdGroupResourceName).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Ad Name (internal label)</label>
                  <input className="hub-input" value={newAdName} onChange={(e) => setNewAdName(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Final URL</label>
                  <input className="hub-input" value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://example.com/landing" />
                </div>
                <div className="hub-form-row">
                  <label>Headline 1</label>
                  <input className="hub-input" value={headline1} onChange={(e) => setHeadline1(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Headline 2</label>
                  <input className="hub-input" value={headline2} onChange={(e) => setHeadline2(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Headline 3</label>
                  <input className="hub-input" value={headline3} onChange={(e) => setHeadline3(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Description 1</label>
                  <input className="hub-input" value={description1} onChange={(e) => setDescription1(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Description 2</label>
                  <input className="hub-input" value={description2} onChange={(e) => setDescription2(e.target.value)} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--hub-muted)", marginBottom: 10 }}>
                Google requires at least 3 headlines and 2 descriptions for a Responsive Search Ad.
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={
                  !adCampaignId ||
                  !adGroupIdForAd ||
                  !finalUrl.trim() ||
                  [headline1, headline2, headline3].filter((h) => h.trim()).length < 3 ||
                  [description1, description2].filter((d) => d.trim()).length < 2 ||
                  creatingAd
                }
                onClick={createAd}
              >
                <PlusOutlined /> {creatingAd ? "Creating…" : "Create Ad (PAUSED)"}
              </button>
              {ads.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {ads.map((a) => (
                        <tr key={a._id}>
                          <td>{a.name}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                          <td>
                            {a.status === "PAUSED" && a.googleAdResourceName && (
                              <button type="button" className="hub-btn hub-btn-primary" disabled={busyId === a._id} onClick={() => publish("ads", a._id)}>
                                <RocketOutlined /> {busyId === a._id ? "Publishing…" : "Publish Campaign"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// New, additive UI — Campaign Group -> Campaign -> Creative, each created
// PAUSED/DRAFT on LinkedIn and only flipped ACTIVE by an explicit Publish
// click. LinkedIn has no separate "Ad" object — a LinkedInCreative absorbs
// both FacebookAdCreative's and FacebookAd's roles (see
// linkedinController/creatives.js), so this is a 3-step flow, not 4 like
// CampaignSetup above. Mirrors CampaignSetup's structure exactly.
function LinkedInCampaignSetup({ connection }) {
  const [campaignGroups, setCampaignGroups] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [creatives, setCreatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [groupTotalBudget, setGroupTotalBudget] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);

  const [campaignGroupIdSel, setCampaignGroupIdSel] = useState("");
  const [newCampaignName, setNewCampaignName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [locations, setLocations] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const [creativeCampaignId, setCreativeCampaignId] = useState("");
  const [newCreativeName, setNewCreativeName] = useState("");
  const [commentary, setCommentary] = useState("");
  const [headlineC, setHeadlineC] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [cta, setCta] = useState("Submit");
  const [leadGenFormId, setLeadGenFormId] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [creatingCreative, setCreatingCreative] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [g, c, cr] = await Promise.all([
      request.get({ entity: "linkedin/campaign-groups" }),
      request.get({ entity: "linkedin/campaigns" }),
      request.get({ entity: "linkedin/creatives" }),
    ]);
    setCampaignGroups(g?.success ? g.result : []);
    setCampaigns(c?.success ? c.result : []);
    setCreatives(cr?.success ? cr.result : []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const ready = connection?.connected && connection?.organization && connection?.adAccount;

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "linkedin/campaign-groups",
      jsonData: {
        name: newGroupName.trim(),
        totalBudget: groupTotalBudget ? Number(groupTotalBudget) : undefined,
      },
    });
    setCreatingGroup(false);
    if (res?.success) {
      setNewGroupName("");
      setGroupTotalBudget("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the campaign group.");
    }
  };

  const createCampaign = async () => {
    if (!newCampaignName.trim() || !campaignGroupIdSel || !dailyBudget) return;
    setCreatingCampaign(true);
    setErrorMsg("");
    const res = await request.post({
      entity: "linkedin/campaigns",
      jsonData: {
        name: newCampaignName.trim(),
        campaignGroupId: campaignGroupIdSel,
        dailyBudget: Number(dailyBudget),
        locations: locations.split(",").map((l) => l.trim()).filter(Boolean),
      },
    });
    setCreatingCampaign(false);
    if (res?.success) {
      setNewCampaignName("");
      setDailyBudget("");
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the campaign.");
    }
  };

  const createCreative = async () => {
    if (!newCreativeName.trim() || !creativeCampaignId || !leadGenFormId.trim() || !mediaFile) return;
    setCreatingCreative(true);
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", mediaFile);
    formData.append("name", newCreativeName.trim());
    formData.append("campaignId", creativeCampaignId);
    formData.append("commentary", commentary);
    formData.append("headline", headlineC);
    formData.append("landingPageUrl", landingPageUrl);
    formData.append("callToAction", cta || "Submit");
    formData.append("leadGenFormId", leadGenFormId.trim());

    const res = await createLinkedinCreative(formData);
    setCreatingCreative(false);
    if (res?.success) {
      setNewCreativeName("");
      setCommentary("");
      setHeadlineC("");
      setLandingPageUrl("");
      setLeadGenFormId("");
      setMediaFile(null);
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not create the creative.");
    }
  };

  const publish = async (kind, id) => {
    setBusyId(id);
    setErrorMsg("");
    const res = await request.post({ entity: `linkedin/${kind}/${id}/publish`, jsonData: {} });
    setBusyId(null);
    if (res?.success) {
      loadAll();
    } else {
      setErrorMsg(res?.message || "Could not publish.");
    }
  };

  const STATUS_BADGE = {
    DRAFT: "hub-badge-gray",
    PAUSED: "hub-badge-gray",
    ACTIVE: "hub-badge-green",
    ARCHIVED: "hub-badge-red",
    COMPLETED: "hub-badge-blue",
    CANCELED: "hub-badge-red",
  };

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><RocketOutlined /> LinkedIn Ads Campaign Setup</h3>
          {errorMsg && <span className="hub-badge hub-badge-red">{errorMsg}</span>}
        </div>

        {!ready && (
          <div className="hub-empty">
            Connect LinkedIn and select an Organization and Ad Account above before creating campaigns.
          </div>
        )}

        {ready && (
          <div className="hub-stack" style={{ gap: 20 }}>
            {/* CAMPAIGN GROUP */}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>1. Campaign Group</div>
              <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  className="hub-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder="Campaign Group name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
                <input
                  className="hub-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder="Total budget (major currency units, optional)"
                  value={groupTotalBudget}
                  onChange={(e) => setGroupTotalBudget(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  type="button"
                  className="hub-btn hub-btn-primary"
                  disabled={!newGroupName.trim() || creatingGroup}
                  onClick={createGroup}
                >
                  <PlusOutlined /> {creatingGroup ? "Creating…" : "Create Campaign Group (PAUSED)"}
                </button>
              </div>
              {campaignGroups.length > 0 && (
                <div className="hub-table-wrapper">
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Total Budget</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {campaignGroups.map((g) => (
                        <tr key={g._id}>
                          <td>{g.name}</td>
                          <td>{g.totalBudget || "—"}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[g.status]}`}>{g.status}</span></td>
                          <td>
                            {g.status === "PAUSED" && g.linkedinCampaignGroupId && (
                              <button type="button" className="hub-btn" disabled={busyId === g._id} onClick={() => publish("campaign-groups", g._id)}>
                                <RocketOutlined /> {busyId === g._id ? "Publishing…" : "Publish"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* CAMPAIGN */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>2. Campaign</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign Group</label>
                  <select className="hub-select" value={campaignGroupIdSel} onChange={(e) => setCampaignGroupIdSel(e.target.value)}>
                    <option value="">Select a campaign group…</option>
                    {campaignGroups.filter((g) => g.linkedinCampaignGroupId).map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Campaign Name</label>
                  <input className="hub-input" value={newCampaignName} onChange={(e) => setNewCampaignName(e.target.value)} placeholder="e.g. Career Coaching — Decision Makers" />
                </div>
                <div className="hub-form-row">
                  <label>Daily Budget (major currency units)</label>
                  <input className="hub-input" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 500" />
                </div>
                <div className="hub-form-row">
                  <label>Locations (comma-separated LinkedIn geo URNs, optional)</label>
                  <input className="hub-input" value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="urn:li:geo:103644278" />
                </div>
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newCampaignName.trim() || !campaignGroupIdSel || !dailyBudget || creatingCampaign}
                onClick={createCampaign}
              >
                <PlusOutlined /> {creatingCampaign ? "Creating…" : "Create Campaign (PAUSED)"}
              </button>
              {campaigns.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Daily Budget</th><th>Status</th></tr></thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr key={c._id}>
                          <td>{c.name}</td>
                          <td>{c.dailyBudget || "—"}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* CREATIVE */}
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>3. Creative — Review &amp; Publish</div>
              <div className="hub-grid-2" style={{ marginBottom: 10 }}>
                <div className="hub-form-row">
                  <label>Campaign</label>
                  <select className="hub-select" value={creativeCampaignId} onChange={(e) => setCreativeCampaignId(e.target.value)}>
                    <option value="">Select a campaign…</option>
                    {campaigns.filter((c) => c.linkedinCampaignId).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="hub-form-row">
                  <label>Creative Name</label>
                  <input className="hub-input" value={newCreativeName} onChange={(e) => setNewCreativeName(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Headline</label>
                  <input className="hub-input" value={headlineC} onChange={(e) => setHeadlineC(e.target.value)} />
                </div>
                <div className="hub-form-row">
                  <label>Call To Action</label>
                  <input className="hub-input" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Submit" />
                </div>
                <div className="hub-form-row">
                  <label>Landing Page URL</label>
                  <input className="hub-input" value={landingPageUrl} onChange={(e) => setLandingPageUrl(e.target.value)} placeholder="https://example.com/landing" />
                </div>
                <div className="hub-form-row">
                  <label>Lead Gen Form ID</label>
                  <input className="hub-input" value={leadGenFormId} onChange={(e) => setLeadGenFormId(e.target.value)} placeholder="Numeric ID from your LinkedIn Lead Gen Form" />
                </div>
              </div>
              <div className="hub-form-row">
                <label>Commentary (primary text)</label>
                <textarea className="hub-input" rows={2} value={commentary} onChange={(e) => setCommentary(e.target.value)} />
              </div>
              <div className="hub-form-row">
                <label>Image</label>
                <input type="file" accept="image/*" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} />
              </div>
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                disabled={!newCreativeName.trim() || !creativeCampaignId || !leadGenFormId.trim() || !mediaFile || creatingCreative}
                onClick={createCreative}
              >
                <PlusOutlined /> {creatingCreative ? "Uploading…" : "Create Creative (PAUSED)"}
              </button>
              {creatives.length > 0 && (
                <div className="hub-table-wrapper" style={{ marginTop: 10 }}>
                  <table className="hub-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {creatives.map((c) => (
                        <tr key={c._id}>
                          <td>{c.name}</td>
                          <td><span className={`hub-badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                          <td>
                            {(c.status === "PAUSED" || c.status === "DRAFT") && c.linkedinCreativeId && (
                              <button type="button" className="hub-btn hub-btn-primary" disabled={busyId === c._id} onClick={() => publish("creatives", c._id)}>
                                <RocketOutlined /> {busyId === c._id ? "Publishing…" : "Publish Creative"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CaptureForm;
