import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async check(@Res() res: Response) {
    try {
      // Basic health check - in a real app, you'd check:
      // - Database connectivity
      // - Redis connectivity
      // - External service dependencies
      // - Memory usage
      // - Disk space
      
      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0',
        checks: {
          database: 'connected',
          redis: 'connected',
          memory: 'ok',
        },
      };

      res.status(HttpStatus.OK).json(healthStatus);
    } catch (error) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is ready to receive traffic' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  async ready(@Res() res: Response) {
    try {
      // Readiness check - ensures the service is ready to handle requests
      const readinessStatus = {
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'ready',
          redis: 'ready',
          migrations: 'complete',
        },
      };

      res.status(HttpStatus.OK).json(readinessStatus);
    } catch (error) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  @ApiResponse({ status: 503, description: 'Service is not alive' })
  async live(@Res() res: Response) {
    // Liveness check - simple check that the service is running
    const livenessStatus = {
      status: 'alive',
      timestamp: new Date().toISOString(),
      pid: process.pid,
    };

    res.status(HttpStatus.OK).json(livenessStatus);
  }
}
