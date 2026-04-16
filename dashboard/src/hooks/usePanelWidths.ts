import { useCallback, useEffect, useRef, useState } from 'react';

const SIDEBAR_KEY = 'layout.sidebarWidth';
const REVIEW_KEY = 'layout.reviewWidth';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 240;

const REVIEW_MIN = 320;
const REVIEW_MAX = 720;
const REVIEW_DEFAULT = 380;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function fetchSetting(key: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/settings/${key}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { value?: string };
    const n = Number(body.value);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function saveSetting(key: string, value: number): Promise<void> {
  try {
    await fetch(`/api/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(Math.round(value)) }),
    });
  } catch {
    // Non-fatal; width will reset on restart.
  }
}

export function usePanelWidths() {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [reviewWidth, setReviewWidth] = useState(REVIEW_DEFAULT);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSetting(SIDEBAR_KEY), fetchSetting(REVIEW_KEY)]).then(([s, r]) => {
      if (cancelled) return;
      if (s !== null) setSidebarWidth(clamp(s, SIDEBAR_MIN, SIDEBAR_MAX));
      if (r !== null) setReviewWidth(clamp(r, REVIEW_MIN, REVIEW_MAX));
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resizeSidebar = useCallback((deltaPx: number) => {
    setSidebarWidth((prev) => clamp(prev + deltaPx, SIDEBAR_MIN, SIDEBAR_MAX));
  }, []);

  const resizeReview = useCallback((deltaPx: number) => {
    // Review panel sits on the right — dragging its handle right shrinks the panel.
    setReviewWidth((prev) => clamp(prev - deltaPx, REVIEW_MIN, REVIEW_MAX));
  }, []);

  const persistSidebar = useCallback(() => {
    if (!hydratedRef.current) return;
    void saveSetting(SIDEBAR_KEY, sidebarWidth);
  }, [sidebarWidth]);

  const persistReview = useCallback(() => {
    if (!hydratedRef.current) return;
    void saveSetting(REVIEW_KEY, reviewWidth);
  }, [reviewWidth]);

  return {
    sidebarWidth,
    reviewWidth,
    resizeSidebar,
    resizeReview,
    persistSidebar,
    persistReview,
  };
}
