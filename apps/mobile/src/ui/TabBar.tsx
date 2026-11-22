import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBusiness } from '@/state/business';
import { useIsWide } from './layout';
import { Icon } from './primitives';
import { initials, useTheme } from './theme';

export type TabName = 'home' | 'workers' | 'reports' | 'settings';

const TABS: readonly { name: TabName; label: string; icon: SFSymbol }[] = [
  { name: 'home', label: 'Pay stub', icon: 'doc.text' },
  { name: 'workers', label: 'Workers', icon: 'person.2' },
  { name: 'reports', label: 'Reports', icon: 'chart.bar' },
  { name: 'settings', label: 'Settings', icon: 'slider.horizontal.3' },
];

function go(name: TabName, active: TabName): void {
  if (name !== active) router.replace(`/${name}`);
}

/** Bottom tab bar on iPhone. */
export function TabBar({ active }: { active: TabName }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  if (useIsWide()) return null;
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        paddingTop: 8,
        paddingHorizontal: 12,
        paddingBottom: Math.max(insets.bottom, 12),
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: c.sheet,
      }}>
      {TABS.map((tab) => {
        const on = tab.name === active;
        const color = on ? c.primaryText : c.muted;
        return (
          <Pressable
            key={tab.name}
            onPress={() => go(tab.name, active)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Icon name={tab.icon} size={22} color={color} />
            <Text style={{ fontSize: 11, fontWeight: on ? '600' : '500', color }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The same three destinations as a rail down the left edge on iPad. */
export function SideRail({ active }: { active: TabName }) {
  const c = useTheme();
  const business = useBusiness();
  return (
    <View accessibilityRole="tablist" style={{ width: 84, alignItems: 'center', gap: 6 }}>
      <View
        style={{ width: 44, height: 44, marginBottom: 14, borderRadius: 13, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: c.onPrimary }}>{initials(business.name)}</Text>
      </View>
      {TABS.map((tab) => {
        const on = tab.name === active;
        const color = on ? c.primaryText : c.muted;
        return (
          <Pressable
            key={tab.name}
            onPress={() => go(tab.name, active)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{
              width: 76,
              height: 62,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              backgroundColor: on ? c.sheet : 'transparent',
            }}>
            <Icon name={tab.icon} size={22} color={color} />
            <Text style={{ fontSize: 12, fontWeight: on ? '600' : '500', color }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Business name header shown at the top of each tab on iPhone. */
export function BusinessHeader({ right }: { right?: React.ReactNode }) {
  const c = useTheme();
  const business = useBusiness();
  return (
    <View style={{ height: 44, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: c.onPrimary }}>{initials(business.name)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }} numberOfLines={1}>
          {business.name}
        </Text>
        <Text style={{ fontSize: 12, color: c.muted }}>CrewStub</Text>
      </View>
      {right}
    </View>
  );
}
