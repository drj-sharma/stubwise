import { Text, View } from 'react-native';
import { useBusiness } from '@/state/business';
import { initials, useTheme } from './theme';

/** Business name header shown at the top of each tab. The tab bar itself is the system's (see `app/(tabs)/_layout.tsx`). */
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
