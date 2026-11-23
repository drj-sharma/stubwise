import { type UsStateCode, usStateName } from '@stubwise/domain';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useStateCoverage } from '@/api/taxCoverage';
import { Group, SettingsPage } from '@/features/SettingsPage';
import { useBusiness, useBusinessState } from '@/state/business';
import { Icon, Pill, Row } from '@/ui/primitives';
import { StateSheet } from '@/ui/sheets';
import { alertError } from '@/ui/states';
import { useTheme } from '@/ui/theme';

const TAX_NAMES: Record<string, string> = {
  income: 'State income tax',
  sdi: 'Disability insurance',
  fli: 'Family leave insurance',
  pfml: 'Paid family and medical leave',
  ui: 'Unemployment (worker share)',
  ltc: 'Long-term care',
  transit: 'Transit tax',
  local: 'County and city taxes',
};

/**
 * Which taxes CrewStub works out for the business's state, as the server's
 * tax rules describe them. Each worker's own forms (W-4 and the state's) are
 * on that worker's page.
 */
export default function TaxSettings() {
  const c = useTheme();
  const business = useBusiness();
  const { update } = useBusinessState();
  const [picking, setPicking] = useState(false);
  const year = new Date().getFullYear();
  const coverage = useStateCoverage(business.state, year);

  const setState = (state: UsStateCode): void => {
    setPicking(false);
    update({ state }).catch((error: unknown) => alertError('Could not change the state', error));
  };

  const status = (method: string, tax: string) =>
    method === 'none' ? (
      <Pill tone="success" label={tax === 'income' ? 'None in this state' : 'None'} />
    ) : method === 'manual' ? (
      <Pill tone="warn" label="You type it" />
    ) : (
      <Pill tone="success" label="Calculated" />
    );

  return (
    <SettingsPage title="Tax settings">
      <Group>
        <Row
          title={business.state ? usStateName(business.state) : 'Choose your state'}
          subtitle="Business state · used for workers with no state of their own"
          minHeight={58}
          strong={business.state !== null}
          right={<Icon name="chevron.down" size={14} color={c.muted} />}
          onPress={() => setPicking(true)}
          last
        />
      </Group>

      <Group>
        <View style={{ padding: 14, paddingBottom: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>Federal</Text>
        </View>
        <Row title="Federal income tax" subtitle="From each worker’s Form W-4" minHeight={56} right={<Pill tone="success" label="Calculated" />} />
        <Row title="Social Security and Medicare" minHeight={52} right={<Pill tone="success" label="Calculated" />} last />
      </Group>

      {business.state && coverage ? (
        <Group>
          <View style={{ padding: 14, paddingBottom: 6 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>
              {coverage.name}, {year}
            </Text>
          </View>
          {coverage.taxes.map((entry, index) => (
            <Row
              key={entry.tax}
              title={TAX_NAMES[entry.tax] ?? entry.tax}
              minHeight={52}
              right={status(entry.method, entry.tax)}
              last={index === coverage.taxes.length - 1 && !coverage.source}
            />
          ))}
          {coverage.source ? (
            <Pressable
              onPress={() => void Linking.openURL(coverage.source!)}
              accessibilityRole="link"
              style={({ pressed }) => ({ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.6 : 1 })}>
              <Icon name="doc.text.magnifyingglass" size={15} color={c.primaryText} />
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: c.primaryText }}>The state’s withholding guide these come from</Text>
            </Pressable>
          ) : null}
        </Group>
      ) : null}

      <Text style={{ fontSize: 12, lineHeight: 18, color: c.muted, marginHorizontal: 6 }}>
        {coverage?.localities
          ? `Each worker’s ${coverage.localities.choose.toLowerCase()} for local tax, and their W-4 and state form, are on their page under Edit.`
          : 'Each worker’s W-4 and state withholding form are on their page under Edit.'}{' '}
        A tax marked “You type it” gets a line on each stub for you to fill in.
      </Text>

      <StateSheet visible={picking} selected={business.state} onSelect={setState} onClose={() => setPicking(false)} />
    </SettingsPage>
  );
}
