import LottieView from 'lottie-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

/**
 * The app's Lottie animations, built by scripts/build-lottie.mjs.
 * To use artwork from LottieFiles instead, replace a JSON file and keep its name.
 */
const SOURCES = {
  welcome: require('../../assets/lottie/welcome.json'),
  secure: require('../../assets/lottie/secure.json'),
  business: require('../../assets/lottie/business.json'),
  schedule: require('../../assets/lottie/schedule.json'),
  templates: require('../../assets/lottie/templates.json'),
  worker: require('../../assets/lottie/worker.json'),
  done: require('../../assets/lottie/done.json'),
} as const;

export type AnimationName = keyof typeof SOURCES;

/** Frame that shows each animation complete, used when motion is turned off. */
const REST_PROGRESS = 0.8;

/**
 * A decorative animation. It is hidden from screen readers, and when the
 * person has Reduce Motion on it shows one finished frame and does not move.
 */
export function Animation({ name, size = 150, loop = true }: { name: AnimationName; size?: number; loop?: boolean }) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ alignSelf: 'center' }}>
      <LottieView
        key={`${name}-${reduceMotion ? 'still' : 'moving'}`}
        source={SOURCES[name]}
        autoPlay={!reduceMotion}
        loop={loop}
        progress={reduceMotion ? REST_PROGRESS : undefined}
        style={{ width: size, height: size }}
      />
    </View>
  );
}
