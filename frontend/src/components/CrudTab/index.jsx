import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  DatePicker,
  TimePicker,
  Select,
  Switch,
  Popconfirm,
  ConfigProvider,
} from 'antd';
import dayjs from 'dayjs';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
  MailOutlined,
  PhoneOutlined,
  LinkOutlined,
  DollarOutlined,
  CalendarOutlined,
  UserOutlined,
  TeamOutlined,
  FileTextOutlined,
  EnvironmentOutlined,
  TagOutlined,
  TagsOutlined,
  BankOutlined,
  NumberOutlined,
  CheckSquareOutlined,
  AppstoreOutlined,
  FormOutlined,
  ClockCircleOutlined,
  IdcardOutlined,
  ProfileOutlined,
  RightOutlined,
} from '@ant-design/icons';

import { request } from '@/request';

const PAGE_SIZE = 10;
// antd derives its palette from these, so they must be real colours — a
// CSS var (var(--hub-blue)) can't be resolved at token-compute time and the
// primary button falls back to black. Keep in sync with --hub-blue.
const HUB_TOKENS = { colorPrimary: '#0e7490', borderRadius: 9 };
const BADGE_FIELDS = new Set([
  'status', 'stage', 'priority', 'feeStatus', 'paymentStatus', 'health',
  'healthStatus', 'consent', 'ratingLabel', 'condition',
]);
const SEARCHABLE_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'url', 'select']);

// A field → icon, keyed on the field name first, then the input type.
function iconForField(f) {
  const n = f.name.toLowerCase();
  if (/email/.test(n)) return <MailOutlined />;
  if (/phone|mobile|whatsapp|contactphone|^tel/.test(n)) return <PhoneOutlined />;
  if (/url|link|website|meetinglink|joinurl|thumbnail|resume|receipt|file/.test(n)) return <LinkOutlined />;
  if (/amount|price|cost|ctc|salary|budget|revenue|\bfee|pay(roll|slip|ment|date)?|emi|netpay|gross|deduction|allowance|hra|\bpf\b|esi|tds|spend|value|throttle|points|fnf/.test(n))
    return <DollarOutlined />;
  if (/date|dob|\bday\b|joined|joiningdate|expiry|issued|scheduled|deadline|refreshed|onboarded|contractend|lastworking|resignation|settled/.test(n))
    return <CalendarOutlined />;
  if (/owner|manager|employee$|assignedto|trainer|instructor|approver|recruiter|reviewer|coordinator|counselor|buddy|givenby|publishedby|uploadedby|raisedby|contact$|contactperson|contactname|handoverto|issuedby/.test(n))
    return <UserOutlined />;
  if (/department|team|audience/.test(n)) return <TeamOutlined />;
  if (/notes|description|reason|feedback|comment|goals|remark|resolution|justification|body|message|agenda|terms|criteria|outcomes|strengths|improvements|prerequisites|decisionnote/.test(n))
    return <FileTextOutlined />;
  if (/address|location|venue|city|region|applicablelocations/.test(n)) return <EnvironmentOutlined />;
  if (/^tags$/.test(n)) return <TagsOutlined />;
  if (/company|account|client|vendor|organisation|organization/.test(n)) return <BankOutlined />;
  if (/employeeid|enrollmentid|certificateid|assettag|\bcode\b|serialnumber|number$|gstin|\bpan\b|uan|\bsku\b|hsncode|invoiceref|quoteref|utm|templateref/.test(n))
    return <IdcardOutlined />;
  if (/clockin|clockout|starttime|endtime|jointime|leavetime|time$|hours/.test(n)) return <ClockCircleOutlined />;
  if (/status|stage|priority|category|type$|mode|level|channel|shift|awardtype|exittype|leavetype|doctype|lifecycle|visibility|paymentmode|source|objective|triggertype/.test(n))
    return <AppstoreOutlined />;
  if (/name|title|subject|topic|engagement|program/.test(n)) return <TagOutlined />;

  if (f.type === 'number') return <NumberOutlined />;
  if (f.type === 'date') return <CalendarOutlined />;
  if (f.type === 'bool') return <CheckSquareOutlined />;
  if (f.type === 'textarea') return <FileTextOutlined />;
  if (f.type === 'select') return <ProfileOutlined />;
  return <FormOutlined />;
}

