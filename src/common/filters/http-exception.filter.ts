import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

export interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: string;
  path: string;
  timestamp: string;
  requestId?: string;
  details?: any;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as any;

    // Extract request ID for correlation
    const requestId = request.headers['x-request-id'] as string || this.generateRequestId();
    
    // Log error with appropriate level based on status code
    this.logError(exception, request, requestId, status);

    // Format error response without exposing sensitive information
    const errorResponse = this.formatErrorResponse(exception, request, requestId, status);

    // Set response headers
    response.setHeader('X-Request-ID', requestId);
    response.status(status).json(errorResponse);
  }

  private logError(exception: HttpException, request: Request, requestId: string, status: number): void {
    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || 'unknown';
    const userId = (request as any).user?.id || 'anonymous';
    const errorMessage = exception.message;
    const stack = exception.stack;

    // Determine log level based on status code
    if (status >= 500) {
      this.logger.error(
        `[${requestId}] Server Error: ${method} ${url} - User: ${userId} - IP: ${ip} - ${errorMessage}`,
        stack,
      );
    } else if (status >= 400) {
      this.logger.warn(
        `[${requestId}] Client Error: ${method} ${url} - User: ${userId} - IP: ${ip} - ${errorMessage}`,
      );
    } else {
      this.logger.log(
        `[${requestId}] HTTP Exception: ${method} ${url} - User: ${userId} - IP: ${ip} - ${errorMessage}`,
      );
    }

    // Log additional context for debugging
    this.logger.debug(`[${requestId}] Request Context:`, {
      method,
      url,
      userId,
      ip,
      userAgent,
      headers: this.sanitizeHeaders(request.headers),
      body: this.sanitizeBody(request.body),
      query: request.query,
      params: request.params,
    });
  }

  private formatErrorResponse(exception: HttpException, request: Request, requestId: string, status: number): ErrorResponse {
    const exceptionResponse = exception.getResponse() as any;
    
    // Base error response
    const errorResponse: ErrorResponse = {
      success: false,
      statusCode: status,
      message: this.getErrorMessage(exception, status),
      error: this.getErrorType(status),
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId,
    };

    // Add additional details for client errors (4xx) but not server errors (5xx)
    if (status >= 400 && status < 500) {
      if (exceptionResponse?.message) {
        errorResponse.details = Array.isArray(exceptionResponse.message) 
          ? exceptionResponse.message 
          : [exceptionResponse.message];
      }
      
      // Include validation errors if available
      if (exceptionResponse?.errors) {
        errorResponse.details = exceptionResponse.errors;
      }
    }

    return errorResponse;
  }

  private getErrorMessage(exception: HttpException, status: number): string {
    const exceptionResponse = exception.getResponse() as any;
    
    // Customize messages based on status code
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Invalid request data provided';
      case HttpStatus.UNAUTHORIZED:
        return 'Authentication required';
      case HttpStatus.FORBIDDEN:
        return 'Access denied';
      case HttpStatus.NOT_FOUND:
        return 'Resource not found';
      case HttpStatus.CONFLICT:
        return 'Resource conflict';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'Rate limit exceeded';
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 'Internal server error';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'Service temporarily unavailable';
      default:
        return exception.message || 'An error occurred';
    }
  }

  private getErrorType(status: number): string {
    if (status >= 500) return 'Internal Server Error';
    if (status >= 400) return 'Client Error';
    if (status >= 300) return 'Redirection';
    if (status >= 200) return 'Success';
    return 'Informational';
  }

  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    
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
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
} 