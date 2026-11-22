import { useState } from 'react';
import { Alert, View } from 'react-native';
import { errorMessage } from '@/api';
import { printStub, renderStub, shareStubPdf } from '@/services/pdf';
import { useBusiness } from '@/state/business';
import { Button } from '@/ui/primitives';

/** Print and Share PDF. The PDF is made on the device at the moment of sharing, from the server's saved stub. */
export function StubActions({ stubId }: { stubId: string }) {
  const business = useBusiness();
  const [busy, setBusy] = useState(false);

  const run = async (action: 'share' | 'print'): Promise<void> => {
    setBusy(true);
    try {
      const rendered = await renderStub(business, stubId);
      if (!rendered) throw new Error('This stub no longer exists.');
      if (action === 'share') await shareStubPdf(rendered);
      else await printStub(rendered);
    } catch (error) {
      Alert.alert(action === 'share' ? 'Could not share the stub' : 'Could not print the stub', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Button title="Print" variant="secondary" icon="printer" onPress={() => void run('print')} disabled={busy} style={{ flex: 1 }} />
      <Button title="Share PDF" icon="square.and.arrow.up" onPress={() => void run('share')} disabled={busy} style={{ flex: 1.6 }} />
    </View>
  );
}
