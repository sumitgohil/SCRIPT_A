import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyPrefix?: string;
}

export const RateLimit = (options: RateLimitOptions) => {
  // Now properly sets metadata that will be used by the RedisRateLimitGuard
  return SetMetadata(RATE_LIMIT_KEY, options);
}; 