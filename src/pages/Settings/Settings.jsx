import React, { useEffect, useRef, useState } from "react";
import {
  UserOutlined,
  BankOutlined,
  SettingOutlined,
  GlobalOutlined,
  DollarOutlined,
  PercentageOutlined,
  CreditCardOutlined,
  BellOutlined,
  SafetyOutlined,
  ClusterOutlined,
  PictureOutlined,
  SaveOutlined,
  UndoOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { request } from "@/request";
import { BASE_URL } from "@/config/serverApiConfig";

// Company/Logo/Currency/Localization below are backed by the real Setting
// API (backend/src/controllers/coreControllers/settingController) — the
// same settingKeys already used elsewhere in the app (invoice numbering,
// money formatting). The remaining sections (General, Tax, Payment,
// Notifications, Security, System) don't have a real settings consumer
// anywhere yet, so they're left as before rather than inventing keys
// nothing reads.
async function fetchSettings(keys) {
  const res = await request.get({ entity: `setting/listBySettingKey?settingKeyArray=${keys.join(",")}` });
  const map = {};
  if (res?.success) {
    res.result.forEach((s) => {
      map[s.settingKey] = s.settingValue;
    });
  }
  return map;
}

function saveSettings(pairs) {
  return request.patch({ entity: "setting/updateManySetting", jsonData: { settings: pairs } });
}

const NAV_SECTIONS = [
  { key: "account", label: "Account", icon: <UserOutlined /> },
  { key: "company", label: "Company", icon: <BankOutlined /> },
  { key: "logo", label: "Logo", icon: <PictureOutlined /> },
  { key: "general", label: "General", icon: <SettingOutlined /> },
  { key: "localization", label: "Localization", icon: <GlobalOutlined /> },
  { key: "currency", label: "Currency", icon: <DollarOutlined /> },
  { key: "tax", label: "Tax", icon: <PercentageOutlined /> },
  { key: "payment", label: "Payment Settings", icon: <CreditCardOutlined /> },
  { key: "notifications", label: "Notifications", icon: <BellOutlined /> },
  { key: "security", label: "Security", icon: <SafetyOutlined /> },
  { key: "system", label: "System", icon: <ClusterOutlined /> },
];

function SectionShell({ title, description, children, onSave, dirty }) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave?.();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  return (
    <div className="hub-card">
      <div className="hub-card-header" style={{ alignItems: "flex-start" }}>
        <div>
          <h3>{title}</h3>
          {description && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#667085" }}>{description}</p>
          )}
        </div>

        {dirty && (
          <span className="hub-badge hub-badge-yellow">Unsaved changes</span>
        )}
      </div>

      {children}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--hub-border)" }}>
        <button type="button" className="hub-btn hub-btn-primary" onClick={handleSave} disabled={saving}>
          <SaveOutlined /> {saving ? "Saving…" : "Save Changes"}
        </button>
        <button type="button" className="hub-btn">
          <UndoOutlined /> Reset
        </button>
        {saved && (
          <span style={{ fontSize: 12.5, color: "#16a34a", display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <CheckCircleOutlined /> Saved successfully
          </span>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, defaultOn = false }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 0",
        borderBottom: "1px solid #f2f4f7",
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#101828" }}>{label}</div>
        {description && <div style={{ fontSize: 11.5, color: "#667085", marginTop: 2 }}>{description}</div>}
      </div>
      <button type="button" className={`hub-switch ${on ? "on" : ""}`} onClick={() => setOn((v) => !v)} />
    </div>
  );
}

function AccountSection() {
  return (
    <SectionShell title="Account Settings" description="Your personal profile and login details">
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Full Name</label>
          <input className="hub-input" defaultValue="Rahul Kumar" />
        </div>
        <div className="hub-form-row">
          <label>Email</label>
          <input className="hub-input" defaultValue="rahul.kumar@careerlabconsulting.com" />
        </div>
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Phone</label>
          <input className="hub-input" defaultValue="+91 98765 43210" />
        </div>
        <div className="hub-form-row">
          <label>Role</label>
          <input className="hub-input" defaultValue="Admin" disabled />
        </div>
      </div>
    </SectionShell>
  );
}

const COMPANY_KEYS = ["company_name", "company_website", "company_address", "company_phone", "company_email"];

function CompanySection() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings(COMPANY_KEYS).then((map) => {
      setValues(map);
      setLoading(false);
    });
  }, []);

  const set = (key) => (e) => setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSave = () => saveSettings(COMPANY_KEYS.map((k) => ({ settingKey: k, settingValue: values[k] || '' })));

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading…</div>
      </div>
    );
  }

  return (
    <SectionShell title="Company Settings" description="Details shown on invoices and official documents" onSave={handleSave}>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Company Name</label>
          <input className="hub-input" value={values.company_name || ""} onChange={set("company_name")} />
        </div>
        <div className="hub-form-row">
          <label>Website</label>
          <input className="hub-input" value={values.company_website || ""} onChange={set("company_website")} />
        </div>
      </div>
      <div className="hub-form-row">
        <label>Address</label>
        <input className="hub-input" value={values.company_address || ""} onChange={set("company_address")} />
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Phone</label>
          <input className="hub-input" value={values.company_phone || ""} onChange={set("company_phone")} />
        </div>
        <div className="hub-form-row">
          <label>Support Email</label>
          <input className="hub-input" value={values.company_email || ""} onChange={set("company_email")} />
        </div>
      </div>
    </SectionShell>
  );
}

