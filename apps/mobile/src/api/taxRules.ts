import { api } from './index';

/**
 * Every figure the server uses for federal tax or one state's taxes, already
 * laid out to read (GET /v1/meta/tax-rules): amounts and rates as text, and
 * brackets or county rates as tables. The app only draws them.
 */

export type TaxRuleItem =
  | { type: 'value'; label: string; value: string }
  | { type: 'table'; title: string; columns: string[]; rows: string[][] }
  | { type: 'heading'; label: string }
  | { type: 'note'; label: string };

export interface TaxRuleSection {
  title: string;
  status: 'calculated' | 'manual' | 'none';
  source: string | null;
  items: TaxRuleItem[];
}

export interface TaxRules {
  /** `US` for federal, else the state's code. */
  jurisdiction: string;
  name: string;
  year: number;
  sections: TaxRuleSection[];
}

const cache = new Map<string, Promise<TaxRules>>();

/** Fetched once per launch for each choice: the rules change at most a few times a year. */
export function getTaxRules(jurisdiction: string, year: number): Promise<TaxRules> {
  const key = `${jurisdiction}:${year}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = api.request<TaxRules>('GET', '/v1/meta/tax-rules', { auth: false, query: { jurisdiction, year } }).catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return pending;
}
