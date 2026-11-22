import { useEffect, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

/**
 * How much room a no-scroll screen has, from the window height:
 * - `roomy`: Pro and Max sized phones and iPads.
 * - `compact`: standard and mini phones.
 * - `tight`: iPhone SE and phones in landscape.
 * Onboarding uses it to size or drop decorative parts so every step fits
 * without scrolling.
 */
export type Fit = 'roomy' | 'compact' | 'tight';

export function useFit(): Fit {
  const { height } = useWindowDimensions();
  if (height >= 840) return 'roomy';
  if (height >= 740) return 'compact';
  return 'tight';
}

/** Pick a value by fit: `byFit(fit, { roomy: 140, compact: 100, tight: 0 })`. */
export function byFit<T>(fit: Fit, values: Record<Fit, T>): T {
  return values[fit];
}

/** True while the on-screen keyboard is up, so a screen can drop decoration to keep its fields in view. */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // iOS reports the keyboard before it moves, which avoids a jump; Android only after.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setShown(true));
    const hide = Keyboard.addListener(hideEvent, () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}
