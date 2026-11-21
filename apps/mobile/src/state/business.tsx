import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getBusiness } from '@/db/repo';
import type { Business } from '@/db/types';

interface BusinessState {
  /** `undefined` while the first read is in flight, `null` when setup has not been done. */
  business: Business | null | undefined;
  reload: () => Promise<void>;
}

const BusinessContext = createContext<BusinessState>({ business: undefined, reload: async () => {} });

/** Holds the single business record: it decides the theme and whether setup is needed. */
export function BusinessProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [business, setBusiness] = useState<Business | null | undefined>(undefined);

  const reload = useCallback(async () => {
    setBusiness(await getBusiness(db));
  }, [db]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <BusinessContext.Provider value={{ business, reload }}>{children}</BusinessContext.Provider>;
}

export function useBusinessState(): BusinessState {
  return useContext(BusinessContext);
}

/** For screens that are only reachable after setup. */
export function useBusiness(): Business {
  const { business } = useContext(BusinessContext);
  if (!business) throw new Error('This screen needs a business; setup has not been completed.');
  return business;
}
