import { router, useLocalSearchParams } from 'expo-router';
import { getWorker } from '@/db/repo';
import { WorkerForm } from '@/features/WorkerForm';
import { useQuery } from '@/state/useQuery';
import { CircleButton, Screen, TopBar } from '@/ui/primitives';

export default function EditWorker() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useQuery((db) => getWorker(db, id), [id]);
  return (
    <Screen modal>
      <TopBar title="Edit worker" left={<CircleButton icon="xmark" label="Close" onPress={() => router.back()} />} />
      {data ? <WorkerForm key={data.id} existing={data} /> : null}
    </Screen>
  );
}
