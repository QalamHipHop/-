import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Actor = {
  userId: string;
  roles: string[];
};

@Injectable()
export class LaunchpadService {
  private readonly baseUrl: string;
  private readonly internalToken: string;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('launchpad.baseUrl') ?? process.env.LAUNCHPAD_SERVICE_URL ?? 'http://launchpad-service:50054').replace(/\/$/, '');
    this.internalToken = process.env.LAUNCHPAD_INTERNAL_TOKEN ?? '';
    if (!this.internalToken && process.env.NODE_ENV === 'production') {
      throw new Error('LAUNCHPAD_INTERNAL_TOKEN is required in production');
    }
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

  async createToken(actor: Actor, body: unknown) {
    return this.request('/api/v1/tokens', 'POST', body, actor);
  }

  async quoteBuy(actor: Actor, id: string, body: unknown) {
    return this.request(`/api/v1/tokens/${encodeURIComponent(id)}/quote-buy`, 'POST', body, actor);
  }

  async buy(actor: Actor, id: string, body: unknown) {
    return this.request(`/api/v1/tokens/${encodeURIComponent(id)}/buy`, 'POST', body, actor);
  }

  async sell(actor: Actor, id: string, body: unknown) {
    return this.request(`/api/v1/tokens/${encodeURIComponent(id)}/sell`, 'POST', body, actor);
  }

  async approve(actor: Actor, id: string) {
    return this.request(`/api/v1/tokens/${encodeURIComponent(id)}/approve`, 'POST', {}, actor);
  }

  async reject(actor: Actor, id: string, body: unknown) {
    return this.request(`/api/v1/tokens/${encodeURIComponent(id)}/reject`, 'POST', body, actor);
  }

  async pause(actor: Actor, id: string, body: unknown) {
    return this.request(`/api/v1/tokens/${encodeURIComponent(id)}/pause`, 'POST', body, actor);
  }

  private async request(path: string, method = 'GET', body?: unknown, actor?: Actor): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (actor) {
      if (!this.internalToken) {
        throw new BadGatewayException({ code: 'LAUNCHPAD_CREDENTIAL_MISSING', message: 'Launchpad service credential is unavailable' });
      }
      headers['X-Rial-Internal-Token'] = this.internalToken;
      headers['X-Rial-User-ID'] = actor.userId;
      headers['X-Rial-Actor-Roles'] = actor.roles.join(',');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new BadGatewayException({ code: 'LAUNCHPAD_UNAVAILABLE', message: 'Launchpad service is unavailable' });
    }

    const responseBody = await response.text();
    if (!response.ok) {
      throw new BadGatewayException({ code: 'LAUNCHPAD_UPSTREAM_ERROR', message: `Launchpad service returned ${response.status}` });
    }

    try {
      return JSON.parse(responseBody) as unknown;
    } catch {
      throw new BadGatewayException({ code: 'LAUNCHPAD_INVALID_RESPONSE', message: 'Launchpad service returned invalid JSON' });
    }
  }
}
