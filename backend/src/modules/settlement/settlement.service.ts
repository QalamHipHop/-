/**
 *  Settlement service — unified RIAL exchange-rate & formatting helpers.
 *  All monetary values are bigint minor units (8 dp) per ADR-0003.
 *
 *  Responsibilities:
 *   - Cache rate snapshots in Redis with TTL & stale-grace
 *   - Provide converters (USD↔RIAL, major↔minor)
 *   - Provide quota / limits info (min credit, max credit, reserve)
 *   - Expose the rate providers registry to the controller
 */
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { SettlementConfig } from '../../config/settlement.config';
import { RateProvider } from './providers/rate-provider.interface';

export interface RateSnapshot {
  symbol: string;
  usdPerUnit: number;
  source: string;
  fetchedAt: string;
  stale: boolean;
}

const RATE_KEY = 'rial:rate:last';
const RATE_TS_KEY = 'rial:rate:ts';
const DECIMALS = 8;
const SCALE = 10n ** BigInt(DECIMALS);

@Injectable()
export class SettlementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementService.name);
  private refreshTimer: NodeJS.Timeout | null = null;
  /** in-memory last good snapshot (in case Redis is down) */
  private last: RateSnapshot | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject('RATE_PROVIDERS') private readonly providers: RateProvider[],
  ) {}

  // ------------------------------------------------- config accessors

  get symbol(): string { return this.config.get<SettlementConfig>('settlement')!.symbol; }
  get name(): string { return this.config.get<SettlementConfig>('settlement')!.name; }
  get decimals(): number { return this.config.get<SettlementConfig>('settlement')!.decimals; }
  get minCredit(): bigint { return this.config.get<SettlementConfig>('settlement')!.minCredit; }
  get maxCredit(): bigint { return this.config.get<SettlementConfig>('settlement')!.maxCredit; }
  get reserveAccount(): string { return this.config.get<SettlementConfig>('settlement')!.reserveAccount; }
  get treasuryAccount(): string { return this.config.get<SettlementConfig>('settlement')!.treasuryAccount; }

  // ------------------------------------------------------- lifecycle

  async onModuleInit(): Promise<void> {
    const cfg = this.config.get<SettlementConfig>('settlement')!;
    // Eagerly fetch a rate so the first request is fast
    try { await this.refreshRate(); } catch (e) {
      this.logger.warn(`initial rate refresh failed: ${(e as Error).message}`);
    }
    // Schedule periodic refresh
    const period = Math.max(5, cfg.rateRefreshSec) * 1000;
    this.refreshTimer = setInterval(() => {
      this.refreshRate().catch((e) => this.logger.warn(`rate refresh failed: ${(e as Error).message}`));
    }, period);
    // Don't keep the event loop alive just for the timer
    if (typeof this.refreshTimer.unref === 'function') this.refreshTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // --------------------------------------------------------- providers

  listProviders(): Array<{ name: string; healthy: boolean }> {
    return this.providers.map((p) => ({ name: p.name, healthy: true /* best-effort */ }));
  }

  // ---------------------------------------------------------- rate

  /**
   * Returns the current USD-per-RIAL rate. Cached in Redis with the configured TTL,
   * with a "stale" grace window after which we re-fetch in the background.
   */
  async currentRate(): Promise<RateSnapshot> {
    const cfg = this.config.get<SettlementConfig>('settlement')!;
    const cached = await this.readCache();
    if (cached) {
      const ageSec = (Date.now() - new Date(cached.fetchedAt).getTime()) / 1000;
      if (ageSec < cfg.rateRefreshSec) return { ...cached, stale: false };
      if (ageSec < cfg.rateStaleAfterSec) {
        // Trigger background refresh; serve cached with stale flag
        this.refreshRate().catch(() => undefined);
        return { ...cached, stale: true };
      }
      // Past stale window: try one synchronous refresh, otherwise return stale
      try {
        return await this.refreshRate();
      } catch {
        return { ...cached, stale: true };
      }
    }
    // No cache at all — synchronous refresh
    return this.refreshRate();
  }

  async convertUsdToRial(usd: string | number): Promise<bigint> {
    const r = await this.currentRate();
    if (r.stale || r.usdPerUnit <= 0) throw new InternalServerErrorException({ code: 'RATE_UNAVAILABLE', message: 'no fresh exchange rate available' });
    const usdFraction = parseDecimal(String(usd));
    const rateFraction = parseDecimal(String(r.usdPerUnit));
    if (usdFraction.numerator < 0n || rateFraction.numerator <= 0n) throw new Error('amount and rate must be positive');
    return roundFraction(usdFraction.numerator * rateFraction.denominator * SCALE, usdFraction.denominator * rateFraction.numerator);
  }

  async convertRialToUsd(minor: bigint): Promise<string> {
    const r = await this.currentRate();
    if (r.stale || r.usdPerUnit <= 0) throw new InternalServerErrorException({ code: 'RATE_UNAVAILABLE', message: 'no fresh exchange rate available' });
    const rateFraction = parseDecimal(String(r.usdPerUnit));
    return formatFraction(minor * rateFraction.numerator, SCALE * rateFraction.denominator, 8);
  }

  /** Convert a major-unit string ("12.34") to minor bigint. */
  toMinor(major: string | number): bigint {
    const s = typeof major === 'number' ? major.toString() : major.trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a number: ${s}`);
    const neg = s.startsWith('-');
    const abs = neg ? s.slice(1) : s;
    const [whole, frac = ''] = abs.split('.');
    const padded = (frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS);
    const minor = BigInt(whole) * SCALE + BigInt(padded || '0');
    return neg ? -minor : minor;
  }

  /** Convert a minor bigint to a fixed-point major string with 8 dp. */
  fromMinor(minor: bigint): string {
    const neg = minor < 0n;
    const abs = neg ? -minor : minor;
    const whole = abs / SCALE;
    const frac = (abs % SCALE).toString().padStart(DECIMALS, '0');
    return `${neg ? '-' : ''}${whole.toString()}.${frac}`;
  }

  // --------------------------------------------------------- internal

  private async refreshRate(): Promise<RateSnapshot> {
    const cfg = this.config.get<SettlementConfig>('settlement')!;
    let chosen: { provider: RateProvider; value: number } | null = null;
    for (const p of this.providers) {
      try {
        if (!(await p.healthy())) continue;
        const v = await p.quote();
        if (v && Number.isFinite(v) && v > 0) { chosen = { provider: p, value: v }; break; }
      } catch (e) {
        this.logger.warn(`provider ${p.name} failed: ${(e as Error).message}`);
      }
    }
    if (!chosen) {
      // fall back to in-memory last
      if (this.last) return { ...this.last, stale: true };
      // fall back to redis last, possibly zero
      const cached = await this.readCache();
      if (cached) return { ...cached, stale: true };
      const zero: RateSnapshot = {
        symbol: cfg.symbol, usdPerUnit: 0, source: 'none',
        fetchedAt: new Date().toISOString(), stale: true,
      };
      return zero;
    }
    const snap: RateSnapshot = {
      symbol: cfg.symbol,
      usdPerUnit: chosen.value,
      source: chosen.provider.name,
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
    await this.writeCache(snap);
    this.last = snap;
    return snap;
  }

  private async readCache(): Promise<RateSnapshot | null> {
    try {
      const [v, ts] = await this.redis.mget(RATE_KEY, RATE_TS_KEY);
      if (!v || !ts) return this.last;
      const ageSec = (Date.now() - new Date(ts).getTime()) / 1000;
      const cfg = this.config.get<SettlementConfig>('settlement')!;
      return {
        symbol: this.symbol,
        usdPerUnit: Number(v),
        source: 'cache',
        fetchedAt: ts,
        stale: ageSec >= cfg.rateRefreshSec,
      };
    } catch (e) {
      this.logger.warn(`readCache failed: ${(e as Error).message}`);
      return this.last;
    }
  }

  private async writeCache(snap: RateSnapshot): Promise<void> {
    try {
      const ttl = Math.max(60, this.config.get<SettlementConfig>('settlement')!.rateStaleAfterSec);
      await this.redis.set(RATE_KEY, snap.usdPerUnit.toString(), 'EX', ttl);
      await this.redis.set(RATE_TS_KEY, snap.fetchedAt, 'EX', ttl);
    } catch (e) {
      this.logger.warn(`writeCache failed: ${(e as Error).message}`);
    }
  }
}


type Fraction = { numerator: bigint; denominator: bigint };

function parseDecimal(raw: string): Fraction {
  const value = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`invalid decimal: ${raw}`);
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = body.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || '0');
  return { numerator: negative ? -numerator : numerator, denominator };
}

function roundFraction(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('fraction denominator must be positive');
  if (numerator < 0n) return -roundFraction(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

function formatFraction(numerator: bigint, denominator: bigint, decimals: number): string {
  if (denominator <= 0n) throw new Error('fraction denominator must be positive');
  const scale = 10n ** BigInt(decimals);
  const rounded = roundFraction(numerator * scale, denominator);
  const negative = rounded < 0n;
  const absolute = negative ? -rounded : rounded;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
