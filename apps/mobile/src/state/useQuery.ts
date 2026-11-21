import { useFocusEffect } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';

/**
 * Loads data from the on-device database whenever the screen comes into
 * focus, and again on `reload()`. SQLite reads take a few milliseconds, so
 * re-reading on focus keeps every screen current without a global store.
 */
export function useQuery<T>(load: (db: SQLiteDatabase) => Promise<T>, deps: readonly unknown[] = []) {
  const db = useSQLiteContext();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await load(db);
      if (ticket === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (caught) {
      if (ticket === latest.current) setError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  }, [db, ...deps]);

  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  return { data, error, reload: run };
}
