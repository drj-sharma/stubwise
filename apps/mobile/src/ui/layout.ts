import { useWindowDimensions } from 'react-native';

/** At this width (iPad, landscape or wide split view) screens switch to two panes. */
export const WIDE_BREAKPOINT = 900;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}
