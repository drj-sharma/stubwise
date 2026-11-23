import { api } from './index';

/** A pay stub the user paid for. Written by the server when the payment is confirmed. */
export interface Order {
  id: string;
  /** Null once the stub has been deleted; the receipt stays. */
  stubId: string | null;
  workerName: string;
  payDate: string;
  amountCents: number;
  currency: string;
  status: 'paid' | 'refunded';
  provider: string;
  createdAt: string;
}

/** Every purchase, newest first. */
export async function listOrders(): Promise<Order[]> {
  const items: Order[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.request<{ items: Order[]; nextCursor: string | null }>('GET', '/v1/orders', { query: { limit: 200, cursor } });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
