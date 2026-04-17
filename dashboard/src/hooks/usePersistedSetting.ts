import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

const SAVE_DEBOUNCE_MS = 300;

async function fetchSetting(key: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/settings/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { value?: string };
    return typeof body.value === 'string' ? body.value : null;
  } catch {
    return null;
  }
}

async function saveSetting(key: string, value: string): Promise<void> {
  try {
    await fetch(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  } catch {
    // Non-fatal — settings will revert on restart.
  }
}

/**
 * Backend-settings-table-backed useState. Hydrates async on mount via
 * `/api/settings/:key`; subsequent state changes are debounced and persisted.
 */
export function usePersistedSetting<T>(
  key: string,
  defaultValue: T,
  isValid?: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(defaultValue);
  const hydratedRef = useRef(false);
  const lastSavedRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSetting(key).then((raw) => {
      if (cancelled) return;
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!isValid || isValid(parsed)) {
            lastSavedRef.current = raw;
            setState(parsed as T);
            hydratedRef.current = true;
            return;
          }
        } catch {
          // Ignore malformed values — fall through to default.
        }
      }
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const serialized = JSON.stringify(state);
    if (serialized === lastSavedRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      lastSavedRef.current = serialized;
      void saveSetting(key, serialized);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [key, state]);

  return [state, setState];
}
