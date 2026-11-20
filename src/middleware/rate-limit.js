'use strict';

/**
 * Small fixed-window, in-memory rate limiter. It is intentionally per-process:
 * if the backend is scaled horizontally, put a shared limiter at the gateway.
 */
class RateLimiter {
  constructor(options) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.now = options.now || Date.now;
    this.buckets = new Map();
    this.nextSweepAt = this.now() + this.windowMs;
    this.sweepTimer = setInterval(
      () => this.sweep(this.now()),
      Math.max(this.windowMs, 60000),
    );
    this.sweepTimer.unref();
  }

  sweep(now = this.now()) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
    this.nextSweepAt = now + this.windowMs;
  }

  check(key) {
    const now = this.now();

    if (now >= this.nextSweepAt) {
      this.sweep(now);
    }

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;

    return {
      allowed: bucket.count <= this.max,
      limit: this.max,
      remaining: Math.max(0, this.max - bucket.count),
      resetAt: bucket.resetAt,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  close() {
    clearInterval(this.sweepTimer);
    this.buckets.clear();
  }
}

module.exports = { RateLimiter };
