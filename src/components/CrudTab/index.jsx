import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  DatePicker,
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
} from '@ant-design/icons';

import { request } from '@/request';

const PAGE_SIZE = 10;
const HUB_TOKENS = { colorPrimary: 'var(--hub-blue)', borderRadius: 8 };
const BADGE_FIELDS = new Set([
  'status',
  'stage',
  'priority',
  'feeStatus',
  'paymentStatus',
  'health',
  'healthStatus',
  'consent',
  'ratingLabel',
]);
const SEARCHABLE_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'url', 'select']);

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
 * CrudTab — a searchable paginated GET list + Add / Edit / Delete for one
 * entity, driven by a `fields` spec (config/featureSections.js). Talks to the
 * generic IDURAR CRUD endpoints: /api/<entity>/{list,create,update,delete}.
 */
export default function CrudTab({ entity, fields, fixedFilter, title }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState(''); // debounced/applied search term

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const tableFields = useMemo(() => fields.filter((f) => f.table !== false).slice(0, 7), [fields]);
  const searchFields = useMemo(
    () => fields.filter((f) => SEARCHABLE_TYPES.has(f.type)).map((f) => f.name),
    [fields]
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
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    const values = {};
    fields.forEach((f) => {
      const v = row[f.name];
      if (f.type === 'date') values[f.name] = v ? dayjs(v) : undefined;
      else if (f.type === 'bool') values[f.name] = !!v;
      else values[f.name] = v;
    });
    form.setFieldsValue(values);
    setModalOpen(true);
  };

  const submit = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const payload = {};
    fields.forEach((f) => {
      let v = values[f.name];
      if (f.type === 'date') v = v ? dayjs(v).toISOString() : undefined;
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

  let lastGroup = null;

  return (
    <ConfigProvider theme={{ token: HUB_TOKENS }}>
      <div className="hub-stack">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>
              {title}
              <span className="hub-badge hub-badge-gray" style={{ marginLeft: 8 }}>
                {count}
              </span>
            </h3>
            <div className="hub-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="hub-row" style={{ gap: 0 }}>
                <input
                  className="hub-input"
                  style={{ width: 200 }}
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                />
                <button type="button" className="hub-btn" onClick={runSearch} title="Search">
                  <SearchOutlined />
                </button>
                {q && (
                  <button type="button" className="hub-btn" onClick={clearSearch}>
                    Clear
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
            <table className="hub-table">
              <thead>
                <tr>
                  {tableFields.map((f) => (
                    <th key={f.name}>{f.label}</th>
                  ))}
                  <th style={{ width: 110, textAlign: 'right' }}>Actions</th>
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
            <div
              className="hub-row"
              style={{ justifyContent: 'center', gap: 12, marginTop: 14, alignItems: 'center' }}
            >
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
        title={`${editing ? 'Edit' : 'Add'} — ${title}`}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        okText={editing ? 'Save changes' : 'Create'}
        confirmLoading={saving}
        destroyOnClose
        maskClosable={false}
        width={720}
      >
        <Form form={form} layout="vertical" preserve={false} className="crud-form-grid">
          {fields.map((f) => {
            const groupHeading =
              f.group && f.group !== lastGroup ? (
                <div className="crud-form-group" key={`g-${f.group}`}>
                  {f.group}
                </div>
              ) : null;
            lastGroup = f.group || lastGroup;

            const full = f.type === 'textarea';
            return (
              <React.Fragment key={f.name}>
                {groupHeading}
                <Form.Item
                  name={f.name}
                  label={f.label}
                  valuePropName={f.type === 'bool' ? 'checked' : 'value'}
                  className={full ? 'crud-form-full' : undefined}
                  rules={
                    f.required ? [{ required: true, message: `${f.label} is required` }] : undefined
                  }
                >
                  {f.type === 'textarea' ? (
                    <Input.TextArea rows={2} />
                  ) : f.type === 'number' ? (
                    <InputNumber style={{ width: '100%' }} />
                  ) : f.type === 'date' ? (
                    <DatePicker style={{ width: '100%' }} format="DD MMM YYYY" />
                  ) : f.type === 'bool' ? (
                    <Switch />
                  ) : f.type === 'select' ? (
                    <Select allowClear options={(f.options || []).map((o) => ({ label: o, value: o }))} />
                  ) : (
                    <Input type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'} />
                  )}
                </Form.Item>
              </React.Fragment>
            );
          })}
        </Form>
      </Modal>
    </ConfigProvider>
  );
}
