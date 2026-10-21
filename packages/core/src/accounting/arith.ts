/**
 * Integer arithmetic helpers for whole-kyat money and thousandth quantities.
 * Products such as quantity x unit cost can exceed 2^53, so the multiply is
 * done in BigInt and only the quotient comes back as a number.
 */

/** round(a * b / c) with half away from zero. c must not be 0. */
export function mulDivRound(a: number, b: number, c: number): number {
  if (c === 0) throw new RangeError('Division by zero');
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const twice = n * 2n;
  const q = twice / d;
  // q is 2*(n/d) truncated; adding the sign of n then halving rounds half away from zero.
  const sign = twice < 0n !== d < 0n ? -1n : 1n;
  return Number((q + sign) / 2n);
}

/** floor(a * b / c) for non-negative inputs. */
export function mulDivFloor(a: number, b: number, c: number): number {
  if (c === 0) throw new RangeError('Division by zero');
  if (a < 0 || b < 0 || c < 0) throw new RangeError('mulDivFloor expects non-negative inputs');
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

/** round(a / b) with half away from zero. */
export function divRound(a: number, b: number): number {
  return mulDivRound(a, 1, b);
}
