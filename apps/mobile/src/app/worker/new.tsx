import { router } from 'expo-router';
import { WorkerForm } from '@/features/WorkerForm';
import { CircleButton, Screen, TopBar } from '@/ui/primitives';

export default function NewWorker() {
  return (
    <Screen>
      <TopBar title="Add worker" left={<CircleButton icon="xmark" label="Close" onPress={() => router.back()} />} />
      <WorkerForm existing={null} />
    </Screen>
  );
}
