import type { TemplateId } from '@stubwise/templates';
import { router } from 'expo-router';
import { ScrollView } from 'react-native';
import { TemplatePicker } from '@/features/TemplatePicker';
import { useBusiness, useBusinessState } from '@/state/business';
import { CircleButton, Heading, Screen, Sheet, TopBar } from '@/ui/primitives';
import { alertError } from '@/ui/states';

/** The template library: pick the layout and accent colour used for every stub. */
export default function Templates() {
  const business = useBusiness();
  const { update } = useBusinessState();

  // Shown at once; the server's copy replaces it, or the old choice comes back with a message.
  const choose = async (patch: { templateId?: TemplateId; accent?: string }): Promise<void> => {
    try {
      await update(patch);
    } catch (error) {
      alertError('Could not change the template', error);
    }
  };

  return (
    <Screen>
      <TopBar title="Stub template" left={<CircleButton icon="arrow.left" label="Back to settings" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, alignSelf: 'center', width: '100%', maxWidth: 1280 }}>
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
