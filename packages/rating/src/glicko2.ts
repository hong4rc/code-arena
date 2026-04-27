/**
 * Glicko-2 — http://www.glicko.net/glicko/glicko2.pdf
 * Implements one rating period update for a single player given a list of
 * (opponent rating, opponent RD, score) tuples.
 *
 * score: 1 = win, 0.5 = draw, 0 = loss.
 */

const TAU = 0.5; // System volatility constant. 0.3–1.2 typical.
const SCALE = 173.7178;
const EPS = 1e-6;

export interface Glicko {
  /** Public-facing rating (e.g. 1500 baseline). */
  rating: number;
  /** Rating deviation. */
  rd: number;
  /** Volatility. */
  vol: number;
}

export interface MatchResult {
  opponent: Glicko;
  /** 1 = win, 0.5 = draw, 0 = loss. */
  score: number;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

export function updateGlicko(player: Glicko, results: MatchResult[]): Glicko {
  // 1. Convert to internal scale.
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;

  if (results.length === 0) {
    // No games this period — RD increases.
    const newPhi = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: newPhi * SCALE, vol: sigma };
  }

  // 2. Variance v.
  let vInv = 0;
  for (const r of results) {
    const muJ = (r.opponent.rating - 1500) / SCALE;
    const phiJ = r.opponent.rd / SCALE;
    const gj = g(phiJ);
    const ej = E(mu, muJ, phiJ);
    vInv += gj * gj * ej * (1 - ej);
  }
  const v = 1 / vInv;

  // 3. Delta.
  let delta = 0;
  for (const r of results) {
    const muJ = (r.opponent.rating - 1500) / SCALE;
    const phiJ = r.opponent.rd / SCALE;
    delta += g(phiJ) * (r.score - E(mu, muJ, phiJ));
  }
  delta *= v;

  // 4. Volatility (iterative algorithm from the paper).
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  let iter = 0;
  while (Math.abs(B - A) > EPS && iter < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
    iter += 1;
  }
  const newSigma = Math.exp(A / 2);

  // 5. Pre-rating-period RD.
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);

  // 6. New phi and mu.
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  let muSum = 0;
  for (const r of results) {
    const muJ = (r.opponent.rating - 1500) / SCALE;
    const phiJ = r.opponent.rd / SCALE;
    muSum += g(phiJ) * (r.score - E(mu, muJ, phiJ));
  }
  const newMu = mu + newPhi * newPhi * muSum;

  return {
    rating: newMu * SCALE + 1500,
    rd: newPhi * SCALE,
    vol: newSigma,
  };
}
