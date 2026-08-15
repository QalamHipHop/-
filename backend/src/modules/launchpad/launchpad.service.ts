import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LaunchpadService {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('launchpad.baseUrl') ?? process.env.LAUNCHPAD_SERVICE_URL ?? 'http://launchpad-service:50054').replace(/\/$/, '');
  }

  async listTokens(filters: { status?: string; limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (filters.status) query.set('status', filters.status);
    if (filters.limit !== undefined) query.set('limit', String(filters.limit));
    if (filters.offset !== undefined) query.set('offset', String(filters.offset));
    return this.request(`/api/v1/tokens${query.size ? `?${query.toString()}` : ''}`);
  }

  async getToken(id: string) {
    return this.request(`/api/v1/tokens/${encodeURIComponent(id)}`);
  }

  private async request(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
    } catch {
      throw new BadGatewayException({ code: 'LAUNCHPAD_UNAVAILABLE', message: 'Launchpad service is unavailable' });
    }

    const body = await response.text();
    if (!response.ok) {
      throw new BadGatewayException({ code: 'LAUNCHPAD_UPSTREAM_ERROR', message: `Launchpad service returned ${response.status}` });
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new BadGatewayException({ code: 'LAUNCHPAD_INVALID_RESPONSE', message: 'Launchpad service returned invalid JSON' });
    }
  }
}
