import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { renderStub } from '@/services/pdf';
import { useBusiness } from '@/state/business';
import { useQuery } from '@/state/useQuery';
import { ErrorState } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** Lays the Letter page out at its real width (816 px) and lets the web view scale it to fit. */
function forPreview(html: string): string {
  return html.replace('content="width=device-width, initial-scale=1"', 'content="width=816"');
}

/**
 * The stub exactly as it will print, in the chosen template. `version` is
 * bumped by the editor after each change so the page re-renders.
 */
export function StubPreview({ stubId, version = 0 }: { stubId: string; version?: number }) {
  const c = useTheme();
  const business = useBusiness();
  const { data, error, reload } = useQuery(() => renderStub(business, stubId), [stubId, version, business.templateId, business.accent, business.showPto, business.showEmployerTaxes, business.showDepositSlip]);

  if (error && !data) return <ErrorState title="Could not load the preview" error={error} onRetry={() => void reload()} />;

  return (
    <View
      style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.innerStrong, overflow: 'hidden', padding: 10 }}
      accessibilityLabel="Pay stub preview">
      {data ? (
        <WebView
          originWhitelist={['*']}
          source={{ html: forPreview(data.html) }}
          // The page is static HTML built on the device; scripts are never needed.
          javaScriptEnabled={false}
          scalesPageToFit
          // iPad opens web pages in desktop mode, which ignores the width above and crops the page.
          contentMode="mobile"
          style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 3 }}
        />
      ) : (
        <Text style={{ color: c.muted, fontSize: 13, padding: 12 }}>{data === null ? 'This stub no longer exists.' : 'Preparing preview…'}</Text>
      )}
    </View>
  );
}
