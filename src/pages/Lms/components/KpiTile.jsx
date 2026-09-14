import React from 'react';
import { Col, Statistic } from 'antd';

export default function KpiTile({ title, value, suffix, icon, tone = 'blue', span, index = 0, style }) {
  return (
    <Col
      xs={span?.xs ?? 12}
      sm={span?.sm ?? 8}
      lg={span?.lg ?? 6}
      xxl={span?.xxl ?? 4}
      className="lms-kpi-col"
      style={{ display: 'flex', ...style }}
    >
      <div
        className={`lms-kpi-tile tone-${tone}`}
        style={{ '--tile-index': index }}
      >
        {icon && <div className="lms-kpi-icon">{icon}</div>}
        <div className="lms-kpi-content">
          <Statistic title={title} value={value || 0} suffix={suffix} />
        </div>
      </div>
    </Col>
  );
}
