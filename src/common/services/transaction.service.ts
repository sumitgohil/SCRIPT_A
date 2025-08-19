import { Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';

export interface TransactionOptions {
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  timeout?: number;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Executes a function within a database transaction
   */
  async executeInTransaction<T>(
    operation: (queryRunner: QueryRunner) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction(options.isolationLevel);
      
      this.logger.debug('Transaction started');
      
      const result = await operation(queryRunner);
      
      await queryRunner.commitTransaction();
      this.logger.debug('Transaction committed successfully');
      
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Transaction rolled back due to error:', error);
      throw error;
    } finally {
      await queryRunner.release();
      this.logger.debug('Transaction query runner released');
    }
  }

  /**
   * Executes multiple operations in a single transaction
   */
  async executeMultipleInTransaction<T>(
    operations: Array<(queryRunner: QueryRunner) => Promise<T>>,
    options: TransactionOptions = {},
  ): Promise<T[]> {
    return this.executeInTransaction(async (queryRunner) => {
      const results: T[] = [];
      
      for (const operation of operations) {
        const result = await operation(queryRunner);
        results.push(result);
      }
      
      return results;
    }, options);
  }

  /**
   * Executes operations with retry logic for transient failures
   */
  async executeWithRetry<T>(
    operation: (queryRunner: QueryRunner) => Promise<T>,
    maxRetries: number = 3,
    backoffMs: number = 100,
    options: TransactionOptions = {},
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeInTransaction(operation, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if this is a retryable error
        if (this.isRetryableError(error) && attempt < maxRetries) {
          const delay = backoffMs * Math.pow(2, attempt - 1); // Exponential backoff
          this.logger.warn(`Transaction attempt ${attempt} failed, retrying in ${delay}ms:`, lastError.message);
          await this.sleep(delay);
        } else {
          break;
        }
      }
    }
    
    if (lastError) {
      throw lastError;
    }
    
    throw new Error('Transaction failed after all retry attempts');
  }

  /**
   * Checks if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Common retryable database errors
    const retryableErrors = [
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT',
      'ER_QUERY_INTERRUPTED',
      'ER_CONNECTION_LOST',
      'ER_SERVER_SHUTDOWN',
    ];
    
    return retryableErrors.some(retryableError => 
      error.message?.includes(retryableError) || error.code === retryableError
    );
  }

  /**
   * Utility method for sleeping
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gets the current transaction status
   */
  async getTransactionStatus(): Promise<{
    isActive: boolean;
    isolationLevel: string;
    inTransaction: boolean;
  }> {
    const queryRunner = this.dataSource.createQueryRunner();
    
    try {
      await queryRunner.connect();
      
      // Get current transaction status
      const result = await queryRunner.query('SELECT tx_isolation() as isolation_level');
      
      return {
        isActive: queryRunner.isTransactionActive,
        isolationLevel: result[0]?.isolation_level || 'unknown',
        inTransaction: queryRunner.isTransactionActive,
      };
    } finally {
      await queryRunner.release();
    }
  }
}
