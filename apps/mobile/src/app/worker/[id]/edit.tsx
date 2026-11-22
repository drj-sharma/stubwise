import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { getWorker } from '@/api/records';
import { WorkerForm } from '@/features/WorkerForm';
import { useQuery } from '@/state/useQuery';
import { CircleButton, Screen, Sheet, TopBar } from '@/ui/primitives';
import { ErrorState, Loading } from '@/ui/states';
import { useTheme } from '@/ui/theme';

export default function EditWorker() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, reload } = useQuery(() => getWorker(id), [id]);
  return (
    <Screen modal>
      <TopBar title="Edit worker" left={<CircleButton icon="xmark" label="Close" onPress={() => router.back()} />} />
      {data ? (
        // Keyed by version too, so a reload after a conflict starts the form again from the server's copy.
        <WorkerForm key={`${data.id}-${data.version}`} existing={data} onConflict={() => void reload()} />
      ) : data === null ? (
        <Sheet style={{ margin: 12 }}>
          <Text style={{ color: c.muted, fontSize: 14 }}>This worker no longer exists.</Text>
        </Sheet>
      ) : error ? (
        <ErrorState title="Could not load this worker" error={error} onRetry={() => void reload()} />
      ) : (
        <Loading />
      )}
    </Screen>
  );
}
