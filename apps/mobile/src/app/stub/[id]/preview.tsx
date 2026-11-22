import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StubActions } from '@/features/StubActions';
import { StubPreview } from '@/features/StubPreview';
import { CircleButton, Screen, Sheet, TextButton, TopBar } from '@/ui/primitives';

/** The stub as it will print, with Print and Share PDF. */
export default function PreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  return (
    <Screen padBottom={false}>
      <TopBar
        title="Preview"
        left={<CircleButton icon="arrow.left" label="Back to edit" onPress={() => router.back()} />}
        right={<TextButton title="Done" onPress={() => router.dismissAll()} />}
      />
      <Sheet style={{ flex: 1, margin: 12 }}>
        <StubPreview stubId={id} />
      </Sheet>
      <View style={{ paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 16) }}>
        <StubActions stubId={id} />
      </View>
    </Screen>
  );
}
