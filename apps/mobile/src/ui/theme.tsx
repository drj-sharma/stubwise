import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

/**
 * "Style 1" from the approved designs, in the app icon's colours: white cards
 * on a neutral grey ground with a sky-blue wash, thin borders, a pink accent
 * (deepened from the icon's pink so white text on it stays readable), coloured
 * status pills.
 * Every colour used by a screen comes from here, so the dark theme is a
 * second palette and nothing else.
 */
export interface Palette {
  scheme: 'light' | 'dark';
  bg: string;
  /** Top of the background wash behind the header. */
  bgTint: string;
  sheet: string;
  border: string;
  inner: string;
  innerStrong: string;
  segment: string;
  segmentOn: string;
  fieldBorder: string;
  text: string;
  muted: string;
  faint: string;
  primary: string;
  onPrimary: string;
  onPrimaryMuted: string;
  primarySoft: string;
  primaryText: string;
  successBg: string;
  successText: string;
  successDot: string;
  warnBg: string;
  warnText: string;
  warnDot: string;
  danger: string;
  mark: string;
  onMark: string;
}

export const light: Palette = {
  scheme: 'light',
  bg: '#F3F4F6',
  bgTint: '#DCF1FA',
  sheet: '#FFFFFF',
  border: '#ECEDF1',
  inner: '#FAFAFB',
  innerStrong: '#F5F6F8',
  segment: '#EFF0F3',
  segmentOn: '#FFFFFF',
  fieldBorder: '#E1E3E8',
  text: '#16171D',
  muted: '#60636F',
  faint: '#8A8D99',
  primary: '#D6336C',
  onPrimary: '#FFFFFF',
  onPrimaryMuted: '#FFDCE8',
  primarySoft: '#FDE8F0',
  primaryText: '#B0225A',
  successBg: '#E3F4EA',
  successText: '#146C3C',
  successDot: '#1E9E57',
  warnBg: '#FDEEDD',
  warnText: '#9A4A0B',
  warnDot: '#E8820C',
  danger: '#B4232C',
  mark: '#16171D',
  onMark: '#FFFFFF',
};

export const dark: Palette = {
  scheme: 'dark',
  bg: '#0F1014',
  bgTint: '#12303D',
  sheet: '#17181D',
  border: '#272830',
  inner: '#1D1E25',
  innerStrong: '#1D1E25',
  segment: '#0F1014',
  segmentOn: '#2A2B34',
  fieldBorder: '#353640',
  text: '#F2F3F7',
  muted: '#A0A3B5',
  faint: '#7C7F92',
  primary: '#D23A70',
  onPrimary: '#FFFFFF',
  onPrimaryMuted: '#FFDCE8',
  primarySoft: '#3A1D2A',
  primaryText: '#FF9EC0',
  successBg: '#12301F',
  successText: '#7FDBA4',
  successDot: '#3CC57A',
  warnBg: '#3A2410',
  warnText: '#F5B26B',
  warnDot: '#F0932B',
  danger: '#FF8A8F',
  mark: '#F2F3F7',
  onMark: '#0F1014',
};

export type Appearance = 'automatic' | 'light' | 'dark';

const ThemeContext = createContext<Palette>(light);

export function ThemeProvider({ appearance, children }: { appearance: Appearance; children: ReactNode }) {
  const system = useColorScheme();
  const scheme = appearance === 'automatic' ? (system === 'dark' ? 'dark' : 'light') : appearance;
  return <ThemeContext.Provider value={scheme === 'dark' ? dark : light}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

/** Soft avatar tints, picked by a stable hash of the worker's id. */
const AVATAR_TINTS = {
  light: [
    { bg: '#FDE8F0', fg: '#B0225A' },
    { bg: '#E2F4FB', fg: '#1B6E98' },
    { bg: '#FCE9DA', fg: '#9A4A0B' },
    { bg: '#DDF1EE', fg: '#0F5F57' },
    { bg: '#E4ECFB', fg: '#24489A' },
    { bg: '#F6E3F1', fg: '#8A2A6E' },
  ],
  dark: [
    { bg: '#3A1D2A', fg: '#FF9EC0' },
    { bg: '#102A36', fg: '#8FD6F3' },
    { bg: '#3A2410', fg: '#F5B26B' },
    { bg: '#10302C', fg: '#7FD6C8' },
    { bg: '#16264A', fg: '#9DB8F5' },
    { bg: '#3A1B31', fg: '#F0A6D8' },
  ],
} as const;

export function avatarTint(scheme: 'light' | 'dark', seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const tints = AVATAR_TINTS[scheme];
  return tints[hash % tints.length] ?? tints[0];
}

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}
