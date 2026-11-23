import { NativeTabs } from 'expo-router/native-tabs';
import { useTheme } from '@/ui/theme';

/**
 * The four tabs, drawn by the system: the translucent glass tab bar on iOS 26
 * (the regular one on older iOS) and Material navigation on Android. Every tab
 * looks the same; the selected one only takes the accent colour. On iPad the
 * system lays the same tabs out along the top or as a sidebar.
 */
export default function TabsLayout() {
  const c = useTheme();
  return (
    <NativeTabs tintColor={c.primary}>
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="workers">
        <NativeTabs.Trigger.Label>Workers</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="insights">
        <NativeTabs.Trigger.Label>Insights</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.bar" md="bar_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="slider.horizontal.3" md="tune" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
