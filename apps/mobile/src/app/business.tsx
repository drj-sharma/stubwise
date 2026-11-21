import { router } from 'expo-router';
import { BusinessForm } from '@/features/BusinessForm';
import { useBusiness } from '@/state/business';
import { CircleButton, Screen, TopBar } from '@/ui/primitives';

/** Edit business details, opened from Settings. */
export default function EditBusiness() {
  const business = useBusiness();
  return (
    <Screen modal>
      <TopBar title="Business" left={<CircleButton icon="xmark" label="Close" onPress={() => router.back()} />} />
      <BusinessForm
        initial={business}
        title="Business details"
        subtitle="Changes apply to stubs you make or re-export from now on."
        submitLabel="Save"
        onSaved={() => router.back()}
      />
    </Screen>
  );
}
