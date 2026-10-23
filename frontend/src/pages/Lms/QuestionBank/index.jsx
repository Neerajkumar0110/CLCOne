import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Select, Input, Button, Upload, Tabs, Tag, Tooltip, Space, message, Typography, Empty, Popconfirm } from 'antd';
import {
  DatabaseOutlined,
  InboxOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  StopOutlined,
  UndoOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import { request } from '@/request';
import { PageHeading, StatusPill, tablePagination } from '../components/ui';
import './questionBank.css';

// LMS → Question Bank (backend assessments/questionBank.js). Upload a JSON
// array of questions, pick the test, preview with validation + duplicate
// detection, optionally run the OUTPUT_BASED code to check the answer key,
// tick what to keep, import. Second tab: every question of a test with
// retire / restore. Admin, Support and Teachers.

const { Text } = Typography;
const QT_LABEL = { MCQ: 'MCQ', OUTPUT_BASED: 'Output', PROGRAMMING: 'Programming' };
const QT_COLOR = { MCQ: 'blue', OUTPUT_BASED: 'purple', PROGRAMMING: 'gold' };

const SAMPLE = [
  {
    topic: 'LLM API Fundamentals',
    text: 'Which message role sets the model’s overall behaviour?',
    questionType: 'MCQ',
    options: ['system', 'user', 'assistant', 'tool'],
    correctOption: 0,
    difficulty: 'hard',
  },
  {
    topic: 'Advanced Prompt Engineering',
    text: 'What does this print?\n\nprint("a-b".split("-")[1])',
    questionType: 'OUTPUT_BASED',
    options: ['a', 'b', "['a', 'b']", 'IndexError'],
    correctOption: 1,
    difficulty: 'hard',
  },
  {
    topic: 'LLM API Fundamentals',
    text: 'Print the word Hello.',
    questionType: 'PROGRAMMING',
    starterCode: '# your code here\n',
    expectedOutput: 'Hello',
    difficulty: 'hard',
  },
];

function downloadSample() {
  const blob = new Blob([JSON.stringify(SAMPLE, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'question-bank-sample.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// The question, its options with the right one marked, or the expected output.
function QuestionDetail({ q }) {
  return (
    <div className="qb-detail">
      <pre className="qb-text">{q.text}</pre>
      {q.questionType !== 'PROGRAMMING' && (
        <ol className="qb-options">
          {(q.options || []).map((o, i) => (
            <li key={i} className={i === q.correctOption ? 'is-correct' : ''}>
              <span className="qb-opt-letter">{String.fromCharCode(65 + i)}</span>
              <pre>{o}</pre>
              {i === q.correctOption && <CheckCircleOutlined />}
            </li>
          ))}
        </ol>
      )}
      {q.questionType === 'PROGRAMMING' && (
        <div className="qb-code-pair">
          {q.starterCode ? (
            <div>
              <Text type="secondary">Starter code</Text>
              <pre className="qb-code">{q.starterCode}</pre>
            </div>
          ) : null}
          <div>
            <Text type="secondary">Expected output</Text>
            <pre className="qb-code is-output">{q.expectedOutput}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function PoolBar({ pool, adding = {}, perAttempt, fixedSet }) {
  if (!pool) return null;
  return (
    <div className="qb-pool">
      {['MCQ', 'OUTPUT_BASED', 'PROGRAMMING'].map((t) => {
        const active = pool[t]?.active || 0;
        const add = adding[t] || 0;
        const need = perAttempt ? perAttempt[t] || 0 : 0;
        const short = need && active + add < need;
        return (
          <div key={t} className={`qb-pool-item ${short ? 'is-short' : ''}`}>
            <Tag color={QT_COLOR[t]}>{QT_LABEL[t]}</Tag>
            <b>{active}</b>
            {add > 0 && <span className="qb-pool-add">+{add}</span>}
            {need > 0 && <span className="qb-pool-need">· {need} per attempt</span>}
            {short && (
              <Tooltip title="Fewer active questions than one attempt needs — the test won't start until there are enough.">
                <WarningOutlined />
              </Tooltip>
            )}
          </div>
        );
      })}
      {fixedSet && <span className="qb-pool-note">Micro test — every active question is served, in partOrder.</span>}
    </div>
  );
}

function UploadTab({ tests, testType, setTestType, onImported }) {
  const [fileName, setFileName] = useState('');
  const [raw, setRaw] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [checks, setChecks] = useState({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState('all');

  const test = tests.find((t) => t.key === testType);

  const runPreview = async (questions, tt) => {
    if (!tt || !questions) return;
    setBusy(true);
    const r = await request.post({ entity: 'lms/assessments/bank/preview', jsonData: { testType: tt, questions } });
    setBusy(false);
    if (r?.success) {
      setPreview(r.result);
      setSelected(r.result.rows.filter((x) => x.importable).map((x) => x.index));
      setChecks({});
    } else setPreview(null);
  };
  useEffect(() => {
    if (raw) runPreview(raw, testType);
  }, [testType]); // eslint-disable-line react-hooks/exhaustive-deps

  const readFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let data = JSON.parse(String(reader.result || ''));
        if (!Array.isArray(data) && Array.isArray(data?.questions)) data = data.questions;
        if (!Array.isArray(data)) throw new Error('not an array');
        setFileName(file.name);
        setRaw(data);
        if (!testType) {
          // a file that names its test pre-selects it
          const t = data.find((q) => q && q.type)?.type;
          if (t && tests.some((x) => x.key === t)) setTestType(t);
          else message.info('Now pick which test these questions are for.');
        }
        runPreview(data, testType || data.find((q) => q && q.type && tests.some((x) => x.key === q.type))?.type);
      } catch (e) {
        message.error('That file is not valid JSON — it must be an array of questions (download the sample to see the format).');
      }
    };
    reader.readAsText(file);
    return false; // never auto-upload
  };

  const rows = preview?.rows || [];
  const shown = rows.filter((r) =>
    filter === 'all' ? true : filter === 'ready' ? r.importable : filter === 'errors' ? r.errors.length : filter === 'dupes' ? !!r.duplicate : filter === 'mismatch' ? checks[r.index]?.status === 'mismatch' : true
  );
  const adding = useMemo(() => {
    const m = {};
    for (const r of rows) if (selected.includes(r.index)) m[r.questionType] = (m[r.questionType] || 0) + 1;
    return m;
  }, [rows, selected]);
  const outputSelected = rows.filter((r) => selected.includes(r.index) && r.questionType === 'OUTPUT_BASED');
  const mismatches = Object.values(checks).filter((c) => c.status === 'mismatch').length;

  const checkAnswers = async () => {
    if (!outputSelected.length) return;
    setChecking(true);
    const next = { ...checks };
    for (let i = 0; i < outputSelected.length; i += 20) {
      const batch = outputSelected.slice(i, i + 20).map((r) => ({ ...raw[r.index], index: r.index }));
      // eslint-disable-next-line no-await-in-loop
      const r = await request.post({ entity: 'lms/assessments/bank/check', jsonData: { questions: batch } });
      if (r?.success) for (const c of r.result) next[c.index] = c;
      setChecks({ ...next });
    }
    setChecking(false);
    const bad = Object.values(next).filter((c) => c.status === 'mismatch').length;
    if (bad) message.warning(`${bad} answer${bad === 1 ? '' : 's'} didn't match when the code was run — see the red rows.`);
    else message.success('Every output-based answer matched the real output.');
  };

  const doImport = async () => {
    const qs = rows.filter((r) => selected.includes(r.index)).map((r) => raw[r.index]);
    if (!qs.length) return;
    setBusy(true);
    const r = await request.post({ entity: 'lms/assessments/bank/import', jsonData: { testType, questions: qs } });
    setBusy(false);
    if (r?.success) {
      message.success(r.message, 6);
      setRaw(null);
      setPreview(null);
      setFileName('');
      setSelected([]);
      setChecks({});
      onImported();
    }
  };

  const statusCell = (r) => {
    const c = checks[r.index];
    return (
      <Space direction="vertical" size={4}>
        {r.errors.length ? (
          <Tooltip title={r.errors.join(' ')}>
            <StatusPill tone="danger">
              <CloseCircleOutlined /> {r.errors[0]}
            </StatusPill>
          </Tooltip>
        ) : r.duplicate ? (
          <StatusPill tone="warning">{r.duplicate}</StatusPill>
        ) : (
          <StatusPill tone="success">
            <CheckCircleOutlined /> Ready
          </StatusPill>
        )}
        {c && c.status === 'ok' && <StatusPill tone="info">Answer verified</StatusPill>}
        {c && c.status === 'mismatch' && (
          <Tooltip title={`Running the code printed "${c.got}" but the key says "${c.expected}".`}>
            <StatusPill tone="danger">Answer ≠ output</StatusPill>
          </Tooltip>
        )}
        {c && c.status === 'error' && (
          <Tooltip title={c.error}>
            <StatusPill tone="warning">Couldn't run</StatusPill>
          </Tooltip>
        )}
        {r.warnings.length > 0 && (
          <Tooltip title={r.warnings.join(' ')}>
            <Text type="warning" style={{ fontSize: 12 }}>
              <WarningOutlined /> {r.warnings.length} note{r.warnings.length > 1 ? 's' : ''}
            </Text>
          </Tooltip>
        )}
      </Space>
    );
  };

  return (
    <div className="qb-upload">
      <Card size="small" className="qb-step">
        <div className="qb-step-head">
          <span className="qb-step-no">1</span>
          <div>
            <b>Pick the test</b>
            <span>The questions go into this test's pool.</span>
          </div>
        </div>
        <Select
          className="qb-test-select"
          placeholder="Choose a test…"
          value={testType || undefined}
          onChange={setTestType}
          options={tests.map((t) => ({ value: t.key, label: `${t.label} · ${t.total} questions` }))}
        />
        {test && <PoolBar pool={test.pool} perAttempt={test.perAttempt} fixedSet={test.fixedSet} />}
      </Card>

      <Card size="small" className="qb-step">
        <div className="qb-step-head">
          <span className="qb-step-no">2</span>
          <div>
            <b>Upload the JSON file</b>
            <span>An array of questions — MCQ, OUTPUT_BASED or PROGRAMMING.</span>
          </div>
          <Button size="small" icon={<DownloadOutlined />} onClick={downloadSample} style={{ marginLeft: 'auto' }}>
            Sample JSON
          </Button>
        </div>
        <Upload.Dragger accept=".json,application/json" multiple={false} showUploadList={false} beforeUpload={readFile}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{fileName ? `${fileName} — drop another file to replace` : 'Drop a .json file here, or click to choose'}</p>
          <p className="ant-upload-hint">Each item: topic, text, questionType, options + correctOption (0-based) or expectedOutput, difficulty.</p>
        </Upload.Dragger>
      </Card>

      {preview && (
        <Card size="small" className="qb-step">
          <div className="qb-step-head">
            <span className="qb-step-no">3</span>
            <div>
              <b>Check and select</b>
              <span>Untick anything you don't want. Rows with errors or duplicates can't be imported.</span>
            </div>
          </div>
          <div className="qb-summary">
            {[
              ['all', 'In file', preview.summary.total, ''],
              ['ready', 'Ready', preview.summary.importable, 'is-green'],
              ['errors', 'Errors', preview.summary.errors, 'is-red'],
              ['dupes', 'Duplicates', preview.summary.duplicates, 'is-amber'],
              ...(Object.keys(checks).length ? [['mismatch', 'Answer ≠ output', mismatches, 'is-red']] : []),
            ].map(([k, l, v, cls]) => (
              <button key={k} type="button" className={`qb-chip ${cls} ${filter === k ? 'is-on' : ''}`} onClick={() => setFilter(k)}>
                {l} <b>{v}</b>
              </button>
            ))}
          </div>
          <PoolBar pool={preview.pool} adding={adding} perAttempt={test?.perAttempt} fixedSet={test?.fixedSet} />
          <Table
            rowKey="index"
            size="small"
            loading={busy}
            dataSource={shown}
            pagination={tablePagination({ defaultPageSize: 25 })}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys),
              getCheckboxProps: (r) => ({ disabled: !r.importable }),
            }}
            expandable={{ expandedRowRender: (r) => <QuestionDetail q={r} /> }}
            rowClassName={(r) => (checks[r.index]?.status === 'mismatch' ? 'qb-row-bad' : '')}
            columns={[
              { title: '#', dataIndex: 'index', width: 56, render: (v) => v + 1 },
              { title: 'Type', dataIndex: 'questionType', width: 110, render: (v) => <Tag color={QT_COLOR[v]}>{QT_LABEL[v] || v || '?'}</Tag> },
              { title: 'Topic', dataIndex: 'topic', width: 200, ellipsis: true },
              { title: 'Question', dataIndex: 'text', ellipsis: true, render: (v) => String(v || '').split('\n')[0] },
              { title: 'Status', key: 'status', width: 210, render: (_, r) => statusCell(r) },
            ]}
          />
          <div className="qb-actions">
            <Button icon={<ThunderboltOutlined />} loading={checking} disabled={!outputSelected.length} onClick={checkAnswers}>
              Check answers by running the code ({outputSelected.length})
            </Button>
            <span style={{ flex: 1 }} />
            <Text type="secondary">
              {selected.length} selected → <b>{test?.label || 'pick a test'}</b>
            </Text>
            {mismatches > 0 ? (
              <Popconfirm
                title={`${mismatches} answer key${mismatches === 1 ? '' : 's'} didn't match the real output. Import anyway?`}
                okText="Import anyway"
                onConfirm={doImport}
              >
                <Button type="primary" icon={<CloudUploadOutlined />} loading={busy} disabled={!selected.length || !testType}>
                  Import {selected.length}
                </Button>
              </Popconfirm>
            ) : (
              <Button type="primary" icon={<CloudUploadOutlined />} loading={busy} disabled={!selected.length || !testType} onClick={doImport}>
                Import {selected.length} question{selected.length === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function BankTab({ tests, testType, setTestType, refreshKey, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [qt, setQt] = useState('');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const test = tests.find((t) => t.key === testType);

  const load = async () => {
    if (!testType) return;
    setLoading(true);
    const p = new URLSearchParams({ testType, status, ...(qt ? { questionType: qt } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
    const r = await request.get({ entity: `lms/assessments/bank/questions?${p}` });
    setLoading(false);
    setRows(r?.success ? r.result : []);
  };
  useEffect(() => {
    load();
  }, [testType, qt, status, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (row) => {
    setBusyId(row.id);
    const r = await request.patch({ entity: `lms/assessments/bank/questions/${row.id}`, jsonData: { retired: !row.retired } });
    setBusyId(null);
    if (r?.success) {
      load();
      onChanged();
    }
  };

  return (
    <div>
      <div className="qb-filters">
        <Select
          className="qb-test-select"
          placeholder="Choose a test…"
          value={testType || undefined}
          onChange={setTestType}
          options={tests.map((t) => ({ value: t.key, label: `${t.label} · ${t.total}` }))}
        />
        <Select
          value={qt}
          onChange={setQt}
          style={{ width: 150 }}
          options={[{ value: '', label: 'All types' }, ...Object.keys(QT_LABEL).map((k) => ({ value: k, label: QT_LABEL[k] }))]}
        />
        <Select
          value={status}
          onChange={setStatus}
          style={{ width: 130 }}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'retired', label: 'Retired' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Input.Search placeholder="Search question or topic" allowClear value={q} onChange={(e) => setQ(e.target.value)} onSearch={load} style={{ maxWidth: 280 }} />
        <Button icon={<ReloadOutlined />} onClick={load} />
      </div>
      {test && <PoolBar pool={test.pool} perAttempt={test.perAttempt} fixedSet={test.fixedSet} />}
      {!testType ? (
        <Empty description="Pick a test to see its questions." />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          pagination={tablePagination({ defaultPageSize: 25 })}
          expandable={{ expandedRowRender: (r) => <QuestionDetail q={r} /> }}
          columns={[
            { title: 'Type', dataIndex: 'questionType', width: 110, render: (v) => <Tag color={QT_COLOR[v]}>{QT_LABEL[v]}</Tag> },
            { title: 'Topic', dataIndex: 'topic', width: 220, ellipsis: true },
            { title: 'Question', dataIndex: 'text', ellipsis: true, render: (v) => String(v || '').split('\n')[0] },
            {
              title: 'Added',
              dataIndex: 'createdAt',
              width: 110,
              render: (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'),
            },
            {
              title: '',
              key: 'act',
              width: 120,
              render: (_, r) =>
                test?.fixedSet ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    fixed set
                  </Text>
                ) : r.retired ? (
                  <Button size="small" icon={<UndoOutlined />} loading={busyId === r.id} onClick={() => toggle(r)}>
                    Restore
                  </Button>
                ) : (
                  <Popconfirm title="Retire this question? New attempts won't get it." okText="Retire" onConfirm={() => toggle(r)}>
                    <Button size="small" danger icon={<StopOutlined />} loading={busyId === r.id}>
                      Retire
                    </Button>
                  </Popconfirm>
                ),
            },
          ]}
        />
      )}
    </div>
  );
}

export default function QuestionBank() {
  const [tests, setTests] = useState([]);
  const [testType, setTestType] = useState(null);
  const [tab, setTab] = useState('upload');
  const [refreshKey, setRefreshKey] = useState(0);

  const loadTests = async () => {
    const r = await request.get({ entity: 'lms/assessments/bank/tests' });
    if (r?.success) setTests(r.result);
  };
  useEffect(() => {
    loadTests();
  }, []);
  const changed = () => {
    loadTests();
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="lms-portal qb-page" style={{ padding: 4 }}>
      <PageHeading
        icon={<DatabaseOutlined />}
        title="Question Bank"
        description="Upload test questions as JSON, choose the test they go into, check them and import — or review and retire existing ones."
      />

      <div className="qb-tests">
        {tests.map((t) => {
          const short = t.perAttempt && ['MCQ', 'OUTPUT_BASED', 'PROGRAMMING'].some((k) => (t.pool[k]?.active || 0) < (t.perAttempt[k] || 0));
          return (
            <button key={t.key} type="button" className={`qb-test-card ${testType === t.key ? 'is-on' : ''}`} onClick={() => setTestType(t.key)}>
              <span className="qb-test-label">{t.label}</span>
              <span className="qb-test-total">
                <b>{t.total}</b> active
                {short && (
                  <Tooltip title="Not enough questions for one attempt">
                    <WarningOutlined className="qb-warn" />
                  </Tooltip>
                )}
              </span>
              <span className="qb-test-mix">
                {['MCQ', 'OUTPUT_BASED', 'PROGRAMMING'].map((k) => `${t.pool[k]?.active || 0} ${QT_LABEL[k]}`).join(' · ')}
              </span>
            </button>
          );
        })}
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'upload', label: 'Upload JSON', children: <UploadTab tests={tests} testType={testType} setTestType={setTestType} onImported={changed} /> },
          { key: 'bank', label: 'Questions in a test', children: <BankTab tests={tests} testType={testType} setTestType={setTestType} refreshKey={refreshKey} onChanged={changed} /> },
        ]}
      />
    </div>
  );
}
