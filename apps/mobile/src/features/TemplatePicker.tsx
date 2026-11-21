import { type StubDocument, TEMPLATES, type TemplateId, renderStubHtml } from '@stubwise/templates';
import { Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Icon, SectionLabel } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

export const ACCENTS = ['#3F3D9E', '#0A6B57', '#1D4ED8', '#B4232C', '#7A4300', '#16171D'] as const;

export interface TemplateSampleBusiness {
  name: string;
  address: string;
  phone: string;
  employerId: string | null;
}

/** A fixed example stub, so templates can be compared before any real stub exists. */
function sample(business: TemplateSampleBusiness): StubDocument {
  return {
    business: { ...business, name: business.name || 'Your business', logoDataUri: null },
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

/**
 * The template library: every layout shown with sample figures, plus the
 * accent colour for layouts that use one. Used in onboarding and in Settings.
 */
export function TemplatePicker({
  business,
  templateId,
  accent,
  onChange,
}: {
  business: TemplateSampleBusiness;
  templateId: TemplateId;
  accent: string;
  onChange: (patch: { templateId?: TemplateId; accent?: string }) => void;
}) {
  const c = useTheme();
  const document = sample(business);
  const selected = TEMPLATES.find((template) => template.id === templateId) ?? TEMPLATES[0];

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {TEMPLATES.map((template) => {
          const on = template.id === templateId;
          const html = renderStubHtml(document, template.id, { accent }).replace(
            'content="width=device-width, initial-scale=1"',
            'content="width=816"',
          );
          return (
            <Pressable
              key={template.id}
              onPress={() => onChange({ templateId: template.id })}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${template.name} template. ${template.description}`}
              style={{
                flexBasis: 150,
                flexGrow: 1,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: on ? c.primaryText : c.border,
                backgroundColor: c.inner,
                overflow: 'hidden',
              }}>
              <View style={{ height: 200, padding: 8 }} pointerEvents="none">
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
            {ACCENTS.map((option) => {
              const on = option.toLowerCase() === accent.toLowerCase();
              return (
                <Pressable
                  key={option}
                  onPress={() => onChange({ accent: option })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Accent colour ${option}`}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: option,
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
    </View>
  );
}
