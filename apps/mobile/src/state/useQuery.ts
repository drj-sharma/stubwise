import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

/**
 * Loads data from the server whenever the screen comes into focus, and again
 * on `reload()` or a pull-to-refresh (`refresh()`). What was loaded last stays
 * on screen while a reload is in flight, so returning to a screen never
 * flashes a spinner; `error` is set only when the latest load failed.
 */
export function useQuery<T>(load: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await load();
      if (ticket === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (caught) {
      if (ticket === latest.current) setError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  }, deps);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await run();
    } finally {
      setRefreshing(false);
    }
  }, [run]);

  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  return { data, error, reload: run, refresh, refreshing, setData };
}
