import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Drawer, Select, Spin, List, Tag, Button, Popconfirm, Empty, message } from 'antd';
import { UserOutlined, DeleteOutlined } from '@ant-design/icons';
import lmsApi from '../api';

// Two student pools that don't otherwise talk to each other: the LMS
// `Student` roster (ops/CRM rows — fees, progress, counselor…) and real
// login accounts made from User Management with role Student. The search
// endpoint (GET /lms/students/search) merges both by email; this panel is
// the one place that lets you assign either kind to a batch.
const SOURCE_LABEL = { roster: 'LMS roster', account: 'User Management', both: 'LMS + User Mgmt' };
const SOURCE_COLOR = { roster: 'purple', account: 'blue', both: 'green' };

export default function BatchStudentsPanel({ open, onClose, batchId, batchName }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const searchTimer = useRef(null);

  const loadRoster = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      const res = await lmsApi.listBatchStudents(batchId);
      setRoster((res && res.result) || []);
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    if (open) loadRoster();
    else setOptions([]);
  }, [open, loadRoster]);

  useEffect(() => () => searchTimer.current && clearTimeout(searchTimer.current), []);

  const onSearch = (q) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = q.trim();
    if (term.length < 2) {
      setOptions([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await lmsApi.searchStudents(term);
        const found = (res && res.result) || [];
        const opts = found.map((s) => ({
          value: s.email,
          data: s,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>{s.name} — {s.email}{s.currentBatch ? ` (in ${s.currentBatch})` : ''}</span>
              <Tag color={SOURCE_COLOR[s.source]} style={{ marginInlineEnd: 0 }}>{SOURCE_LABEL[s.source]}</Tag>
            </span>
          ),
        }));
        const emailLike = /.+@.+\..+/.test(term);
        if (emailLike && !found.some((s) => s.email === term.toLowerCase())) {
          opts.push({ value: term, data: { email: term, name: '' }, label: `Add "${term}" as a new student` });
        }
        setOptions(opts);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const onPick = async (value, option) => {
    const s = (option && option.data) || { email: value };
    setAdding(true);
    try {
      const res = await lmsApi.addBatchStudent(batchId, { email: s.email, name: s.name, crmUserId: s.crmUserId });
      if (res && res.success === false) {
        message.warning(res.message || 'Could not add the student.');
      } else {
        message.success(res && res.result && res.result.emailed ? 'Student added — class link emailed.' : 'Student added to the batch.');
        setOptions([]);
        loadRoster();
      }
    } catch (e) {
      message.error('Could not add the student.');
    } finally {
      setAdding(false);
    }
  };

  const onRemove = async (row) => {
    try {
      const res = await lmsApi.removeBatchStudent(batchId, { studentId: row.id, crmUserId: row.crmUserId, email: row.email });
      if (res && res.success === false) message.warning(res.message || 'Could not remove the student.');
      else {
        message.success('Student removed from this batch.');
        loadRoster();
      }
    } catch (e) {
      message.error('Could not remove the student.');
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title={batchName ? `Manage students — ${batchName}` : 'Manage students'} width={440} destroyOnClose>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--hub-muted)' }}>Add a student</div>
        <Select
          showSearch
          value={null}
          placeholder="Search by name or email…"
          filterOption={false}
          notFoundContent={searching ? <Spin size="small" /> : null}
          onSearch={onSearch}
          onChange={onPick}
          options={options}
          disabled={adding}
          style={{ width: '100%' }}
        />
        <p style={{ fontSize: 11.5, color: 'var(--hub-muted)', marginTop: 6, marginBottom: 0 }}>
          Searches both the LMS student roster and User Management accounts. The student is emailed this batch's
          class link + schedule.
        </p>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--hub-muted)' }}>
        Currently in this batch ({roster.length})
      </div>
      <List
        loading={loading}
        dataSource={roster}
        locale={{ emptyText: <Empty description="No students yet" /> }}
        renderItem={(row) => (
          <List.Item
            actions={[
              <Popconfirm key="rm" title="Remove from this batch?" okText="Remove" okButtonProps={{ danger: true }} onConfirm={() => onRemove(row)}>
                <Button type="text" danger size="small" icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta avatar={<UserOutlined />} title={row.name} description={row.email} />
            <Tag color={SOURCE_COLOR[row.source]}>{SOURCE_LABEL[row.source]}</Tag>
          </List.Item>
        )}
      />
    </Drawer>
  );
}
