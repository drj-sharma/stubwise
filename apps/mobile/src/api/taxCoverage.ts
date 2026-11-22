import type { UsStateCode } from '@stubwise/domain';
import { useEffect, useState } from 'react';
import { api } from './index';

/**
 * How the server handles each state's taxes, from its tax_rules table
 * (GET /v1/meta/tax-coverage): whether state income tax is calculated, what
 * the state's withholding certificate asks for, and which counties or cities
 * have a local tax. The app shows this; it never works out a tax itself.
 */

export interface CertificateField {
  /** `status`, `allowances`, `additionalAllowances`, `dependents`, or `options.<name>`. */
  key: string;
  label: string;
  kind: 'count' | 'choice' | 'switch' | 'money';
  options?: { value: string; label: string }[];
}

export interface StateCoverage {
  name: string;
  support: 'none' | 'manual' | 'calculated';
  taxes: { tax: string; method: string }[];
  certificate?: { form: string; fields: CertificateField[] } | null;
  source?: string;
  localities?: { choose: string; options: { code: string; name: string }[] };
}

export interface TaxCoverage {
  years: { year: number; federal: boolean; states: Record<string, StateCoverage> }[];
}

let cached: Promise<TaxCoverage> | null = null;

/** Fetched once per launch: the rules change at most a few times a year. */
export function getTaxCoverage(): Promise<TaxCoverage> {
  cached ??= api.request<TaxCoverage>('GET', '/v1/meta/tax-coverage', { auth: false }).catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** One state's coverage for a year (the latest loaded year at or before it), or undefined while loading. */
export function useStateCoverage(state: UsStateCode | null, year: number): StateCoverage | null | undefined {
  const [coverage, setCoverage] = useState<TaxCoverage | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    getTaxCoverage().then(
      (result) => live && setCoverage(result),
      () => live && setCoverage(null),
    );
    return () => {
      live = false;
    };
  }, []);
  if (coverage === undefined) return undefined;
  if (coverage === null || !state) return null;
  const entry = [...coverage.years].reverse().find((item) => item.year <= year) ?? coverage.years[coverage.years.length - 1];
  return entry?.states[state] ?? null;
}
