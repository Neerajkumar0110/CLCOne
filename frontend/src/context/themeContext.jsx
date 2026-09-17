import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import storePersist from "@/redux/storePersist";
import { THEMES, THEME_LIST, DEFAULT_THEME_KEY } from "@/config/themes";

// App-wide theming. The chosen palette is:
//   • stamped on <html data-palette="…"> (+ data-theme="light|dark" for the
//     palette's mode) so featureHub.css / themePalettes.css token overrides
//     take effect,
//   • fed to antd via ConfigProvider (algorithm + colour tokens) so every
//     antd surface, text and placeholder follows,
//   • persisted to localStorage.
// Charts read isDark through useTheme() and re-theme via chartTheme.js.
const MODE_KEY = "theme";
const PAL_KEY = "palette";
const ThemeContext = createContext(null);

function readMode() {
  const saved = storePersist.get(MODE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  // Default the app to light mode unless the user explicitly chooses dark.
  return "light";
}
function readPalette() {
  const saved = storePersist.get(PAL_KEY);
  if (saved && THEMES[saved]) return saved;
  // fall back from the legacy light/dark mode flag
  return readMode() === "dark" ? "dark" : DEFAULT_THEME_KEY;
}

export function ThemeProvider({ children }) {
  const [paletteKey, setPaletteKey] = useState(readPalette);
  const theme = THEMES[paletteKey] || THEMES[DEFAULT_THEME_KEY];
  const mode = theme.mode; // 'light' | 'dark'
  const isDark = mode === "dark";

  // Keep <html> attributes in sync before paint to avoid a flash.
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", mode);
    el.setAttribute("data-palette", paletteKey);
  }, [mode, paletteKey]);

  const setPalette = useCallback((key) => {
    if (!THEMES[key]) return;
    storePersist.set(PAL_KEY, key);
    storePersist.set(MODE_KEY, THEMES[key].mode);
    setPaletteKey(key);
  }, []);

  // Sun/moon quick toggle — flips between the current palette's light form and
  // the Dark palette.
  const toggleTheme = useCallback(() => {
    setPaletteKey((cur) => {
      const next = THEMES[cur]?.mode === "dark" ? DEFAULT_THEME_KEY : "dark";
      storePersist.set(PAL_KEY, next);
      storePersist.set(MODE_KEY, THEMES[next].mode);
      return next;
    });
  }, []);

  const setTheme = useCallback(
    (next) => setPalette(next === "dark" ? "dark" : DEFAULT_THEME_KEY),
    [setPalette]
  );

  const t = theme.tokens;
  const value = useMemo(
    () => ({ mode, isDark, palette: paletteKey, theme, palettes: THEME_LIST, setPalette, setTheme, toggleTheme }),
    [mode, isDark, paletteKey, theme, setPalette, setTheme, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: t.accent,
            colorLink: t.accent,
            colorText: t.textPrimary,
            colorTextSecondary: t.textSecondary,
            colorTextTertiary: t.textSecondary,
            colorTextPlaceholder: t.textSecondary,
            colorBorder: t.border,
            colorBorderSecondary: t.border,
            colorBgContainer: t.cardBg,
            colorBgElevated: t.cardBg,
            colorBgLayout: t.cardBg,
            borderRadius: 6,
          },
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
    return {
      mode: "light",
      isDark: false,
      palette: DEFAULT_THEME_KEY,
      theme: THEMES[DEFAULT_THEME_KEY],
      palettes: THEME_LIST,
      setPalette: () => {},
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}
