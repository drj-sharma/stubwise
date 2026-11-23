import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { errorMessage } from '@/api';
import { MailUnavailableError, emailStubPdf, printStub, renderStub, shareStubPdf } from '@/services/pdf';
import { useBusiness } from '@/state/business';
import { Button } from '@/ui/primitives';

/**
 * Send to worker, Print and Share PDF. The PDF is made on the device at the
 * moment of sending, from the server's saved stub. "Send to worker" opens the
 * phone's mail composer with the PDF attached, so it goes out from the owner's
 * own email account and the file is never uploaded.
 */
export function StubActions({ stubId }: { stubId: string }) {
  const business = useBusiness();
  const [busy, setBusy] = useState(false);

  const run = async (action: 'send' | 'share' | 'print'): Promise<void> => {
    setBusy(true);
    try {
      const rendered = await renderStub(business, stubId);
      if (!rendered) throw new Error('This stub no longer exists.');
      if (action === 'send') {
        if (rendered.worker.email === '') {
          Alert.alert(`No email for ${rendered.worker.name}`, 'Add their email address to send the stub, or use Share PDF.', [
            { text: 'Add email', onPress: () => router.push(`/worker/${rendered.worker.id}/edit`) },
            { text: 'Not now', style: 'cancel' },
          ]);
          return;
        }
        await emailStubPdf(rendered, business.name);
      } else if (action === 'share') await shareStubPdf(rendered);
      else await printStub(rendered);
    } catch (error) {
      if (error instanceof MailUnavailableError) {
        Alert.alert('Email is not set up on this phone', error.message);
      } else {
        Alert.alert(action === 'send' ? 'Could not email the stub' : action === 'share' ? 'Could not share the stub' : 'Could not print the stub', errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Button title="Send to worker" icon="envelope" onPress={() => void run('send')} disabled={busy} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Print" variant="secondary" icon="printer" onPress={() => void run('print')} disabled={busy} style={{ flex: 1 }} />
        <Button title="Share PDF" variant="secondary" icon="square.and.arrow.up" onPress={() => void run('share')} disabled={busy} style={{ flex: 1.6 }} />
      </View>
    </View>
  );
}
