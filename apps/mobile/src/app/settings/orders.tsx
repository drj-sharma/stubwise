import { formatCents, formatShortDate } from '@stubwise/domain';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { listOrders } from '@/api/orders';
import { Group, SettingsPage } from '@/features/SettingsPage';
import { useQuery } from '@/state/useQuery';
import { Icon, Pill, Row, TABULAR } from '@/ui/primitives';
import { ErrorState, Loading } from '@/ui/states';
import { useTheme } from '@/ui/theme';

/** Every pay stub paid for, newest first, as the server recorded the payment. */
export default function OrderHistory() {
  const c = useTheme();
  const { data, error, reload, refresh, refreshing } = useQuery(listOrders);

  let content;
  if (data === undefined) {
    content = error ? <ErrorState title="Could not load your orders" error={error} onRetry={() => void reload()} /> : <Loading label="Loading orders…" />;
  } else if (data.length === 0) {
    content = (
      <Group>
        <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.warnBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="receipt" size={22} color={c.warnText} />
          </View>
          <Text style={{ fontSize: 16, fontWeight: '600', color: c.text }}>No purchases yet</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: c.muted, textAlign: 'center' }}>Each pay stub you pay for shows here, with the date and the amount.</Text>
        </View>
      </Group>
    );
  } else {
    const paid = data.filter((order) => order.status === 'paid').reduce((sum, order) => sum + order.amountCents, 0);
    content = (
      <>
        <Group>
          <View style={{ padding: 14, gap: 2 }}>
            <Text style={{ fontSize: 12, color: c.muted }}>Total paid</Text>
            <Text style={[{ fontSize: 24, fontWeight: '700', color: c.text }, TABULAR]}>{formatCents(paid)}</Text>
            <Text style={{ fontSize: 13, color: c.muted }}>
              {data.length} {data.length === 1 ? 'purchase' : 'purchases'}
            </Text>
          </View>
        </Group>
        <Group>
          {data.map((order, index) => (
            <Row
              key={order.id}
              title={`Pay stub · ${order.workerName}`}
              subtitle={`Paid ${formatShortDate(order.createdAt.slice(0, 10))} · stub dated ${formatShortDate(order.payDate)}`}
              minHeight={60}
              last={index === data.length - 1}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={[{ fontSize: 14, fontWeight: '700', color: c.text }, TABULAR]}>{formatCents(order.amountCents)}</Text>
                  {order.status === 'refunded' ? <Pill tone="warn" label="Refunded" /> : null}
                </View>
              }
              onPress={order.stubId ? () => router.push(`/stub/${order.stubId}`) : undefined}
            />
          ))}
        </Group>
      </>
    );
  }

  return (
    <SettingsPage title="Order history" refreshing={refreshing} onRefresh={() => void refresh()}>
      {content}
    </SettingsPage>
  );
}
