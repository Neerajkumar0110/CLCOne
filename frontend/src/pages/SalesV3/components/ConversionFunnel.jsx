import React from "react";
import "./ConversionFunnel.css";

// Conversion funnel card (design supplied 2026-11-20). Data: workday/admin/360 →
// totals.sales (connected, interested, demoBooked, prospects, enrolled) — the
// Dashboard passes it in. The date button shows the Dashboard's range and
// takes you to its filters.
const ConversionFunnel = ({
  data = {
    connected: 0,
    interested: 0,
    demoBooked: 0,
    prospects: 0,
    enrolled: 0,
  },
  dateRange = "Last 30 Days",
  onDateClick,
  compact = false,
}) => {
  const stages = [
    {
      key: "connected",
      label: "Connected",
      icon: "👥",
      color: "#20b9ed",
    },
    {
      key: "interested",
      label: "Interested",
      icon: "📞",
      color: "#8b5cf6",
    },
    {
      key: "demoBooked",
      label: "Demo booked",
      icon: "📅",
      color: "#22c55e",
    },
    {
      key: "prospects",
      label: "Prospects",
      icon: "📈",
      color: "#f59e0b",
    },
    {
      key: "enrolled",
      label: "Enrolled",
      icon: "✓",
      color: "#ec4899",
    },
  ];

  const connected = Number(data.connected || 0);

  const getPercentage = (value) => {
    if (!connected || !value) return 0;

    return Math.round((Number(value) / connected) * 100);
  };

  const totalLeads = stages.reduce(
    (total, stage) => total + Number(data[stage.key] || 0),
    0
  );

  return (
    <div className={compact ? "conversion-funnel-card compact" : "conversion-funnel-card"}>

      {/* Header */}
      <div className="funnel-header">
        <div className="funnel-title-section">

          <div className="funnel-main-icon">
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
            </svg>
          </div>

          <div>
            <h2>Conversion Funnel</h2>

            <p>
              Leads moved into each step in the range · % of the first step
              and drop-off
            </p>
          </div>
        </div>

        {/* Date Filter */}
        <button className="date-filter" type="button" onClick={onDateClick}>
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>

          <span>{dateRange}</span>

          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="funnel-content">

        {/* LEFT SIDE */}
        <div className="funnel-visual-section">

          {/* Funnel */}
          <div className="funnel-wrapper">

            <div className="floating-user user-1">👤</div>
            <div className="floating-user user-2">👤</div>
            <div className="floating-user user-3">👤</div>

            <div className="funnel-shape">

              <div className="funnel-layer layer-1"></div>
              <div className="funnel-layer layer-2"></div>
              <div className="funnel-layer layer-3"></div>
              <div className="funnel-layer layer-4"></div>
              <div className="funnel-layer layer-5"></div>

            </div>

            <div className="funnel-shadow"></div>
          </div>

          {/* Total Leads */}
          <div className="total-leads-card">

            <div className="total-leads-icon">
              <svg
                width="27"
                height="27"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="6" y1="20" x2="6" y2="14" />
                <line x1="12" y1="20" x2="12" y2="8" />
                <line x1="18" y1="20" x2="18" y2="4" />
              </svg>
            </div>

            <div>
              <span>Total Leads</span>
              <strong>{totalLeads}</strong>
            </div>

          </div>
        </div>

        {/* RIGHT SIDE */}
        <div className="funnel-stages">

          {stages.map((stage) => {
            const value = Number(data[stage.key] || 0);
            const percentage = getPercentage(value);

            return (
              <div className="funnel-stage" key={stage.key}>

                {/* Icon */}
                <div
                  className="stage-icon"
                  style={{
                    "--stage-color": stage.color,
                  }}
                >
                  {stage.icon}
                </div>

                {/* Name */}
                <div className="stage-name">
                  {stage.label}
                </div>

                {/* Count */}
                <div className="stage-count">
                  {value}
                </div>

                {/* Progress */}
                <div className="stage-progress">
                  <div
                    className="stage-progress-fill"
                    style={{
                      width: `${Math.min(100, percentage)}%`,
                      background: stage.color,
                    }}
                  />
                </div>

                {/* Percentage */}
                <div
                  className="stage-percentage"
                  style={{
                    color: stage.color,
                  }}
                >
                  {percentage}% of connected
                </div>

              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
};

export default ConversionFunnel;
