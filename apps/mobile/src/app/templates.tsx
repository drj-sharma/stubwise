import type { TemplateId } from '@stubwise/templates';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView } from 'react-native';
import { updateBusinessSettings } from '@/db/repo';
import { TemplatePicker } from '@/features/TemplatePicker';
import { useBusiness, useBusinessState } from '@/state/business';
import { CircleButton, Heading, Screen, Sheet, TopBar } from '@/ui/primitives';

/** The template library: pick the layout and accent colour used for every stub. */
export default function Templates() {
  const db = useSQLiteContext();
  const business = useBusiness();
  const { reload } = useBusinessState();

  const choose = async (patch: { templateId?: TemplateId; accent?: string }): Promise<void> => {
    await updateBusinessSettings(db, patch);
    await reload();
  };

  return (
    <Screen>
      <TopBar title="Stub template" left={<CircleButton icon="arrow.left" label="Back to settings" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, alignSelf: 'center', width: '100%', maxWidth: 900 }}>
        <Sheet style={{ paddingTop: 16, gap: 12 }}>
          <Heading title="Template library" subtitle="Used for every stub you preview, print or share. Shown with sample figures." />
          <TemplatePicker
            business={{
              name: business.name,
              address: business.address,
              phone: business.phone,
              employerId: business.showEmployerId ? business.employerId : null,
            }}
            templateId={business.templateId}
            accent={business.accent}
            onChange={(patch) => void choose(patch)}
          />
        </Sheet>
      </ScrollView>
    </Screen>
  );
}
