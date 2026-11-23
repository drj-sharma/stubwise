import { Pressable, Text, View } from 'react-native';
import { Group, SettingsPage } from '@/features/SettingsPage';
import { useBusiness, useBusinessState } from '@/state/business';
import { Icon } from '@/ui/primitives';
import { alertError } from '@/ui/states';
import { type Appearance, useTheme } from '@/ui/theme';

const OPTIONS: { value: Appearance; label: string; detail: string }[] = [
  { value: 'automatic', label: 'Automatic', detail: 'Follows your phone’s light or dark setting' },
  { value: 'light', label: 'Light', detail: 'Always light' },
  { value: 'dark', label: 'Dark', detail: 'Always dark' },
];

/** Light, dark, or following the phone. */
export default function AppearanceSettings() {
  const c = useTheme();
  const business = useBusiness();
  const { update } = useBusinessState();
  return (
    <SettingsPage title="Appearance">
      <Group>
        {OPTIONS.map((option, index) => {
          const on = business.appearance === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => update({ appearance: option.value }).catch((error: unknown) => alertError('Could not change the setting', error))}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => ({
                minHeight: 60,
                paddingHorizontal: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                borderBottomWidth: index === OPTIONS.length - 1 ? 0 : 1,
                borderBottomColor: c.border,
                opacity: pressed ? 0.6 : 1,
              })}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{option.label}</Text>
                <Text style={{ fontSize: 13, color: c.muted }}>{option.detail}</Text>
              </View>
              {on ? <Icon name="checkmark" size={16} color={c.primaryText} /> : null}
            </Pressable>
          );
        })}
      </Group>
    </SettingsPage>
  );
}
