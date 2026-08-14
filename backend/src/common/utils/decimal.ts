/**
 *  Bigint minor-unit helpers. All RIAL balances are stored as bigint with 8 decimals.
 *  1 RIAL = 100_000_000 minor units.
 */
const DECIMALS = 8n;
const ONE = 10n ** DECIMALS;

export function toMinorUnits(amount: string | number | bigint): bigint {
  if (typeof amount === 'bigint') return amount * ONE;
  const s = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid decimal: ${s}`);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [intPart, fracPart = ''] = body.split('.');
  if (fracPart.length > Number(DECIMALS)) {
    // round half-up to keep precision
    const extra = fracPart.length - Number(DECIMALS);
    const truncated = fracPart.slice(0, Number(DECIMALS));
    const next = fracPart[Number(DECIMALS)] ?? '0';
    let minor = BigInt(intPart) * ONE + BigInt(truncated.padEnd(Number(DECIMALS), '0') || '0');
    if (next >= '5') minor += 1n;
    return neg ? -minor : minor;
  }
  const padded = (fracPart + '0'.repeat(Number(DECIMALS))).slice(0, Number(DECIMALS));
  let minor = BigInt(intPart) * ONE + BigInt(padded || '0');
  return neg ? -minor : minor;
}

export function fromMinorUnits(minor: bigint | string | number): string {
  const b = typeof minor === 'bigint' ? minor : BigInt(minor);
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const intPart = abs / ONE;
  const fracPart = (abs % ONE).toString().padStart(Number(DECIMALS), '0');
  return `${neg ? '-' : ''}${intPart}.${fracPart}`;
}

export const RIAL_DECIMALS = DECIMALS;
export const RIAL_ONE = ONE;
