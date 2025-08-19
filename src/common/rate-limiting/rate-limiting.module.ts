import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RateLimitService } from '../services/rate-limit.service';
import { RedisRateLimitGuard } from '../guards/redis-rate-limit.guard';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RateLimitService, RedisRateLimitGuard],
  exports: [RateLimitService, RedisRateLimitGuard],
})
export class RateLimitingModule {}
