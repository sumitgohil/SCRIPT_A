import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionService } from '../services/transaction.service';
import { CircuitBreakerService } from '../services/circuit-breaker.service';

@Global()
@Module({
  imports: [TypeOrmModule],
  providers: [TransactionService, CircuitBreakerService],
  exports: [TransactionService, CircuitBreakerService],
})
export class AdvancedPatternsModule {}
