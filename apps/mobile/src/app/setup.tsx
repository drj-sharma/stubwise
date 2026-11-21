import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { BusinessForm } from '@/features/BusinessForm';
import { Icon, Screen } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

/** First run: the business details that go at the top of every stub. */
export default function Setup() {
  const c = useTheme();
  return (
    <Screen>
      <View style={{ height: 44, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="doc.text" color={c.onPrimary} />
        </View>
        <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>Stubwise</Text>
      </View>
      <BusinessForm
        initial={null}
        title="Set up your business"
        subtitle="Shown at the top of every pay stub. You can change it later."
        submitLabel="Continue"
        onSaved={() => router.replace('/workers')}
      />
    </Screen>
  );
}
