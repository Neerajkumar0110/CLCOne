import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Skeleton, Empty, Tag, Space, Typography, Collapse, message } from 'antd';
import { ReadOutlined, ClockCircleOutlined, BookOutlined } from '@ant-design/icons';
import lmsApi from '../api';

const { Text, Paragraph } = Typography;

// Alternating unit-banner colours — the same navy/brown rhythm the source
// curriculum PDF uses to tell units apart at a glance.
const BANNERS = ['#16233F', '#8B4A25'];

// A module's description is seeded as "[Track · Weeks N–M · X sessions ·
// Y hr]\n<overview>..." (see backend/scripts/seedInternXCurriculum.cjs) —
// pull the bracketed metadata out for its own chip row instead of dumping
// it as a wall of text.
function splitMeta(description) {
  const m = /^\[(.+?)\]\n?([\s\S]*)$/.exec(description || '');
  if (!m) return { meta: null, rest: description || '' };
  return { meta: m[1], rest: m[2] };
}

function SessionCard({ chapter }) {
  const lesson = (chapter.lessons || [])[0];
  return (
    <div className="curriculum-session">
      <div className="curriculum-session-head">
        {chapter.sessionLabel && <span className="curriculum-session-badge">{chapter.sessionLabel}</span>}
        <span className="curriculum-session-title">{chapter.title}</span>
        {chapter.hours ? <Tag icon={<ClockCircleOutlined />} className="curriculum-session-hours">{chapter.hours} hr</Tag> : null}
      </div>
      {lesson && lesson.content && (
        <div className="curriculum-session-body" dangerouslySetInnerHTML={{ __html: lesson.content }} />
      )}
    </div>
  );
}

export default function CurriculumViewer({ open, onClose, courseId, courseTitle }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      const res = await lmsApi.courseOutline(courseId);
      setData((res && res.result) || null);
    } catch (e) {
      message.error('Could not load the curriculum.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const modules = (data && data.modules) || [];
  const counts = data && data.counts;

  return (
    <Modal
      className="crud-modal curriculum-viewer-modal"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={860}
      title={
        <span className="crud-modal-title">
          <span className="crud-modal-title-icon"><ReadOutlined /></span>
          <span>
            <span className="crud-modal-title-kicker">Full curriculum</span>
            <span className="crud-modal-title-main">{(data && data.course && data.course.title) || courseTitle}</span>
          </span>
        </span>
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : modules.length === 0 ? (
        <Empty description="No curriculum built for this course yet." />
      ) : (
        <>
          {counts && (
            <Space wrap style={{ marginBottom: 14 }}>
              <Tag icon={<BookOutlined />}>{counts.modules} units</Tag>
              <Tag>{counts.chapters} sessions</Tag>
            </Space>
          )}
          <Collapse
            className="curriculum-units"
            defaultActiveKey={[modules[0] && modules[0].id]}
            items={modules.map((m, i) => {
              const { meta, rest } = splitMeta(m.description);
              return {
                key: m.id,
                label: (
                  <div className="curriculum-unit-head" style={{ '--band': BANNERS[i % BANNERS.length] }}>
                    <span className="curriculum-unit-title">{m.title}</span>
                    {meta && <span className="curriculum-unit-meta">{meta}</span>}
                  </div>
                ),
                children: (
                  <>
                    {rest && <Paragraph type="secondary" style={{ marginBottom: 12 }}>{rest}</Paragraph>}
                    {(m.chapters || []).map((c) => <SessionCard key={c.id} chapter={c} />)}
                  </>
                ),
              };
            })}
          />
        </>
      )}
    </Modal>
  );
}
