/** Fixed-window rate limiter per (bucket, key). In-memory; good enough for one process. */
export class RateLimiter {
  /** @param {Record<string, {limit: number, windowMs: number}>} buckets */
  constructor(buckets, now = () => Date.now(), { sweepEvery = 1000 } = {}) {
    this.buckets = buckets;
    this.now = now;
    this.counters = new Map();
    this.sweepEvery = sweepEvery;
    this.sinceSweep = 0;
  }

  /** Counts one hit; returns { ok, remaining, retryAfterSec }. */
  hit(bucket, key) {
    const cfg = this.buckets[bucket];
    if (!cfg) return { ok: true, remaining: Infinity, retryAfterSec: 0 };
    const id = `${bucket}:${key}`;
    const t = this.now();
    let c = this.counters.get(id);
    if (!c || t - c.start >= cfg.windowMs) { c = { start: t, count: 0, windowMs: cfg.windowMs }; this.counters.set(id, c); }
    c.count += 1;
    if (++this.sinceSweep >= this.sweepEvery) this.sweep(t);
    const ok = c.count <= cfg.limit;
    return { ok, remaining: Math.max(0, cfg.limit - c.count), retryAfterSec: ok ? 0 : Math.ceil((c.start + cfg.windowMs - t) / 1000) };
  }

  /** Drops the counters whose own window ended. Runs once every `sweepEvery` hits, not on every hit. */
  sweep(t = this.now()) {
    this.sinceSweep = 0;
    for (const [k, v] of this.counters) if (t - v.start >= v.windowMs) this.counters.delete(k);
    return this.counters.size;
  }

  status(bucket, key) {
    const cfg = this.buckets[bucket];
    if (!cfg) return { limit: Infinity, windowSec: 0, used: 0, remaining: Infinity };
    const c = this.counters.get(`${bucket}:${key}`);
    const t = this.now();
    const used = c && t - c.start < cfg.windowMs ? c.count : 0;
    return { limit: cfg.limit, windowSec: cfg.windowMs / 1000, used, remaining: Math.max(0, cfg.limit - used) };
  }
}
