import { Platform } from 'react-native';

export const colors = {
  bg: '#070B14',
  surface: '#0E1526',
  card: '#151D32',
  cardAlt: '#1B2540',
  border: '#232E4A',
  text: '#F4F6FB',
  muted: '#8B95B0',
  faint: '#5A6485',
  primary: '#7C5CFF',
  primarySoft: 'rgba(124,92,255,0.16)',
  cyan: '#22D3EE',
  success: '#34D399',
  warn: '#FBBF24',
  danger: '#F87171',
  overlay: 'rgba(4,7,13,0.72)',
};

export const gradient = {
  primary: ['#7C5CFF', '#4F8BFF', '#22D3EE'] as const,
  success: ['#10B981', '#34D399'] as const,
  danger: ['#EF4444', '#F87171'] as const,
  card: ['#1B2540', '#131B30'] as const,
};

export const radius = { sm: 10, md: 16, lg: 22, xl: 30 };

export const shadow = Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: -8 } },
  default: { elevation: 12 },
})!;

export const font = {
  h1: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.6, color: colors.text },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3, color: colors.text },
  h3: { fontSize: 17, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.muted },
  tiny: { fontSize: 11, color: colors.muted, letterSpacing: 0.4 },
};
