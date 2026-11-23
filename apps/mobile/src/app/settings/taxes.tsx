import { type UsStateCode, usStateName } from '@stubwise/domain';
import { type ReactNode, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { type TaxRuleItem, type TaxRuleSection, type TaxRules, getTaxRules } from '@/api/taxRules';
import { Group, SettingsPage } from '@/features/SettingsPage';
import { useBusiness, useBusinessState } from '@/state/business';
import { Icon, Pill, Row, Segmented, TABULAR } from '@/ui/primitives';
import { StateSheet } from '@/ui/sheets';
import { ErrorState, Loading, alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

type Choice = 'federal' | 'state';

/**
 * Every tax figure CrewStub applies, for federal tax or any state: rates,
 * brackets, deductions, allowances, wage caps and local rates, exactly as the
 * server's tax rules hold them. Each worker's own forms (W-4 and the state's)
 * are on that worker's page.
 */
export default function TaxSettings() {
  const c = useTheme();
  const business = useBusiness();
  const { update } = useBusinessState();
  const year = new Date().getFullYear();
  const [view, setView] = useState<Choice>(business.state ? 'state' : 'federal');
  const [shown, setShown] = useState<UsStateCode | null>(business.state);
  const [sheet, setSheet] = useState<'business' | 'shown' | null>(null);
  const jurisdiction = view === 'federal' || !shown ? 'US' : shown;

  const [rules, setRules] = useState<{ key: string; data?: TaxRules; error?: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${jurisdiction}:${year}:${attempt}`;
  useEffect(() => {
    let live = true;
    getTaxRules(jurisdiction, year).then(
      (data) => live && setRules({ key, data }),
      (error: unknown) => live && setRules({ key, error }),
    );
    return () => {
      live = false;
    };
  }, [jurisdiction, year, key]);
  const current = rules?.key === key ? rules : null;

  const setBusinessState = (state: UsStateCode): void => {
    setSheet(null);
    if (!shown || shown === business.state) setShown(state);
    update({ state }).catch((error: unknown) => alertError('Could not change the state', error));
  };

  const showState = (state: UsStateCode): void => {
    setSheet(null);
    setShown(state);
    setView('state');
  };

  return (
    <SettingsPage title="Tax settings">
      <Group>
        <Row
          title={business.state ? usStateName(business.state) : 'Choose your state'}
          subtitle="Business state · used for workers with no state of their own"
          minHeight={58}
          strong={business.state !== null}
          right={<Icon name="chevron.down" size={14} color={c.muted} />}
          onPress={() => setSheet('business')}
          last
        />
      </Group>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: c.muted, marginHorizontal: 6 }}>Figures used for {year}</Text>
        <Segmented
          options={[
            { value: 'federal', label: 'Federal' },
            { value: 'state', label: shown ? usStateName(shown) : 'State' },
          ]}
          value={view}
          onChange={(next) => (next === 'state' && !shown ? setSheet('shown') : setView(next))}
          height={38}
        />
        {view === 'state' ? (
          <Pressable
            onPress={() => setSheet('shown')}
            accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
            <Icon name="map" size={14} color={c.primaryText} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: c.primaryText }}>See another state</Text>
          </Pressable>
        ) : null}
      </View>

      {current?.data ? (
        current.data.sections.map((section) => <SectionCard key={section.title} section={section} />)
      ) : current?.error ? (
        <ErrorState title="Could not load the tax figures" error={current.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <Loading label="Loading tax figures…" />
      )}

      <Text style={{ fontSize: 12, lineHeight: 18, color: c.muted, marginHorizontal: 6 }}>
        These come from each tax agency’s own withholding guide and are updated when it changes them. Each worker’s W-4 and state form are on their page under Edit. A tax marked “You type it” gets a line on each stub for you to fill in.
      </Text>

      <StateSheet visible={sheet === 'business'} selected={business.state} onSelect={setBusinessState} onClose={() => setSheet(null)} />
      <StateSheet
        visible={sheet === 'shown'}
        title="Show figures for"
        selected={view === 'federal' ? null : shown}
        onSelect={showState}
        noneLabel="Federal"
        onSelectNone={() => {
          setSheet(null);
          setView('federal');
        }}
        onClose={() => setSheet(null)}
      />
    </SettingsPage>
  );
}

function statusPill(section: TaxRuleSection): ReactNode {
  if (section.status === 'manual') return <Pill tone="warn" label="You type it" />;
  if (section.status === 'none') return <Pill tone="success" label="None" />;
  return <Pill tone="success" label="Calculated" />;
}

/** One tax: its name and status, then its figures, grouped by the first part of each label. */
function SectionCard({ section }: { section: TaxRuleSection }) {
  const c = useTheme();
  const blocks: ReactNode[] = [];
  let group: string | null = null;
  section.items.forEach((item, index) => {
    if (item.type === 'value') {
      const parts = item.label.split(' · ');
      const head = parts.length > 1 ? parts[0]! : null;
      if (head !== group) {
        group = head;
        if (head) blocks.push(<SubHeading key={`h${index}`} label={head} />);
      }
      blocks.push(<ValueRow key={index} label={head ? parts.slice(1).join(' · ') : item.label} value={item.value} indented={head !== null} />);
      return;
    }
    group = null;
    if (item.type === 'table') blocks.push(<TableBlock key={index} item={item} />);
    else if (item.type === 'heading') blocks.push(<Divider key={index} label={item.label} />);
    else
      blocks.push(
        <Text key={index} style={{ fontSize: 12, lineHeight: 17, color: c.muted, paddingHorizontal: 14, paddingVertical: 8 }}>
          {item.label}
        </Text>,
      );
  });

  return (
    <Group>
      <View style={{ padding: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: c.text }}>{section.title}</Text>
        {statusPill(section)}
      </View>
      {blocks}
      {section.source ? (
        <Pressable
          onPress={() => void Linking.openURL(section.source!)}
          accessibilityRole="link"
          style={({ pressed }) => ({ padding: 14, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.6 : 1 })}>
          <Icon name="doc.text.magnifyingglass" size={14} color={c.primaryText} />
          <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: c.primaryText }}>Where these come from</Text>
        </Pressable>
      ) : (
        <View style={{ height: 6 }} />
      )}
    </Group>
  );
}

function SubHeading({ label }: { label: string }) {
  const c = useTheme();
  return <Text style={{ fontSize: 12, fontWeight: '600', color: c.muted, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 }}>{label}</Text>;
}

function Divider({ label }: { label: string }) {
  const c = useTheme();
  return (
    <View style={{ marginTop: 10, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>{label}</Text>
    </View>
  );
}

function ValueRow({ label, value, indented }: { label: string; value: string; indented: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 6, paddingLeft: indented ? 24 : 14, paddingRight: 14 }}>
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, color: c.text }}>{label}</Text>
      <Text style={[{ fontSize: 14, lineHeight: 19, fontWeight: '600', color: c.text, textAlign: 'right', maxWidth: '50%' }, TABULAR]}>{value}</Text>
    </View>
  );
}

/** Brackets or place rates: the title and row count, opening to the full table. */
function TableBlock({ item }: { item: Extract<TaxRuleItem, { type: 'table' }> }) {
  const c = useTheme();
  const [open, setOpen] = useState(item.rows.length <= 4);
  return (
    <View style={{ marginHorizontal: 10, marginVertical: 5, borderRadius: 12, backgroundColor: c.inner, overflow: 'hidden' }}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: c.text }}>{item.title}</Text>
        <Text style={{ fontSize: 12, color: c.muted }}>{item.rows.length} rows</Text>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} size={12} color={c.muted} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
            {item.columns.map((column, index) => (
              <Text key={column + index} style={{ flex: index === 0 ? 1.4 : 1, fontSize: 11, fontWeight: '600', color: c.muted, textAlign: index === 0 ? 'left' : 'right' }}>
                {column}
              </Text>
            ))}
          </View>
          {item.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={{ flexDirection: 'row', paddingVertical: 4 }}>
              {row.map((cell, index) => (
                <Text
                  key={index}
                  style={[{ flex: index === 0 ? 1.4 : 1, fontSize: 13, color: c.text, textAlign: index === 0 ? 'left' : 'right' }, TABULAR]}>
                  {cell}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
