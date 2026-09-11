import React from 'react';
import { Col, Statistic } from 'antd';

export default function KpiTile({ title, value, suffix, icon, tone = 'blue', span }) {
  return (
    <Col xs={span?.xs ?? 12} sm={span?.sm ?? 8} lg={span?.lg ?? 6} xxl={span?.xxl ?? 4}>
      <div className={`lms-kpi-tile tone-${tone}`}>
        {icon && <div className="lms-kpi-icon">{icon}</div>}
        <Statistic title={title} value={value || 0} suffix={suffix} />
      </div>
    </Col>
  );
}
