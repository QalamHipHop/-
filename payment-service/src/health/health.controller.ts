// =============================================================================
//  Health check controller (Terminus)
//  Author: Qalamhiphop
// =============================================================================
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';

@Controller('healthz')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('live')
  live(): { status: 'ok'; uptime: number; now: string } {
    return { status: 'ok', uptime: process.uptime(), now: new Date().toISOString() };
  }
}
