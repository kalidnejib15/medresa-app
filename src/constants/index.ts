// App-wide design tokens — colors, fonts, spacing
export const COLORS = {
  // Primary brand — deep Islamic green
  primary: '#1a6b3c',
  primaryDark: '#0f4526',
  primaryLight: '#2d9058',
  primaryFaded: '#e8f5ee',

  // Secondary gold accent
  accent: '#c9a84c',
  accentLight: '#f5e9c0',

  // Attendance status
  present: '#22c55e',
  absent: '#ef4444',
  late: '#f59e0b',
  excused: '#6366f1',

  // Neutrals
  background: '#f8f9fa',
  surface: '#ffffff',
  surfaceVariant: '#f1f5f2',
  border: '#e2e8e4',

  // Text
  textPrimary: '#1a1a1a',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  textOnPrimary: '#ffffff',

  // Fee status
  paid: '#22c55e',
  partial: '#f59e0b',
  unpaid: '#ef4444',
  exempted: '#6366f1',

  // Error
  error: '#dc2626',
  errorLight: '#fef2f2',
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
  sizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    xxxl: 30,
  },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const RADIUS = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const SHADOW = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
};

// Supabase
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// App
export const APP_NAME = 'አቡበከር መድረሳ';
export const APP_NAME_EN = 'Abubeker Medersa';
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
