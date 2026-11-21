import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StubActions } from '@/features/StubActions';
import { StubEditor } from '@/features/StubEditor';
import { StubPreview } from '@/features/StubPreview';
import { useIsWide } from '@/ui/layout';
import { Button, CircleButton, Heading, Screen, Sheet, TopBar } from '@/ui/primitives';

/** The stub editor. On iPad the printable stub sits beside it and updates after every change. */
export default function StubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const [version, setVersion] = useState(0);
  const back = <CircleButton icon="arrow.left" label="Back" onPress={() => router.back()} />;

  if (wide) {
    return (
      <Screen>
        <TopBar title="Pay stub" left={back} />
        <View style={{ flex: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 4 }}>
          <View style={{ width: 480 }}>
            <StubEditor stubId={id} onChanged={() => setVersion((v) => v + 1)} />
          </View>
          <Sheet style={{ flex: 1, margin: 12, marginLeft: 0, paddingTop: 16 }}>
            <Heading title="Preview" subtitle="Updates after every change" />
            <StubPreview stubId={id} version={version} />
            <StubActions stubId={id} />
          </Sheet>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padBottom={false}>
      <TopBar title="Pay stub" left={back} />
      <StubEditor stubId={id} />
      <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) }}>
        <Button title="Preview stub" onPress={() => router.push(`/stub/${id}/preview`)} />
      </View>
    </Screen>
  );
}
