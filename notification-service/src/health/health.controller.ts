import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('healthz')
  health() {
    return { status: 'OK', service: 'notification-service', ts: new Date().toISOString() };
  }
}
