import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useIsWide } from '@/ui/layout';
import { CircleButton, Icon, Screen, Sheet, TopBar } from '@/ui/primitives';
import { Refresher } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** One settings section on its own screen: a back button, a title, and the section's content. */
export function SettingsPage({ title, children, refreshing, onRefresh }: { title: string; children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const wide = useIsWide();
  return (
    <Screen>
      <TopBar title={title} left={<CircleButton icon="arrow.left" label="Back" onPress={() => router.back()} />} />
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingTop: 8, gap: 12, width: '100%', maxWidth: wide ? 640 : undefined, alignSelf: 'center' }}
        refreshControl={onRefresh ? <Refresher refreshing={refreshing ?? false} onRefresh={onRefresh} /> : undefined}>
        {children}
      </ScrollView>
    </Screen>
  );
}

/** A row in the settings hub: a coloured icon tile, a title, a line of detail and a chevron. */
export function MenuRow({
  icon,
  tint,
  title,
  detail,
  onPress,
  last,
}: {
  icon: SFSymbol;
  tint: 'pink' | 'sky' | 'green' | 'amber' | 'grey';
  title: string;
  detail?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const c = useTheme();
  const tiles = {
    pink: [c.primarySoft, c.primaryText],
    sky: [c.bgTint, c.text],
    green: [c.successBg, c.successText],
    amber: [c.warnBg, c.warnText],
    grey: [c.inner, c.muted],
  } as const;
  const [bg, fg] = tiles[tint];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={detail}
      style={({ pressed }) => ({
        minHeight: 62,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
        opacity: pressed ? 0.6 : 1,
      })}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{title}</Text>
        {detail ? (
          <Text style={{ fontSize: 13, color: c.muted }} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron.right" size={13} color={c.faint} />
    </Pressable>
  );
}

/** A white card holding a group of rows. */
export function Group({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Sheet style={{ padding: 0, gap: 0, overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>{children}</Sheet>;
}
