export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  readonly now?: () => number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number;
  readonly retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small fixed-window, in-memory rate limiter. It is intentionally per-process:
 * if the backend is scaled horizontally, put a shared limiter at the gateway.
 */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();
  private nextSweepAt: number;
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(options: RateLimitOptions) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.now = options.now ?? Date.now;
    this.nextSweepAt = this.now() + this.windowMs;
    this.sweepTimer = setInterval(
      () => this.sweep(this.now()),
      Math.max(this.windowMs, 60000),
    );
    this.sweepTimer.unref();
  }

  sweep(now = this.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
    this.nextSweepAt = now + this.windowMs;
  }

  check(key: string): RateLimitResult {
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

  close(): void {
    clearInterval(this.sweepTimer);
    this.buckets.clear();
  }
}
