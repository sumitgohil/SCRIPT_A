import { Injectable, Logger } from '@nestjs/common';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',      // Normal operation
  OPEN = 'OPEN',          // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service is back
}

export interface CircuitBreakerOptions {
  failureThreshold: number;      // Number of failures before opening
  recoveryTimeout: number;       // Time to wait before trying again (ms)
  expectedResponseTime: number;  // Expected response time (ms)
  monitoringWindow: number;      // Time window for monitoring (ms)
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();

  /**
   * Executes a function with circuit breaker protection
   */
  async execute<T>(
    serviceName: string,
    operation: () => Promise<T>,
    options: Partial<CircuitBreakerOptions> = {},
  ): Promise<T> {
    const circuitBreaker = this.getOrCreateCircuitBreaker(serviceName, options);
    return circuitBreaker.execute(operation);
  }

  /**
   * Gets or creates a circuit breaker for a service
   */
  private getOrCreateCircuitBreaker(
    serviceName: string,
    options: Partial<CircuitBreakerOptions>,
  ): CircuitBreaker {
    if (!this.circuitBreakers.has(serviceName)) {
      const defaultOptions: CircuitBreakerOptions = {
        failureThreshold: 5,
        recoveryTimeout: 30000, // 30 seconds
        expectedResponseTime: 5000, // 5 seconds
        monitoringWindow: 60000, // 1 minute
        ...options,
      };
      
      this.circuitBreakers.set(serviceName, new CircuitBreaker(serviceName, defaultOptions, this.logger));
    }
    
    return this.circuitBreakers.get(serviceName)!;
  }

  /**
   * Gets the status of all circuit breakers
   */
  getStatus(): Record<string, { state: CircuitBreakerState; failureCount: number; lastFailure?: Date }> {
    const status: Record<string, any> = {};
    
    for (const [serviceName, circuitBreaker] of this.circuitBreakers) {
      status[serviceName] = circuitBreaker.getStatus();
    }
    
    return status;
  }

  /**
   * Manually resets a circuit breaker
   */
  reset(serviceName: string): void {
    const circuitBreaker = this.circuitBreakers.get(serviceName);
    if (circuitBreaker) {
      circuitBreaker.resetCircuitBreaker();
      this.logger.log(`Circuit breaker for ${serviceName} manually reset`);
    }
  }
}

class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailure?: Date;
  private lastStateChange = Date.now();
  private consecutiveSuccesses = 0;

  constructor(
    private readonly serviceName: string,
    private readonly options: CircuitBreakerOptions,
    private readonly logger: Logger,
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionToHalfOpen();
      } else {
        throw new Error(`Circuit breaker for ${this.serviceName} is OPEN`);
      }
    }

    try {
      const startTime = Date.now();
      const result = await operation();
      const responseTime = Date.now() - startTime;

      this.onSuccess(responseTime);
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private onSuccess(responseTime: number): void {
    this.failureCount = 0;
    this.consecutiveSuccesses++;
    
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= Math.ceil(this.options.failureThreshold / 2)) {
        this.transitionToClosed();
      }
    }
    
    this.logger.debug(`${this.serviceName} operation succeeded in ${responseTime}ms`);
  }

  private onFailure(error: any): void {
    this.failureCount++;
    this.lastFailure = new Date();
    this.consecutiveSuccesses = 0;
    
    if (this.failureCount >= this.options.failureThreshold) {
      this.transitionToOpen();
    }
    
    this.logger.warn(`${this.serviceName} operation failed (${this.failureCount}/${this.options.failureThreshold}):`, error.message);
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailure) return false;
    
    const timeSinceLastFailure = Date.now() - this.lastFailure.getTime();
    return timeSinceLastFailure >= this.options.recoveryTimeout;
  }

  private transitionToOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.lastStateChange = Date.now();
    this.logger.warn(`Circuit breaker for ${this.serviceName} is now OPEN`);
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HALF_OPEN;
    this.lastStateChange = Date.now();
    this.logger.log(`Circuit breaker for ${this.serviceName} is now HALF_OPEN`);
  }

  private transitionToClosed(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.lastStateChange = Date.now();
    this.failureCount = 0;
    this.consecutiveSuccesses = 0;
    this.logger.log(`Circuit breaker for ${this.serviceName} is now CLOSED`);
  }

  private reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailure = undefined;
    this.lastStateChange = Date.now();
  }

  public resetCircuitBreaker(): void {
    this.reset();
  }

  getStatus(): { state: CircuitBreakerState; failureCount: number; lastFailure?: Date } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailure: this.lastFailure,
    };
  }
}
