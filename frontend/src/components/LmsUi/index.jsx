import React, { useEffect } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import OverflowTooltip from './OverflowTooltip';
import { renderEmpty } from './EmptyState';
import './lmsUi.css';

export { default as EmptyState } from './EmptyState';
export { default as Ellipsis } from './Ellipsis';
export { default as RowActions } from './RowActions';

// LMS design system (Teacher panel, Learner panel, Support/Admin LMS screens).
// LOOK ONLY — children render exactly as before; no data, route or handler is
// touched. Structural tokens only (radius, sizes, type, spacing): colours stay
// whatever the surrounding theme / palette / dark mode already gives, and the
// learner board theme nested inside still wins on colour.
const UI_TOKENS = {
  token: {
    borderRadius: 8,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    borderRadiusXS: 4,
    controlHeight: 36,
    controlHeightSM: 28,
    controlHeightLG: 42,
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    fontSizeHeading1: 28,
    fontSizeHeading2: 22,
    fontSizeHeading3: 18,
    fontSizeHeading4: 16,
    fontSizeHeading5: 14,
    lineHeight: 1.5,
    motionDurationMid: '0.18s',
    motionDurationSlow: '0.24s',
    boxShadowSecondary: '0 8px 24px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)',
  },
  components: {
    Button: { fontWeight: 600, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', paddingInline: 14 },
    Card: { borderRadiusLG: 12, paddingLG: 20 },
    Table: { cellPaddingBlock: 10, cellPaddingInline: 12, cellPaddingBlockSM: 6, cellPaddingInlineSM: 8, cellFontSize: 13, headerBorderRadius: 12 },
    Modal: { borderRadiusLG: 16, titleFontSize: 17 },
    Drawer: { paddingLG: 20 },
    Tag: { borderRadiusSM: 6 },
    Tooltip: { borderRadius: 8, paddingSM: 10, paddingXS: 6 },
    Select: { optionPadding: '7px 12px', borderRadiusLG: 10 },
    Dropdown: { borderRadiusLG: 10, paddingBlock: 7 },
    Pagination: { itemSize: 32, itemSizeSM: 26 },
    Collapse: { borderRadiusLG: 12, headerPadding: '12px 16px', contentPadding: '12px 16px' },
    Tabs: { horizontalItemPadding: '10px 2px', titleFontSize: 14 },
    Alert: { borderRadiusLG: 10 },
    Segmented: { borderRadius: 8, borderRadiusSM: 6 },
    Input: { paddingInline: 12 },
    InputNumber: { paddingInline: 12 },
    DatePicker: { paddingInline: 12 },
    Statistic: { titleFontSize: 13, contentFontSize: 24 },
  },
};

// The surrounding theme's colours as CSS variables, so lmsUi.css follows the
// palette and dark mode instead of hard-coding light-mode greys.
function TokenVars({ children }) {
  const { token } = antdTheme.useToken();
  const vars = {
    '--lu-primary': token.colorPrimary,
    '--lu-primary-soft': token.colorPrimaryBg,
    '--lu-text': token.colorText,
    '--lu-muted': token.colorTextSecondary,
    '--lu-faint': token.colorTextTertiary,
    '--lu-border': token.colorBorderSecondary,
    '--lu-border-strong': token.colorBorder,
    '--lu-surface': token.colorBgContainer,
    '--lu-hover': token.controlItemBgHover,
    '--lu-fill': token.colorFillQuaternary,
  };
  useEffect(() => {
    // portaled popups (modals, dropdowns, drawers) live under <body>
    const b = document.body;
    b.dataset.luOn = String(Number(b.dataset.luOn || 0) + 1);
    b.classList.add('lu-on');
    Object.entries(vars).forEach(([k, v]) => b.style.setProperty(k, v));
    return () => {
      const n = Number(b.dataset.luOn || 1) - 1;
      b.dataset.luOn = String(n);
      if (n <= 0) b.classList.remove('lu-on');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, Object.values(vars));
  return (
    <div className="lu" style={vars}>
      {children}
    </div>
  );
}

export default function LmsUi({ children }) {
  return (
    <ConfigProvider theme={UI_TOKENS} renderEmpty={renderEmpty}>
      <OverflowTooltip />
      <TokenVars>{children}</TokenVars>
    </ConfigProvider>
  );
}
