import { type StubDocument, TEMPLATES, type TemplateId, renderStubHtml } from '@stubwise/templates';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { updateBusinessSettings } from '@/db/repo';
import { useBusiness, useBusinessState } from '@/state/business';
import { CircleButton, Heading, Icon, Screen, SectionLabel, Sheet, TopBar } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

const ACCENTS = ['#3F3D9E', '#0A6B57', '#1D4ED8', '#B4232C', '#7A4300', '#16171D'] as const;

/** A fixed example stub, so templates can be compared before any real stub exists. */
function sample(businessName: string, address: string, phone: string, employerId: string | null): StubDocument {
  return {
    business: { name: businessName, address, phone, employerId, logoDataUri: null },
    worker: { name: 'Sample Worker', address: '100 Main St', typeLabel: 'Hourly employee', rateLabel: '$24.00 per hour' },
    period: { start: '2026-11-09', end: '2026-11-22' },
    payDate: '2026-11-27',
    scheduleLabel: 'Every two weeks',
    earnings: [
      { label: 'Regular', minutes: 4605, rateCents: 2400, currentCents: 184200, ytdCents: 4327800 },
      { label: 'Overtime', minutes: 210, rateCents: 3600, currentCents: 12600, ytdCents: 179100 },
      { label: 'Bonus', minutes: null, rateCents: null, currentCents: 7500, ytdCents: 32500 },
    ],
    deductions: [
      { label: 'Federal income tax', minutes: null, rateCents: null, currentCents: 18600, ytdCents: 408800 },
      { label: 'Social Security', minutes: null, rateCents: null, currentCents: 12667, ytdCents: 281443 },
      { label: 'Medicare', minutes: null, rateCents: null, currentCents: 2962, ytdCents: 65821 },
      { label: 'Health insurance', minutes: null, rateCents: null, currentCents: 8500, ytdCents: 195500 },
    ],
    totals: {
      current: { grossCents: 204300, deductionsCents: 42729, netCents: 161571, totalMinutes: 4815 },
      ytd: { grossCents: 4539400, deductionsCents: 951564, netCents: 3587836 },
    },
    ytdNote: 'Year-to-date amounts cover pay dated Jan 1 to Nov 27, 2026.',
  };
}

/** The template library: pick the layout and accent colour used for every stub. */
export default function Templates() {
  const c = useTheme();
  const db = useSQLiteContext();
  const business = useBusiness();
  const { reload } = useBusinessState();
  const document = sample(business.name, business.address, business.phone, business.showEmployerId ? business.employerId : null);
  const selected = TEMPLATES.find((template) => template.id === business.templateId) ?? TEMPLATES[0];

  const choose = async (patch: { templateId?: TemplateId; accent?: string }): Promise<void> => {
    await updateBusinessSettings(db, patch);
    await reload();
  };

  return (
    <Screen>
      <TopBar title="Stub template" left={<CircleButton icon="arrow.left" label="Back to settings" onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, alignSelf: 'center', width: '100%', maxWidth: 900 }}>
        <Sheet style={{ paddingTop: 16, gap: 12 }}>
          <Heading title="Template library" subtitle="Used for every stub you preview, print or share. Shown with sample figures." />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {TEMPLATES.map((template) => {
              const on = template.id === business.templateId;
              const html = renderStubHtml(document, template.id, { accent: business.accent }).replace(
                'content="width=device-width, initial-scale=1"',
                'content="width=816"',
              );
              return (
                <Pressable
                  key={template.id}
                  onPress={() => void choose({ templateId: template.id })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${template.name} template. ${template.description}`}
                  style={{
                    flexBasis: 160,
                    flexGrow: 1,
                    borderRadius: 14,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? c.primaryText : c.border,
                    backgroundColor: c.inner,
                    overflow: 'hidden',
                  }}>
                  <View style={{ height: 210, padding: 8 }} pointerEvents="none">
                    <WebView originWhitelist={['*']} source={{ html }} javaScriptEnabled={false} scalesPageToFit scrollEnabled={false} style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
                  </View>
                  <View style={{ padding: 10, gap: 2, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.sheet }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{template.name}</Text>
                      {on ? <Icon name="checkmark.circle.fill" size={18} color={c.primaryText} /> : null}
                    </View>
                    <Text style={{ fontSize: 12, lineHeight: 16, color: c.muted }}>{template.description}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {selected?.usesAccent ? (
            <View style={{ gap: 8 }}>
              <SectionLabel>Accent colour</SectionLabel>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {ACCENTS.map((accent) => {
                  const on = accent.toLowerCase() === business.accent.toLowerCase();
                  return (
                    <Pressable
                      key={accent}
                      onPress={() => void choose({ accent })}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Accent colour ${accent}`}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: accent,
                        borderWidth: 3,
                        borderColor: on ? c.text : c.sheet,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      {on ? <Icon name="checkmark" size={16} color="#FFFFFF" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </Sheet>
      </ScrollView>
    </Screen>
  );
}