function LogoSection() {
  const [logoPath, setLogoPath] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSettings(["company_logo"]).then((map) => {
      setLogoPath(map.company_logo || null);
      setLoading(false);
    });
  }, []);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    const res = await request.post({ entity: "setting/upload/company_logo", jsonData: formData });
    setUploading(false);
    if (res?.success) {
      setLogoPath(res.result?.settingValue || null);
    } else {
      setError(res?.message || "Could not upload the logo.");
    }
  };

  return (
    <div className="hub-card">
      <div className="hub-card-header" style={{ alignItems: "flex-start" }}>
        <div>
          <h3>Company Logo</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#667085" }}>
            Used on invoices, the login page, and the sidebar
          </p>
        </div>
      </div>

      <div className="hub-image-upload">
        <div className="hub-image-upload-preview" style={{ width: 72, height: 72, overflow: "hidden" }}>
          {loading ? "…" : logoPath ? (
            <img
              src={BASE_URL + logoPath}
              alt="Company logo"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          ) : (
            "No logo"
          )}
        </div>
        <div>
          <label
            className="hub-btn hub-btn-primary"
            style={{ cursor: uploading ? "wait" : "pointer", display: "inline-flex" }}
          >
            {uploading ? "Uploading…" : "Upload Logo"}
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} disabled={uploading} />
          </label>
          <div style={{ fontSize: 11.5, color: "#667085", marginTop: 8 }}>
            PNG or SVG, at least 256×256px, transparent background recommended.
          </div>
          {error && <div style={{ fontSize: 11.5, color: "var(--hub-red)", marginTop: 6 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

function GeneralSection() {
  return (
    <SectionShell title="General Settings" description="Basic workspace preferences">
      <div className="hub-form-row">
        <label>Workspace Name</label>
        <input className="hub-input" defaultValue="Career Lab Consulting CRM" />
      </div>
      <ToggleRow label="Enable dark sidebar" description="Applies to the main navigation only" defaultOn />
      <ToggleRow label="Compact table rows" description="Show more rows per screen in list views" />
      <ToggleRow label="Show onboarding tips" description="Display helper tooltips for new team members" defaultOn />
    </SectionShell>
  );
}

const LOCALIZATION_KEYS = ["idurar_app_language", "idurar_app_timezone", "idurar_app_date_format"];
// Only en_us actually has a translation file in this codebase today (see
// frontend/src/locale/translation/) — offering Hindi/Spanish here would
// save a real value but not actually change any visible text yet, so this
// stays English-only until those translation files exist.
const LANGUAGE_OPTIONS = [{ value: "en_us", label: "English" }];
const TIMEZONE_OPTIONS = ["Asia/Kolkata (IST)", "America/New_York (EST)", "Europe/London (GMT)"];
const DATE_FORMAT_OPTIONS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];

function LocalizationSection() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings(LOCALIZATION_KEYS).then((map) => {
      setValues({
        idurar_app_language: map.idurar_app_language || "en_us",
        idurar_app_timezone: map.idurar_app_timezone || TIMEZONE_OPTIONS[0],
        idurar_app_date_format: map.idurar_app_date_format || DATE_FORMAT_OPTIONS[0],
      });
      setLoading(false);
    });
  }, []);

  const set = (key) => (e) => setValues((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSave = () =>
    saveSettings(LOCALIZATION_KEYS.map((k) => ({ settingKey: k, settingValue: values[k] })));

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading…</div>
      </div>
    );
  }

  return (
    <SectionShell title="Localization" description="Language, timezone and date formatting" onSave={handleSave}>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>App Language</label>
          <select className="hub-select" value={values.idurar_app_language} onChange={set("idurar_app_language")}>
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Timezone</label>
          <select className="hub-select" value={values.idurar_app_timezone} onChange={set("idurar_app_timezone")}>
            {TIMEZONE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="hub-form-row">
        <label>Date Format</label>
        <select className="hub-select" value={values.idurar_app_date_format} onChange={set("idurar_app_date_format")}>
          {DATE_FORMAT_OPTIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
    </SectionShell>
  );
}

const CURRENCY_KEYS = [
  "default_currency_code",
  "currency_name",
  "currency_symbol",
  "currency_position",
  "thousand_sep",
  "cent_precision",
];
const CURRENCY_PRESETS = [
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
];
const THOUSAND_SEP_OPTIONS = [
  { value: ",", label: "Comma (1,000)" },
  { value: ".", label: "Period (1.000)" },
  { value: " ", label: "Space (1 000)" },
];

function CurrencySection() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings(CURRENCY_KEYS).then((map) => {
      setValues({
        default_currency_code: map.default_currency_code || "INR",
        currency_name: map.currency_name || "Indian Rupee",
        currency_symbol: map.currency_symbol || "₹",
        currency_position: map.currency_position || "before",
        thousand_sep: map.thousand_sep ?? ",",
        cent_precision: map.cent_precision ?? 2,
      });
      setLoading(false);
    });
  }, []);

  const setCurrencyPreset = (e) => {
    const preset = CURRENCY_PRESETS.find((p) => p.code === e.target.value);
    if (!preset) return;
    setValues((prev) => ({
      ...prev,
      default_currency_code: preset.code,
      currency_name: preset.name,
      currency_symbol: preset.symbol,
    }));
  };

  const set = (key, transform = (v) => v) => (e) =>
    setValues((prev) => ({ ...prev, [key]: transform(e.target.value) }));

  const handleSave = () =>
    saveSettings(CURRENCY_KEYS.map((k) => ({ settingKey: k, settingValue: values[k] })));

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading…</div>
      </div>
    );
  }

  return (
    <SectionShell title="Currency" description="How amounts are displayed across the app" onSave={handleSave}>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Currency</label>
          <select className="hub-select" value={values.default_currency_code} onChange={setCurrencyPreset}>
            {CURRENCY_PRESETS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} — {p.name} ({p.symbol})
              </option>
            ))}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Currency Position</label>
          <select className="hub-select" value={values.currency_position} onChange={set("currency_position")}>
            <option value="before">Before amount ({values.currency_symbol}1,000)</option>
            <option value="after">After amount (1,000{values.currency_symbol})</option>
          </select>
        </div>
      </div>
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Thousand Separator</label>
          <select className="hub-select" value={values.thousand_sep} onChange={set("thousand_sep")}>
            {THOUSAND_SEP_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="hub-form-row">
          <label>Decimal Places</label>
          <select className="hub-select" value={values.cent_precision} onChange={set("cent_precision", Number)}>
            <option value={0}>0</option>
            <option value={2}>2</option>
          </select>
        </div>
      </div>
    </SectionShell>
  );
}

