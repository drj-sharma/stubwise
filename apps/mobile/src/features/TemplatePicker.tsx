import { type StubDocument, TEMPLATES, type TemplateId, renderStubHtml } from '@stubwise/templates';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Button, CircleButton, Icon, SectionLabel } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

export const ACCENTS = ['#B0225A', '#1B6E98', '#3F3D9E', '#0A6B57', '#1D4ED8', '#B4232C', '#7A4300', '#16171D'] as const;

export interface TemplateSampleBusiness {
  name: string;
  address: string;
  phone: string;
  employerId: string | null;
}

/** A fixed example stub, so templates can be compared before any real stub exists. */
export function sample(business: TemplateSampleBusiness): StubDocument {
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

/** The sample stub as a fixed-width page, for the full-size view (pinch to zoom). */
export function sampleHtml(document: StubDocument, templateId: TemplateId, accent: string): string {
  return renderStubHtml(document, templateId, { accent }).replace('content="width=device-width, initial-scale=1"', 'content="width=816"');
}

/** The Letter page's width in CSS pixels. */
const PAGE_WIDTH = 816;

/**
 * A sample stub drawn to fit a small view, such as a thumbnail. iOS will not
 * zoom a page out below a quarter of its size, which cuts off the right of
 * the page in anything narrower than about 200 points, so the page is shrunk
 * with a CSS transform to the measured width instead (CSS zoom would re-flow the text).
 */
function StubPicture({ document, templateId, accent }: { document: StubDocument; templateId: TemplateId; accent: string }) {
  const [width, setWidth] = useState(0);
  const html =
    width > 0
      ? renderStubHtml(document, templateId, { accent }).replace(
          '</style>',
          `html, body { overflow: hidden; -webkit-text-size-adjust: none; } body { width: ${PAGE_WIDTH}px; transform: scale(${(width / PAGE_WIDTH).toFixed(4)}); transform-origin: 0 0; }\n</style>`,
        )
      : null;
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}>
      {html ? <WebView originWhitelist={['*']} source={{ html }} javaScriptEnabled={false} scrollEnabled={false} style={{ flex: 1, backgroundColor: '#FFFFFF' }} /> : null}
    </View>
  );
}

/**
 * The template library: every layout shown with sample figures, plus the
 * accent colour for layouts that use one. Used in onboarding and in Settings.
 *
 * `compact` is for onboarding, where nothing may scroll: shorter thumbnails,
 * no descriptions, View sample as an icon, and the accent colours left to
 * their own step (`showAccents={false}`).
 */
export function TemplatePicker({
  business,
  templateId,
  accent,
  onChange,
  compact,
  showAccents = true,
}: {
  business: TemplateSampleBusiness;
  templateId: TemplateId;
  accent: string;
  onChange: (patch: { templateId?: TemplateId; accent?: string }) => void;
  compact?: { thumbHeight: number };
  showAccents?: boolean;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [viewing, setViewing] = useState<TemplateId | null>(null);
  const document = sample(business);
  const viewed = TEMPLATES.find((template) => template.id === viewing);
  const selected = TEMPLATES.find((template) => template.id === templateId) ?? TEMPLATES[0];

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {TEMPLATES.map((template) => {
          const on = template.id === templateId;
          return (
            <Pressable
              key={template.id}
              onPress={() => onChange({ templateId: template.id })}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${template.name} template. ${template.description}`}
              style={{
                flexBasis: compact ? '45%' : 150,
                flexGrow: 1,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: on ? c.primaryText : c.border,
                backgroundColor: c.inner,
                overflow: 'hidden',
              }}>
              <View style={{ height: compact?.thumbHeight ?? 200, padding: compact ? 6 : 8 }} pointerEvents="none">
                <StubPicture document={document} templateId={template.id} accent={accent} />
              </View>
              {compact ? (
                <View
                  style={{
                    height: 44,
                    paddingLeft: 10,
                    paddingRight: 4,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    borderTopWidth: 1,
                    borderTopColor: c.border,
                    backgroundColor: c.sheet,
                  }}>
                  {on ? <Icon name="checkmark.circle.fill" size={16} color={c.primaryText} /> : null}
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: c.text }} numberOfLines={1}>
                    {template.name}
                  </Text>
                  <Pressable
                    onPress={() => setViewing(template.id)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`View a full sample of the ${template.name} design`}
                    style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                    <Icon name="eye" size={17} color={c.primaryText} />
                  </Pressable>
                </View>
              ) : (
                <View style={{ padding: 10, gap: 2, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.sheet }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{template.name}</Text>
                    {on ? <Icon name="checkmark.circle.fill" size={18} color={c.primaryText} /> : null}
                  </View>
                  <Text style={{ fontSize: 12, lineHeight: 16, color: c.muted }}>{template.description}</Text>
                  <Pressable
                    onPress={() => setViewing(template.id)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`View a full sample of the ${template.name} design`}
                    style={({ pressed }) => ({
                      marginTop: 8,
                      height: 36,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: c.fieldBorder,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      opacity: pressed ? 0.6 : 1,
                    })}>
                    <Icon name="eye" size={15} color={c.primaryText} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: c.primaryText }}>View sample</Text>
                  </Pressable>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {showAccents && selected?.usesAccent ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>Accent colour</SectionLabel>
          <AccentSwatches accent={accent} onChange={(next) => onChange({ accent: next })} />
        </View>
      ) : null}

      {/* A full-page sample of one design, as it will look as a PDF. Pinch to zoom. */}
      <Modal visible={viewed !== undefined} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setViewing(null)}>
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <View style={{ height: 60, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <CircleButton icon="xmark" label="Close sample" onPress={() => setViewing(null)} />
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: '600', color: c.text }}>
                {viewed?.name} sample
              </Text>
              <Text style={{ fontSize: 12, color: c.muted }}>Sample figures. Pinch to zoom.</Text>
            </View>
          </View>
          <View style={{ flex: 1, marginHorizontal: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: '#FFFFFF' }}>
            {viewed ? (
              <WebView
                originWhitelist={['*']}
                source={{ html: sampleHtml(document, viewed.id, accent) }}
                javaScriptEnabled={false}
                scalesPageToFit
                style={{ flex: 1, backgroundColor: '#FFFFFF' }}
              />
            ) : null}
          </View>
          <View style={{ padding: 12, paddingBottom: Math.max(insets.bottom, 12) }}>
            <Button
              title={viewed?.id === templateId ? 'This is your design' : 'Use this design'}
              disabled={viewed?.id === templateId}
              onPress={() => {
                if (viewed) onChange({ templateId: viewed.id });
                setViewing(null);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** The accent colour choices, as round swatches. Wraps onto a second row on narrow screens. */
export function AccentSwatches({ accent, onChange, size = 44, gap = 10 }: { accent: string; onChange: (accent: string) => void; size?: number; gap?: number }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {ACCENTS.map((option) => {
        const on = option.toLowerCase() === accent.toLowerCase();
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Accent colour ${option}`}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
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
  );
}

/** A non-interactive picture of one design with the sample figures, for showing a choice in place. */
export function DesignPreview({ business, templateId, accent, height }: { business: TemplateSampleBusiness; templateId: TemplateId; accent: string; height: number }) {
  const c = useTheme();
  return (
    <View style={{ height, padding: 14, borderRadius: 28, backgroundColor: c.primarySoft }} pointerEvents="none">
      <View style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}>
        <StubPicture document={sample(business)} templateId={templateId} accent={accent} />
      </View>
    </View>
  );
}
