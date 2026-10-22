// Fixed-window in-memory rate limiter.
// shortcut: per-process memory, fine for the single-process deployment; use a shared store if you run several instances.
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return {
    /** Returns seconds to wait, or 0 if allowed. */
    take(key: string, now = Date.now()): number {
      if (hits.size > 10000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      const h = hits.get(key);
      if (!h || h.reset <= now) { hits.set(key, { n: 1, reset: now + windowMs }); return 0; }
      h.n++;
      return h.n > max ? Math.ceil((h.reset - now) / 1000) : 0;
    },
    reset(key: string) { hits.delete(key); },
  };
}