function TaxSection() {
  return (
    <SectionShell title="Tax" description="Default tax rates applied to new invoices">
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Default Tax Rate (%)</label>
          <input className="hub-input" type="number" defaultValue="18" />
        </div>
        <div className="hub-form-row">
          <label>Company GSTIN</label>
          <input className="hub-input" defaultValue="23AAACT2727Q1ZW" />
        </div>
      </div>
      <ToggleRow label="Prices include tax" description="Line item rates are treated as tax-inclusive" />
    </SectionShell>
  );
}

function PaymentSettingsSection() {
  return (
    <SectionShell title="Payment Settings" description="Invoicing defaults and accepted payment methods">
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Invoice Prefix</label>
          <input className="hub-input" defaultValue="INV-2026-" />
        </div>
        <div className="hub-form-row">
          <label>Payment Due (Days)</label>
          <input className="hub-input" type="number" defaultValue="14" />
        </div>
      </div>
      <ToggleRow label="Accept UPI" defaultOn />
      <ToggleRow label="Accept Bank Transfer" defaultOn />
      <ToggleRow label="Accept Credit Card" defaultOn />
      <ToggleRow label="Accept Cheque" />
    </SectionShell>
  );
}

function NotificationsSection() {
  return (
    <SectionShell title="Notifications" description="Choose what you get notified about">
      <ToggleRow label="Email notifications for new leads" defaultOn />
      <ToggleRow label="WhatsApp alerts for missed calls" defaultOn />
      <ToggleRow label="Weekly performance summary" />
      <ToggleRow label="Ticket updates" defaultOn />
      <ToggleRow label="Invoice due-date reminders" defaultOn />
    </SectionShell>
  );
}

