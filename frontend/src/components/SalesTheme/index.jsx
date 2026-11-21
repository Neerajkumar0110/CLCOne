import React, { useEffect } from "react";
import { ConfigProvider } from "antd";
import { useTheme } from "@/context/themeContext";
import "./salesUi.css";

// The "Sales One Place" design look for every Sales screen (design canvas
// 2qmjBmHf4MxsejNwSyxJiM). Look only — children render exactly as before.
// While mounted (light mode) it stamps body.sales-ui-on so the scoped CSS in
// salesUi.css reaches portaled popups too, and gives antd the design tokens.
// Dark mode keeps the app's own dark look.
const SALES_TOKENS = {
  token: {
    colorPrimary: "#0F766E",
    colorLink: "#0F766E",
    colorText: "#0F1E2B",
    colorTextSecondary: "#5B6B79",
    colorBorder: "#CFD8E1",
    colorBorderSecondary: "#E2E8F0",
    colorSuccess: "#0B7A55",
    colorError: "#B42318",
    colorWarning: "#B54708",
    borderRadius: 10,
    controlHeight: 40,
    fontFamily: "Inter, system-ui, sans-serif",
  },
  components: {
    Table: { headerBg: "#F8FAFC", headerColor: "#475467", rowHoverBg: "#F8FBFB", borderColor: "#EEF2F6" },
    Tabs: { itemSelectedColor: "#0F1E2B", inkBarColor: "#0F766E", itemColor: "#5B6B79" },
    Modal: { borderRadiusLG: 16 },
  },
};

export default function SalesTheme({ children }) {
  // The Sales design look is the DEFAULT palette's look. Dark mode and the other colour palettes
  // (green / purple / orange) keep the app's own palette — the Sales v3 screens follow them through
  // pages/SalesV3/sv3-theme.css. Before, only dark skipped it, so a chosen palette never reached Sales.
  let isDark = false;
  try {
    const t = useTheme();
    isDark = !!t?.isDark || (t?.palette && t.palette !== "blueLight");
  } catch (e) {
    isDark = false;
  }
  useEffect(() => {
    if (isDark) return undefined;
    // Counted so two Sales screens mounted together don't clear each other.
    const b = document.body;
    b.dataset.salesUi = String(Number(b.dataset.salesUi || 0) + 1);
    b.classList.add("sales-ui-on");
    return () => {
      const n = Number(b.dataset.salesUi || 1) - 1;
      b.dataset.salesUi = String(n);
      if (n <= 0) b.classList.remove("sales-ui-on");
    };
  }, [isDark]);
  if (isDark) return children;
  return <ConfigProvider theme={SALES_TOKENS}>{children}</ConfigProvider>;
}
