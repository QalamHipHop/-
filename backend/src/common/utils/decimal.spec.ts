import { toMinorUnits, fromMinorUnits, RIAL_ONE, RIAL_DECIMALS } from './decimal';

describe('decimal helpers', () => {
  it('converts whole numbers', () => {
    expect(toMinorUnits('1')).toBe(RIAL_ONE);
    expect(toMinorUnits(1)).toBe(RIAL_ONE);
    expect(toMinorUnits(2n)).toBe(2n * RIAL_ONE);
  });
  it('handles fractional with rounding', () => {
    expect(toMinorUnits('0.00000001')).toBe(1n);
    expect(toMinorUnits('0.5')).toBe(50_000_000n);
    expect(toMinorUnits('1.123456789')).toBe(112_345_679n); // round half-up
  });
  it('handles negatives', () => {
    expect(toMinorUnits('-1')).toBe(-RIAL_ONE);
  });
  it('formats back', () => {
    expect(fromMinorUnits(RIAL_ONE)).toBe('1.00000000');
    expect(fromMinorUnits(1n)).toBe('0.00000001');
    expect(fromMinorUnits(123_456_789_000_000_000n)).toBe('1234567890.00000000');
  });
  it('round-trips', () => {
    const s = '12345.6789';
    expect(fromMinorUnits(toMinorUnits(s))).toBe('12345.67890000');
  });
  it('throws on garbage', () => {
    expect(() => toMinorUnits('abc')).toThrow();
  });
  it('decimals constant', () => {
    expect(RIAL_DECIMALS).toBe(8n);
    expect(RIAL_ONE).toBe(100_000_000n);
  });
});
