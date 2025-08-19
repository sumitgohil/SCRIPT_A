import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitService, RateLimitOptions } from '../services/rate-limit.service';

@Injectable()
export class RedisRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Get rate limit options from decorator metadata
    const rateLimitOptions = this.reflector.get<RateLimitOptions>('rate_limit', context.getHandler());
    
    if (!rateLimitOptions) {
      // No rate limiting configured for this endpoint
      return true;
    }

    // Create a unique identifier for rate limiting
    const identifier = this.createIdentifier(request);
    
    // Check rate limit
    const result = await this.rateLimitService.checkRateLimit(identifier, rateLimitOptions);
    
    if (!result.success) {
      // Rate limit exceeded
      throw new HttpException({
        status: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Rate limit exceeded',
        message: `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
        limit: result.limit,
        remaining: result.remaining,
        resetTime: new Date(result.resetTime).toISOString(),
        retryAfter: result.retryAfter,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Add rate limit headers to response
    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', result.limit);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
    
    return true;
  }

  private createIdentifier(request: any): string {
    // Create a more secure identifier that doesn't expose raw IP addresses
    const ip = request.ip || request.connection?.remoteAddress || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    const userId = request.user?.id || 'anonymous';
    
    // Hash the identifier to prevent enumeration attacks
    const identifier = `${userId}:${ip}:${userAgent}`;
    return this.hashString(identifier);
  }

  private hashString(str: string): string {
    // Simple hash function for demonstration
    // In production, use a proper cryptographic hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