function formatCell(field, value) {
  if (field.type === 'bool') return value ? 'Yes' : 'No';
  if (value === undefined || value === null || value === '') return '—';
  if (field.type === 'date') {
    const d = dayjs(value);
    return d.isValid() ? d.format('DD MMM YYYY') : '—';
  }
  if (field.type === 'number') return Number(value).toLocaleString();
  return String(value);
}

/**
 * CrudTab — searchable paginated GET list + Add / Edit / Delete for one
 * entity, driven by a `fields` spec (config/featureSections.js). Uses the
 * generic IDURAR endpoints: /api/<entity>/{list,create,update,delete}.
 */
export default function CrudTab({ entity, fields, fixedFilter, title, icon, renderRowExtra }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  // { [groupName]: true } — which form sections are folded shut.
  const [collapsed, setCollapsed] = useState({});
  const [refOptions, setRefOptions] = useState({});
  const [form] = Form.useForm();

  // Fields whose Select options come from another entity's live list (e.g.
  // Students' Course/Batch pickers) instead of a static `options` array.
  const refFields = useMemo(() => fields.filter((f) => f.refEntity), [fields]);
  const loadRefOptions = useCallback(async () => {
    if (!refFields.length) return;
    const entries = await Promise.all(
      refFields.map(async (f) => {
        const res = await request.list({ entity: f.refEntity, options: { page: 1, items: 500, sortBy: 'created', sortValue: -1 } });
        const rows = Array.isArray(res?.result) ? res.result : [];
        const labelKey = f.refLabel || 'name';
        const filtered = f.refFilter ? rows.filter(f.refFilter) : rows;
        // Value is always the plain name/title string (what Batch.course /
        // Student.batch etc. actually store) — `refDisplay` only changes
        // what's SHOWN in the dropdown (e.g. "AI101 — Artificial Intelligence").
        const seen = new Set();
        const opts = [];
        filtered.forEach((r) => {
          const value = r[labelKey];
          if (!value || seen.has(value)) return;
          seen.add(value);
          opts.push({ value, label: f.refDisplay ? f.refDisplay(r) : value });
        });
        return [f.name, opts];
      })
    );
    setRefOptions(Object.fromEntries(entries));
  }, [refFields]);

  const HeadIcon = icon || null;
  const tableFields = useMemo(() => fields.filter((f) => f.table !== false).slice(0, 7), [fields]);
  const searchFields = useMemo(
    () => fields.filter((f) => SEARCHABLE_TYPES.has(f.type)).map((f) => f.name),
    [fields]
  );

  // Fields split into consecutive `group` runs → one collapsible section each.
  // `hidden` fields (e.g. a self-generated Code) never render an input —
  // they're still saved/loaded normally, just with nothing on screen to fill in.
  const sections = useMemo(() => {
    const out = [];
    fields
      .filter((f) => !f.hidden)
      .forEach((f) => {
        const g = f.group || '';
        const last = out[out.length - 1];
        if (last && last.group === g) last.items.push(f);
        else out.push({ group: g, items: [f] });
      });
    return out.filter((s) => s.items.length > 0);
  }, [fields]);

  // Add: only the first section open (keeps the modal short — the rest are a
  // click away). Edit: everything open so existing data is all visible.
  const buildCollapsed = useCallback(
    (isEdit) => {
      const c = {};
      sections.forEach((s, i) => {
        if (s.group) c[s.group] = isEdit ? false : i > 0;
      });
      return c;
    },
    [sections]
  );

  const load = useCallback(
    async (targetPage = 1, term = '') => {
      setLoading(true);
      const options = { page: targetPage, items: PAGE_SIZE, sortBy: 'created', sortValue: -1 };
      if (fixedFilter) {
        options.filter = fixedFilter.field;
        options.equal = fixedFilter.value;
      }
      if (term && searchFields.length) {
        options.fields = searchFields.join(',');
        options.q = term;
      }
      const res = await request.list({ entity, options });
      setRows(Array.isArray(res?.result) ? res.result : []);
      setPage(res?.pagination?.page ? Number(res.pagination.page) : targetPage);
      setPages(res?.pagination?.pages || 1);
      setCount(res?.pagination?.count || 0);
      setLoading(false);
    },
    [entity, fixedFilter, searchFields]
  );

  useEffect(() => {
    setPage(1);
    load(1, q);
  }, [load, q]);

  const runSearch = () => setQ(query.trim());
  const clearSearch = () => {
    setQuery('');
    setQ('');
  };

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    setCollapsed(buildCollapsed(false));
    setModalOpen(true);
    loadRefOptions();
  };

  const openEdit = (row) => {
    setEditing(row);
    loadRefOptions();
    const values = {};
    fields.forEach((f) => {
      const v = row[f.name];
      if (f.type === 'date') values[f.name] = v ? dayjs(v) : undefined;
      else if (f.type === 'time') values[f.name] = v ? dayjs(v, 'HH:mm') : undefined;
      else if (f.type === 'bool') values[f.name] = !!v;
      else values[f.name] = v;
    });
    form.setFieldsValue(values);
    setCollapsed(buildCollapsed(true));
    setModalOpen(true);
  };

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch (err) {
      // Reveal any folded section that now holds an invalid field.
      const bad = new Set((err?.errorFields || []).map((e) => e.name?.[0]));
      if (bad.size) {
        setCollapsed((prev) => {
          const next = { ...prev };
          sections.forEach((s) => {
            if (s.group && s.items.some((f) => bad.has(f.name))) next[s.group] = false;
          });
          return next;
        });
      }
      return;
    }
    const payload = {};
    fields.forEach((f) => {
      let v = values[f.name];
      if (f.type === 'date') v = v ? dayjs(v).toISOString() : undefined;
      if (f.type === 'time') v = v ? dayjs(v).format('HH:mm') : undefined;
      if (f.type === 'bool') v = !!v;
      payload[f.name] = v;
    });
    if (fixedFilter && !editing) payload[fixedFilter.field] = fixedFilter.value;

    setSaving(true);
    const res = editing
      ? await request.update({ entity, id: editing._id, jsonData: payload })
      : await request.create({ entity, jsonData: payload });
    setSaving(false);

    if (res?.success) {
      setModalOpen(false);
      load(editing ? page : 1, q);
    }
  };

  const remove = async (row) => {
    const res = await request.delete({ entity, id: row._id });
    if (res?.success) {
      const lastPage = Math.max(1, Math.ceil((count - 1) / PAGE_SIZE));
      load(Math.min(page, lastPage), q);
    }
  };

  return (
    <ConfigProvider theme={{ token: HUB_TOKENS }}>
      <div className="hub-stack">
        <div className={`hub-card crud-entity-${entity}`}>
          <div className="hub-card-header">
            <h3 className="crud-title">
              {HeadIcon ? <HeadIcon /> : null}
              {title}
              <span className="hub-badge hub-badge-gray">{count}</span>
            </h3>
            <div className="hub-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="crud-search">
                <SearchOutlined />
                <input
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                />
                {q ? (
                  <button type="button" className="crud-search-clear" onClick={clearSearch} title="Clear">
                    ×
                  </button>
                ) : (
                  <button type="button" className="crud-search-go" onClick={runSearch} title="Search">
                    Go
                  </button>
                )}
              </div>
              <button type="button" className="hub-btn" onClick={() => load(page, q)}>
                <ReloadOutlined /> Refresh
              </button>
              <button type="button" className="hub-btn hub-btn-primary" onClick={openAdd}>
                <PlusOutlined /> Add
              </button>
            </div>
          </div>

          <div className="hub-table-wrapper">
            <table className="hub-table crud-table">
              <thead>
                <tr>
                  {tableFields.map((f) => (
                    <th key={f.name}>{f.label}</th>
                  ))}
                  <th style={{ width: renderRowExtra ? 128 : 96, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={tableFields.length + 1}>
                      <div className="hub-empty">Loading…</div>
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={tableFields.length + 1}>
                      <div className="hub-empty">
                        {q ? 'No records match your search.' : 'No records yet. Click “Add” to create the first one.'}
                      </div>
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((row) => (
                    <tr key={row._id}>
                      {tableFields.map((f) => (
                        <td key={f.name}>
                          {BADGE_FIELDS.has(f.name) && row[f.name] ? (
                            <span className="hub-badge hub-badge-gray">{formatCell(f, row[f.name])}</span>
                          ) : (
                            <span className="crud-cell">{formatCell(f, row[f.name])}</span>
                          )}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {renderRowExtra && renderRowExtra(row)}
                        <button type="button" className="hub-icon-btn" title="Edit" onClick={() => openEdit(row)}>
                          <EditOutlined />
                        </button>
                        <Popconfirm
                          title="Delete this record?"
                          okText="Delete"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => remove(row)}
                        >
                          <button type="button" className="hub-icon-btn hub-icon-btn-danger" title="Delete">
                            <DeleteOutlined />
                          </button>
                        </Popconfirm>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="hub-row" style={{ justifyContent: 'center', gap: 12, marginTop: 14, alignItems: 'center' }}>
              <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => load(page - 1, q)}>
                Prev
              </button>
              <span style={{ fontSize: 12.5, color: 'var(--hub-muted)' }}>
                Page {page} of {pages} · {count} records
              </span>
              <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => load(page + 1, q)}>
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      <Modal
        className="crud-modal"
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon">{HeadIcon ? <HeadIcon /> : <FormOutlined />}</span>
            <span>
              <span className="crud-modal-title-kicker">{editing ? 'Edit record' : 'New record'}</span>
              <span className="crud-modal-title-main">{title}</span>
            </span>
          </span>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        okText={editing ? 'Save changes' : 'Create'}
        confirmLoading={saving}
        destroyOnClose
        maskClosable={false}
        width={780}
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          scrollToFirstError={{ behavior: 'smooth', block: 'center' }}
          className="crud-form"
          onValuesChange={() => {
            // Derived fields (e.g. Batch's Class duration from Start/End
            // time, Students' Total-incl-GST / Balance due) — recompute from
            // the live form values and write in whichever ones a field's
            // `compute` actually resolves. Fold each result back into `all`
            // before the next field's compute runs, so a field that derives
            // from another computed field (Balance due <- Total incl. GST)
            // sees the fresh value in the same pass instead of lagging a
            // tick behind (setFieldsValue doesn't re-fire onValuesChange).
            const computable = fields.filter((f) => typeof f.compute === 'function');
            if (!computable.length) return;
            const all = { ...form.getFieldsValue() };
            const patch = {};
            computable.forEach((f) => {
              const next = f.compute(all);
              if (next !== undefined && next !== all[f.name]) {
                patch[f.name] = next;
                all[f.name] = next;
              }
            });
            if (Object.keys(patch).length) form.setFieldsValue(patch);
          }}
        >
          {sections.map((section, gi) => {
            const isCollapsed = section.group ? !!collapsed[section.group] : false;
            return (
              <div className="crud-section" key={section.group || `g${gi}`}>
                {section.group && (
                  <button
                    type="button"
                    className="crud-section-head"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [section.group]: !c[section.group] }))
                    }
                  >
                    <span className="crud-section-dot" />
                    <span className="crud-section-name">{section.group}</span>
                    <span className="crud-section-count">{section.items.length}</span>
                    <RightOutlined className={`crud-section-chevron${isCollapsed ? '' : ' open'}`} />
                  </button>
                )}
                <div className={`crud-section-body${isCollapsed ? ' is-collapsed' : ''}`}>
                  <div className="crud-form-grid">
                    {section.items.map((f) => {
                      const full = f.type === 'textarea';
                      return (
                        <Form.Item
                          key={f.name}
                          name={f.name}
                          label={
                            <span className="crud-lbl">
                              <span className="crud-lbl-icon">{iconForField(f)}</span>
                              {f.label}
                            </span>
                          }
                          valuePropName={f.type === 'bool' ? 'checked' : 'value'}
                          className={full ? 'crud-form-full' : undefined}
                          extra={f.hint || (f.compute ? 'Auto-calculated' : undefined)}
                          rules={
                            f.required ? [{ required: true, message: `${f.label} is required` }] : undefined
                          }
                        >
                          {f.type === 'textarea' ? (
                            <Input.TextArea rows={2} placeholder={f.placeholder} />
                          ) : f.type === 'number' ? (
                            <InputNumber style={{ width: '100%' }} placeholder={f.placeholder} />
                          ) : f.type === 'date' ? (
                            <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
                          ) : f.type === 'time' ? (
                            <TimePicker style={{ width: '100%' }} format="HH:mm" minuteStep={5} use12Hours={false} />
                          ) : f.type === 'bool' ? (
                            <Switch />
                          ) : f.type === 'select' ? (
                            <Select
                              allowClear
                              showSearch
                              optionFilterProp="label"
                              placeholder={f.refEntity ? `Select a ${f.label.toLowerCase()}…` : undefined}
                              options={f.refEntity ? (refOptions[f.name] || []) : (f.options || []).map((o) => ({ label: o, value: o }))}
                            />
                          ) : (
                            <Input type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'} placeholder={f.placeholder} />
                          )}
                        </Form.Item>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </Form>
      </Modal>
    </ConfigProvider>
  );
}
