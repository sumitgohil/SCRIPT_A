import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface CacheOptions {
  ttl?: number;
  namespace?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  memoryUsage: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;
  private readonly defaultTTL = 300; // 5 minutes
  private readonly defaultNamespace = 'cache';
  private readonly stats = { hits: 0, misses: 0 };

  constructor(private readonly configService: ConfigService) {
    // Initialize Redis connection for distributed caching
    this.redis = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keyPrefix: `${this.defaultNamespace}:`,
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis cache connection error:', error);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis cache connected successfully');
    });

    // Set up periodic cleanup and monitoring
    this.setupPeriodicTasks();
  }

  /**
   * Set a value in the cache with optional TTL and namespace
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    try {
      const { ttl = this.defaultTTL, namespace = this.defaultNamespace } = options;
      const fullKey = this.buildKey(key, namespace);
      
      // Serialize the value to JSON for storage
      const serializedValue = JSON.stringify(value);
      
      // Use Redis SETEX for atomic set with expiration
      await this.redis.setex(fullKey, ttl, serializedValue);
      
      this.logger.debug(`Cache SET: ${fullKey} (TTL: ${ttl}s)`);
    } catch (error) {
      this.logger.error(`Cache SET failed for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get a value from the cache
   */
  async get<T>(key: string, namespace: string = this.defaultNamespace): Promise<T | null> {
    try {
      const fullKey = this.buildKey(key, namespace);
      const value = await this.redis.get(fullKey);
      
      if (value === null) {
        this.stats.misses++;
        this.logger.debug(`Cache MISS: ${fullKey}`);
        return null;
      }
      
      this.stats.hits++;
      this.logger.debug(`Cache HIT: ${fullKey}`);
      
      // Deserialize the value from JSON
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Cache GET failed for key ${key}:`, error);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Delete a key from the cache
   */
  async delete(key: string, namespace: string = this.defaultNamespace): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, namespace);
      const result = await this.redis.del(fullKey);
      
      this.logger.debug(`Cache DELETE: ${fullKey} (result: ${result})`);
      return result > 0;
    } catch (error) {
      this.logger.error(`Cache DELETE failed for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Check if a key exists in the cache
   */
  async has(key: string, namespace: string = this.defaultNamespace): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, namespace);
      const exists = await this.redis.exists(fullKey);
      
      return exists > 0;
    } catch (error) {
      this.logger.error(`Cache HAS check failed for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Clear all keys in a namespace
   */
  async clear(namespace: string = this.defaultNamespace): Promise<void> {
    try {
      const pattern = `${this.defaultNamespace}:${namespace}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cache CLEAR: Removed ${keys.length} keys from namespace ${namespace}`);
      }
    } catch (error) {
      this.logger.error(`Cache CLEAR failed for namespace ${namespace}:`, error);
      throw error;
    }
  }

  /**
   * Get multiple values at once
   */
  async mget<T>(keys: string[], namespace: string = this.defaultNamespace): Promise<(T | null)[]> {
    try {
      const fullKeys = keys.map(key => this.buildKey(key, namespace));
      const values = await this.redis.mget(...fullKeys);
      
      return values.map(value => {
        if (value === null) {
          this.stats.misses++;
          return null;
        }
        this.stats.hits++;
        try {
          return JSON.parse(value) as T;
        } catch {
          return null;
        }
      });
    } catch (error) {
      this.logger.error(`Cache MGET failed for keys:`, error);
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple values at once
   */
  async mset<T>(entries: Array<{ key: string; value: T }>, options: CacheOptions = {}): Promise<void> {
    try {
      const { ttl = this.defaultTTL, namespace = this.defaultNamespace } = options;
      const pipeline = this.redis.pipeline();
      
      entries.forEach(({ key, value }) => {
        const fullKey = this.buildKey(key, namespace);
        const serializedValue = JSON.stringify(value);
        pipeline.setex(fullKey, ttl, serializedValue);
      });
      
      await pipeline.exec();
      this.logger.debug(`Cache MSET: Set ${entries.length} keys in namespace ${namespace}`);
    } catch (error) {
      this.logger.error(`Cache MSET failed:`, error);
      throw error;
    }
  }

  /**
   * Increment a numeric value
   */
  async increment(key: string, value: number = 1, namespace: string = this.defaultNamespace): Promise<number> {
    try {
      const fullKey = this.buildKey(key, namespace);
      const result = await this.redis.incrby(fullKey, value);
      
      this.logger.debug(`Cache INCREMENT: ${fullKey} by ${value} = ${result}`);
      return result;
    } catch (error) {
      this.logger.error(`Cache INCREMENT failed for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const info = await this.redis.info('memory');
      const keys = await this.redis.dbsize();
      
      return {
        hits: this.stats.hits,
        misses: this.stats.misses,
        keys,
        memoryUsage: this.parseMemoryUsage(info),
      };
    } catch (error) {
      this.logger.error('Failed to get cache stats:', error);
      return {
        hits: this.stats.hits,
        misses: this.stats.misses,
        keys: 0,
        memoryUsage: 0,
      };
    }
  }

  /**
   * Get cache hit ratio
   */
  getHitRatio(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Build a full cache key with namespace
   */
  private buildKey(key: string, namespace: string): string {
    return `${namespace}:${key}`;
  }

  /**
   * Parse memory usage from Redis INFO command
   */
  private parseMemoryUsage(info: string): number {
    const match = info.match(/used_memory_human:(\S+)/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[1].replace(/[\d.]/g, '');
      const multiplier = unit === 'K' ? 1024 : unit === 'M' ? 1024 * 1024 : unit === 'G' ? 1024 * 1024 * 1024 : 1;
      return value * multiplier;
    }
    return 0;
  }

  /**
   * Set up periodic tasks for cache maintenance
   */
  private setupPeriodicTasks(): void {
    // Clean up expired keys every 5 minutes
    setInterval(async () => {
      try {
        await this.cleanupExpiredKeys();
      } catch (error) {
        this.logger.error('Periodic cleanup failed:', error);
      }
    }, 5 * 60 * 1000);

    // Log cache statistics every 10 minutes
    setInterval(() => {
      const hitRatio = this.getHitRatio();
      this.logger.log(`Cache stats - Hit ratio: ${(hitRatio * 100).toFixed(2)}%, Hits: ${this.stats.hits}, Misses: ${this.stats.misses}`);
    }, 10 * 60 * 1000);
  }

  /**
   * Clean up expired keys
   */
  private async cleanupExpiredKeys(): Promise<void> {
    try {
      // Redis automatically handles key expiration, but we can add additional cleanup logic here
      this.logger.debug('Cache cleanup completed');
    } catch (error) {
      this.logger.error('Cache cleanup failed:', error);
    }
  }

  /**
   * Gracefully close Redis connection
   */
  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Redis cache connection closed');
    }
  }
} 