function SecuritySection() {
  return (
    <SectionShell title="Security" description="Protect your account and workspace">
      <div className="hub-form-row">
        <label>Change Password</label>
        <input className="hub-input" type="password" placeholder="New password" />
      </div>
      <ToggleRow label="Two-factor authentication" description="Require an OTP in addition to your password" />
      <ToggleRow label="Log out other sessions after password change" defaultOn />
    </SectionShell>
  );
}

function SystemSection() {
  return (
    <SectionShell title="System" description="Workspace-level technical settings">
      <div className="hub-grid-2">
        <div className="hub-form-row">
          <label>Data Backup Frequency</label>
          <select className="hub-select" defaultValue="Daily">
            <option>Daily</option>
            <option>Weekly</option>
            <option>Monthly</option>
          </select>
        </div>
        <div className="hub-form-row">
          <label>Session Timeout (minutes)</label>
          <input className="hub-input" type="number" defaultValue="30" />
        </div>
      </div>
      <ToggleRow label="Maintenance mode" description="Temporarily restrict access while you make changes" />
    </SectionShell>
  );
}

const SECTION_COMPONENTS = {
  account: AccountSection,
  company: CompanySection,
  logo: LogoSection,
  general: GeneralSection,
  localization: LocalizationSection,
  currency: CurrencySection,
  tax: TaxSection,
  payment: PaymentSettingsSection,
  notifications: NotificationsSection,
  security: SecuritySection,
  system: SystemSection,
};

export default function Settings() {
  const [active, setActive] = useState("account");
  const ActiveSection = SECTION_COMPONENTS[active];

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Settings</h2>
          <p>Configure your workspace, company details, and preferences</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div
          className="hub-card"
          style={{ width: 220, flexShrink: 0, padding: 10 }}
        >
          {NAV_SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive(s.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                border: "none",
                background: active === s.key ? "#eff4ff" : "transparent",
                color: active === s.key ? "#2563eb" : "#344054",
                fontWeight: active === s.key ? 700 : 500,
                fontSize: 13,
                padding: "10px 12px",
                borderRadius: 8,
                cursor: "pointer",
                marginBottom: 2,
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ fontSize: 15 }}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <ActiveSection />
        </div>
      </div>
    </div>
  );
}