import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isConflict } from '@/api';
import { type BusinessPatch, getBusiness, updateBusiness } from '@/api/records';
import type { Business } from '@/db/types';
import { useAuth } from './auth';

interface BusinessState {
  /** `undefined` while loading (or signed out), `null` when the account has no business yet. */
  business: Business | null | undefined;
  /** Why the last load failed, if it did. */
  error: string | null;
  reload: () => Promise<void>;
  /** Takes a business the server just returned (after setup, say). */
  setBusiness: (business: Business) => void;
  /**
   * Changes settings: shown at once, then replaced by the server's copy. On
   * failure the old values come back (or, after a 412, the server's current
   * ones) and the error is thrown for the screen to show.
   */
  update: (patch: BusinessPatch) => Promise<void>;
}

const BusinessContext = createContext<BusinessState>({
  business: undefined,
  error: null,
  reload: async () => {},
  setBusiness: () => {},
  update: async () => {},
});

/** Holds the signed-in user's business: it decides the theme and whether setup is needed. */
export function BusinessProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [business, setBusinessState] = useState<Business | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Business | null | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const setBusiness = useCallback((next: Business | null | undefined) => {
    current.current = next;
    setBusinessState(next);
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setBusiness(await getBusiness());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your business.');
    }
  }, [setBusiness]);

  const userId = status === 'signed-in' ? user?.id : null;
  useEffect(() => {
    setBusiness(undefined);
    setError(null);
    if (userId) void reload();
  }, [userId, reload, setBusiness]);

  const update = useCallback(
    (patch: BusinessPatch): Promise<void> => {
      const before = current.current;
      if (!before) return Promise.resolve();
      setBusiness({ ...before, ...patch } as Business);
      // One change at a time, each sent with the version the previous one produced.
      const run = queue.current.then(async () => {
        const latest = current.current ?? before;
        try {
          setBusiness(await updateBusiness(latest.version, patch));
        } catch (caught) {
          if (isConflict(caught)) await reload();
          else setBusiness(before);
          throw caught;
        }
      });
      queue.current = run.catch(() => {});
      return run;
    },
    [reload, setBusiness],
  );

  const value = useMemo(() => ({ business, error, reload, setBusiness, update }), [business, error, reload, setBusiness, update]);
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusinessState(): BusinessState {
  return useContext(BusinessContext);
}

/**
 * For screens that are only reachable after setup. While signing out, those
 * screens render once more before they are taken away; they get the last
 * business they saw rather than crashing.
 */
export function useBusiness(): Business {
  const { business } = useContext(BusinessContext);
  const [last, setLast] = useState<Business | null>(business ?? null);
  if (business && business !== last) setLast(business);
  const shown = business ?? last;
  if (!shown) throw new Error('This screen needs a business; setup has not been completed.');
  return shown;
}
