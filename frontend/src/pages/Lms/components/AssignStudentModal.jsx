import React, { useEffect, useRef, useState } from 'react';
import { Modal, Select, Spin, Tag, message } from 'antd';
import { UsergroupAddOutlined } from '@ant-design/icons';
import { request } from '@/request';
import lmsApi from '../api';

// Two student pools that don't otherwise talk to each other: the LMS
// `Student` roster (ops/CRM rows — fees, progress, counselor…) and real
// login accounts made from User Management with role Student — see
// BatchStudentsPanel.jsx for the same search. This modal is the mirror
// entry point: reachable from the Students tab instead of a single batch's
// row, so it can pull in EITHER kind of student and put them in ANY batch.
const SOURCE_LABEL = { roster: 'LMS roster', account: 'User Management', both: 'LMS + User Mgmt' };
const SOURCE_COLOR = { roster: 'purple', account: 'blue', both: 'green' };
const ASSIGNABLE_STATUS = ['Planned', 'Open for Enrollment', 'Running'];

export default function AssignStudentModal({ open, onClose, onAssigned, presetStudent }) {
  const [studentOptions, setStudentOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [student, setStudent] = useState(null); // { email, name, crmUserId } | null
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const searchTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStudent(presetStudent || null);
    setStudentOptions([]);
    setBatchId(null);
    setLoadingBatches(true);
    request
      .listAll({ entity: 'batch' })
      .then((res) => {
        const all = res?.success ? res.result : [];
        setBatches(all.filter((b) => ASSIGNABLE_STATUS.includes(b.status)));
      })
      .finally(() => setLoadingBatches(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => searchTimer.current && clearTimeout(searchTimer.current), []);

  const onSearch = (q) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = q.trim();
    if (term.length < 2) {
      setStudentOptions([]);
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
        setStudentOptions(opts);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const pickStudent = (value, option) => {
    setStudent((option && option.data) || { email: value });
  };

  const submit = async () => {
    if (!student || !batchId) return;
    setSubmitting(true);
    try {
      const res = await lmsApi.addBatchStudent(batchId, {
        email: student.email,
        name: student.name,
        crmUserId: student.crmUserId,
      });
      if (res && res.success === false) {
        message.warning(res.message || 'Could not assign the student.');
      } else {
        message.success(res && res.result && res.result.emailed ? 'Assigned — class link emailed.' : 'Student assigned to the batch.');
        onAssigned?.();
        onClose();
      }
    } catch (e) {
      message.error('Could not assign the student.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      className="crud-modal"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="Assign"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !student || !batchId }}
      destroyOnClose
      width={460}
      title={
        <span className="crud-modal-title">
          <span className="crud-modal-title-icon"><UsergroupAddOutlined /></span>
          <span>
            <span className="crud-modal-title-kicker">Batch assignment</span>
            <span className="crud-modal-title-main">{presetStudent ? `Assign ${presetStudent.name}` : 'Assign a student to a batch'}</span>
          </span>
        </span>
      }
    >
      <div className="crud-form-grid" style={{ gridTemplateColumns: '1fr' }}>
        {!presetStudent && (
          <div className="hub-form-row">
            <label>Student</label>
            <Select
              showSearch
              value={student ? student.email : undefined}
              placeholder="Search by name or email…"
              filterOption={false}
              notFoundContent={searching ? <Spin size="small" /> : 'Type at least 2 characters'}
              onSearch={onSearch}
              onChange={pickStudent}
              options={studentOptions}
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: 11.5, color: 'var(--hub-muted)' }}>
              Searches both the LMS student roster and User Management accounts.
            </span>
          </div>
        )}

        <div className="hub-form-row" style={{ marginTop: presetStudent ? 0 : 14 }}>
          <label>Batch</label>
          <Select
            showSearch
            optionFilterProp="label"
            loading={loadingBatches}
            value={batchId || undefined}
            placeholder="Select a batch…"
            onChange={setBatchId}
            options={batches.map((b) => ({ value: b._id, label: `${b.name}${b.course ? ' — ' + b.course : ''}` }))}
            notFoundContent={loadingBatches ? <Spin size="small" /> : 'No open batches'}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </Modal>
  );
}
