import { router, useLocalSearchParams } from 'expo-router';
import { WorkerDetail } from '@/features/WorkerDetail';
import { CircleButton, Screen, TopBar } from '@/ui/primitives';

export default function WorkerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <TopBar title="Worker" left={<CircleButton icon="arrow.left" label="Back to workers" onPress={() => router.back()} />} />
      <WorkerDetail workerId={id} />
    </Screen>
  );
}
