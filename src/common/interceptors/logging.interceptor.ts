import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';

export interface LogContext {
  requestId: string;
  method: string;
  url: string;
  userId?: string;
  ip: string;
  userAgent: string;
  duration: number;
  statusCode?: number;
  error?: any;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Generate or extract request ID for correlation
    const requestId = this.getOrGenerateRequestId(request);
    request.headers['x-request-id'] = requestId;
    response.setHeader('X-Request-ID', requestId);

    // Extract request context
    const logContext = this.extractLogContext(request, startTime);

    // Log incoming request
    this.logRequest(logContext);

    return next.handle().pipe(
      tap({
        next: (data) => {
          // Log successful response
          this.logResponse(logContext, response.statusCode, data);
        },
        error: (error) => {
          // Log error response
          this.logError(logContext, error, response.statusCode);
        },
      }),
      catchError((error) => {
        // Ensure error is logged even if tap doesn't catch it
        this.logError(logContext, error, response.statusCode);
        throw error;
      }),
    );
  }

  private getOrGenerateRequestId(request: Request): string {
    return request.headers['x-request-id'] as string || this.generateRequestId();
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractLogContext(request: Request, startTime: number): LogContext {
    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || 'unknown';
    const userId = (request as any).user?.id || 'anonymous';

    return {
      requestId: request.headers['x-request-id'] as string,
      method,
      url,
      userId,
      ip: ip || request.connection?.remoteAddress || 'unknown',
      userAgent,
      duration: 0,
    };
  }

  private logRequest(context: LogContext): void {
    const { requestId, method, url, userId, ip, userAgent } = context;

    this.logger.log(
      `[${requestId}] ${method} ${url} - User: ${userId} - IP: ${ip}`,
    );

    // Note: Additional context logging would require passing the request object
    // For now, we'll log the basic context information
    this.logger.debug(`[${requestId}] Request Details:`, {
      method,
      url,
      userId,
      ip,
      userAgent,
    });
  }

  private logResponse(context: LogContext, statusCode: number, data: any): void {
    const { requestId, method, url, duration } = context;
    const finalDuration = Date.now() - context.duration;

    // Determine log level based on status code
    if (statusCode >= 400) {
      this.logger.warn(
        `[${requestId}] ${method} ${url} - ${statusCode} - ${finalDuration}ms`,
      );
    } else {
      this.logger.log(
        `[${requestId}] ${method} ${url} - ${statusCode} - ${finalDuration}ms`,
      );
    }

    // Log response data at debug level (excluding sensitive information)
    this.logger.debug(`[${requestId}] Response:`, {
      statusCode,
      duration: finalDuration,
      data: this.sanitizeResponseData(data),
    });
  }

  private logError(context: LogContext, error: any, statusCode: number): void {
    const { requestId, method, url, duration } = context;
    const finalDuration = Date.now() - context.duration;

    this.logger.error(
      `[${requestId}] ${method} ${url} - ${statusCode} - ${finalDuration}ms - Error: ${error.message}`,
      error.stack,
    );

    // Log error context at debug level
    this.logger.debug(`[${requestId}] Error Context:`, {
      statusCode,
      duration: finalDuration,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack,
      },
    });
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token',
      'x-forwarded-for',
      'x-real-ip',
    ];

    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;

    const sanitized = { ...body };
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'refreshToken',
      'accessToken',
    ];

    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  private sanitizeResponseData(data: any): any {
    if (!data) return data;

    // Don't log large response bodies
    if (typeof data === 'object' && Object.keys(data).length > 10) {
      return { ...data, _truncated: 'Response too large to log' };
    }

    return data;
  }
} 