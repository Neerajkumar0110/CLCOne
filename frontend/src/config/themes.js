// =============================================================================
// THEME PALETTES — standalone colour definitions.
//
// This file only DEFINES the palettes. Nothing imports it yet and no styles
// consume it — it's a reference / future single-source-of-truth. To wire a
// palette later, map these tokens onto the --hub-* CSS variables (see
// frontend/src/style/partials/featureHub.css :root block) under a
// [data-palette="<key>"] selector, or feed them to an antd ConfigProvider.
//
// Token roles:
//   cardBg        – surface / card background
//   textPrimary   – headings, KPI values, main body text
//   textSecondary – labels, captions, muted text
//   accent        – primary buttons, active states, links, chart primary
//   border        – card borders, dividers, input outlines
// =============================================================================

export const THEMES = {
  blueLight: {
    key: 'blueLight',
    label: 'Blue Light',
    emoji: '🔵',
    mode: 'light',
    tokens: {
      cardBg: '#FFFFFF',
      textPrimary: '#0F172A',
      textSecondary: '#64748B',
      accent: '#3B82F6',
      border: '#E0E7FF',
    },
  },

  dark: {
    key: 'dark',
    label: 'Dark',
    emoji: '🌑',
    mode: 'dark',
    tokens: {
      cardBg: '#1E293B',
      textPrimary: '#F8FAFC',
      textSecondary: '#94A3B8',
      accent: '#8B5CF6',
      border: '#334155',
    },
  },

  greenFresh: {
    key: 'greenFresh',
    label: 'Green Fresh',
    emoji: '🟢',
    mode: 'light',
    tokens: {
      cardBg: '#F0FDF4',
      textPrimary: '#0F172A',
      textSecondary: '#475569',
      accent: '#22C55E',
      border: '#BBF7D0',
    },
  },

  purpleGradient: {
    key: 'purpleGradient',
    label: 'Purple Gradient',
    emoji: '🟣',
    mode: 'light',
    tokens: {
      cardBg: '#F3E8FF',
      textPrimary: '#1E1B4B',
      textSecondary: '#6B7280',
      accent: '#7C3AED',
      border: '#C4B5FD',
    },
  },

  orangeWarm: {
    key: 'orangeWarm',
    label: 'Orange Warm',
    emoji: '🟠',
    mode: 'light',
    tokens: {
      cardBg: '#FFF7ED',
      textPrimary: '#1F2937',
      textSecondary: '#6B7280',
      accent: '#F97316',
      border: '#FED7AA',
    },
  },
};

// Ordered list for pickers / previews.
export const THEME_LIST = [
  THEMES.blueLight,
  THEMES.dark,
  THEMES.greenFresh,
  THEMES.purpleGradient,
  THEMES.orangeWarm,
];

export const DEFAULT_THEME_KEY = 'blueLight';

// Helper: flat { '--theme-card-bg': '#FFFFFF', ... } for a given theme key —
// handy when wiring to CSS custom properties later.
export function themeCssVars(key) {
  const t = THEMES[key] || THEMES[DEFAULT_THEME_KEY];
  return {
    '--theme-card-bg': t.tokens.cardBg,
    '--theme-text-primary': t.tokens.textPrimary,
    '--theme-text-secondary': t.tokens.textSecondary,
    '--theme-accent': t.tokens.accent,
    '--theme-border': t.tokens.border,
  };
}

export default THEMES;
