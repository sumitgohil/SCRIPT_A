import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyPrefix?: string;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: Redis;
  private readonly defaultOptions: RateLimitOptions = {
    limit: 100,
    windowMs: 60000, // 1 minute
    keyPrefix: 'rate_limit:',
  };

  constructor(private readonly configService: ConfigService) {
    // Initialize Redis connection
    this.redis = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });
  }

  async checkRateLimit(
    identifier: string,
    options: Partial<RateLimitOptions> = {},
  ): Promise<RateLimitResult> {
    const opts = { ...this.defaultOptions, ...options };
    const key = `${opts.keyPrefix}${identifier}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();
      
      // Remove expired entries
      pipeline.zremrangebyscore(key, 0, windowStart);
      
      // Count current requests in window
      pipeline.zcard(key);
      
      // Add current request
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      
      // Set expiration on the key
      pipeline.expire(key, Math.ceil(opts.windowMs / 1000));
      
      const results = await pipeline.exec();
      
      if (!results || results.length < 4) {
        this.logger.error('Redis pipeline execution failed');
        return this.createAllowResult(opts.limit, opts.windowMs);
      }

      const currentCount = results[1][1] as number;
      const remaining = Math.max(0, opts.limit - currentCount);
      const resetTime = now + opts.windowMs;

      if (currentCount >= opts.limit) {
        return {
          success: false,
          limit: opts.limit,
          remaining: 0,
          resetTime,
          retryAfter: Math.ceil((resetTime - now) / 1000),
        };
      }

      return {
        success: true,
        limit: opts.limit,
        remaining: remaining - 1, // Subtract 1 for current request
        resetTime,
      };
    } catch (error) {
      this.logger.error('Rate limit check failed:', error);
      // On Redis failure, allow the request to prevent service disruption
      return this.createAllowResult(opts.limit, opts.windowMs);
    }
  }

  async getRateLimitInfo(identifier: string, options: Partial<RateLimitOptions> = {}): Promise<RateLimitResult> {
    const opts = { ...this.defaultOptions, ...options };
    const key = `${opts.keyPrefix}${identifier}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    try {
      // Remove expired entries and get count
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      
      const results = await pipeline.exec();
      
      if (!results || results.length < 2) {
        return this.createAllowResult(opts.limit, opts.windowMs);
      }

      const currentCount = results[1][1] as number;
      const remaining = Math.max(0, opts.limit - currentCount);
      const resetTime = now + opts.windowMs;

      return {
        success: currentCount < opts.limit,
        limit: opts.limit,
        remaining,
        resetTime,
      };
    } catch (error) {
      this.logger.error('Get rate limit info failed:', error);
      return this.createAllowResult(opts.limit, opts.windowMs);
    }
  }

  async resetRateLimit(identifier: string, options: Partial<RateLimitOptions> = {}): Promise<void> {
    const opts = { ...this.defaultOptions, ...options };
    const key = `${opts.keyPrefix}${identifier}`;

    try {
      await this.redis.del(key);
      this.logger.debug(`Rate limit reset for identifier: ${identifier}`);
    } catch (error) {
      this.logger.error('Rate limit reset failed:', error);
    }
  }

  async cleanupExpiredKeys(): Promise<void> {
    try {
      // This method can be called periodically to clean up expired keys
      // Redis automatically expires keys, but this provides additional cleanup
      const pattern = `${this.defaultOptions.keyPrefix}*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        const pipeline = this.redis.pipeline();
        keys.forEach(key => {
          pipeline.expire(key, Math.ceil(this.defaultOptions.windowMs / 1000));
        });
        await pipeline.exec();
        this.logger.debug(`Cleaned up ${keys.length} rate limit keys`);
      }
    } catch (error) {
      this.logger.error('Rate limit cleanup failed:', error);
    }
  }

  private createAllowResult(limit: number, windowMs: number): RateLimitResult {
    return {
      success: true,
      limit,
      remaining: limit - 1,
      resetTime: Date.now() + windowMs,
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
