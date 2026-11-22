import { ActivityIndicator, Alert, RefreshControl, Text, View } from 'react-native';
import { errorMessage } from '@/api';
import { Button, Icon, Sheet } from './primitives';
import { useTheme } from './theme';

/** A screen's first load, before anything can be shown. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  const c = useTheme();
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center', gap: 12 }} accessibilityLiveRegion="polite">
      <ActivityIndicator color={c.primary} />
      <Text style={{ fontSize: 13, color: c.muted }}>{label}</Text>
    </View>
  );
}

/** A load that failed with nothing to show instead: the server's (or the offline) message and a way to try again. */
export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry: () => void; title?: string }) {
  const c = useTheme();
  return (
    <Sheet style={{ margin: 12, paddingVertical: 24, alignItems: 'center', gap: 12 }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.warnBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="wifi.exclamationmark" size={24} color={c.warnText} />
      </View>
      <Text style={{ fontSize: 16, fontWeight: '600', color: c.text, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontSize: 13, lineHeight: 19, color: c.muted, textAlign: 'center', marginHorizontal: 12 }}>{errorMessage(error)}</Text>
      <Button title="Try again" variant="secondary" icon="arrow.clockwise" onPress={onRetry} style={{ alignSelf: 'stretch' }} />
    </Sheet>
  );
}

/** A thin warning above content that is still shown from the last successful load. */
export function StaleBanner({ error }: { error: unknown }) {
  const c = useTheme();
  return (
    <View style={{ marginBottom: 10, padding: 10, borderRadius: 12, backgroundColor: c.warnBg, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <Icon name="exclamationmark.triangle.fill" size={14} color={c.warnText} />
      <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: c.warnText }}>{errorMessage(error)} Pull down to try again.</Text>
    </View>
  );
}

/** Pull-to-refresh, tinted to match. */
export function Refresher({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  const c = useTheme();
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />;
}

/** The standard alert for a change the server refused or could not receive. */
export function alertError(title: string, error: unknown): void {
  Alert.alert(title, errorMessage(error));
}
