import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private requests = 0;
  private errors = 0;

  observeRequest(statusCode: number): void {
    this.requests += 1;
    if (statusCode >= 500) this.errors += 1;
  }

  render(): string {
    const memory = process.memoryUsage();
    const lines = [
      '# HELP rial_process_uptime_seconds Process uptime in seconds.',
      '# TYPE rial_process_uptime_seconds gauge',
      `rial_process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`,
      '# HELP rial_process_resident_memory_bytes Resident process memory.',
      '# TYPE rial_process_resident_memory_bytes gauge',
      `rial_process_resident_memory_bytes ${memory.rss}`,
      '# HELP rial_process_heap_used_bytes Used V8 heap.',
      '# TYPE rial_process_heap_used_bytes gauge',
      `rial_process_heap_used_bytes ${memory.heapUsed}`,
      '# HELP rial_http_requests_total Requests observed by the gateway.',
      '# TYPE rial_http_requests_total counter',
      `rial_http_requests_total ${this.requests}`,
      '# HELP rial_http_errors_total HTTP 5xx responses observed by the gateway.',
      '# TYPE rial_http_errors_total counter',
      `rial_http_errors_total ${this.errors}`,
    ];
    return `${lines.join('\n')}\n`;
  }
}
