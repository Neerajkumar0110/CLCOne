import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import storePersist from "@/redux/storePersist";

// App-wide light / dark mode. The chosen mode is:
//   • stamped on <html data-theme="…"> so featureHub.css token overrides
//     (:root[data-theme="dark"]) and any [data-theme] CSS take effect,
//   • fed to antd via ConfigProvider algorithm (dark/defaultAlgorithm),
//   • persisted to localStorage under "theme".
// Charts read the mode through useTheme() and re-theme via chartTheme.js.
const KEY = "theme";
const ThemeContext = createContext(null);

function readInitial() {
  const saved = storePersist.get(KEY);
  if (saved === "dark" || saved === "light") return saved;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(readInitial);

  // Keep <html data-theme> in sync before paint to avoid a flash.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
  }, [mode]);

  const setTheme = useCallback((next) => {
    const value = next === "dark" ? "dark" : "light";
    storePersist.set(KEY, value);
    setMode(value);
  }, []);

  const toggleTheme = useCallback(() => {
    setMode((m) => {
      const value = m === "dark" ? "light" : "dark";
      storePersist.set(KEY, value);
      return value;
    });
  }, []);

  const isDark = mode === "dark";

  const value = useMemo(
    () => ({ mode, isDark, setTheme, toggleTheme }),
    [mode, isDark, setTheme, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: { colorPrimary: "#0e7490", colorLink: "#1640D6", borderRadius: 6 },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Safe fallback so components used outside the provider (tests, storybook)
    // still render in light mode instead of throwing.
    return { mode: "light", isDark: false, setTheme: () => {}, toggleTheme: () => {} };
  }
  return ctx;
}
