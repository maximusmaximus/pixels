const KEY = "pixel-pile-visit";

export type Visit = { seed: number; mult: number };

export function readVisit(): Visit {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Visit>;
      if (typeof parsed.seed === "number" && typeof parsed.mult === "number") {
        return {
          seed: parsed.seed >>> 0,
          mult: Math.min(10, Math.max(2, parsed.mult)),
        };
      }
    }
  } catch {
    // private mode can refuse the read
  }
  const visit: Visit = {
    seed: Math.floor(Math.random() * 0x7fffffff),
    mult: 2 + Math.random() * 8,
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(visit));
  } catch {
    // private mode can refuse the write
  }
  return visit;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleVisit<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const swap = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = swap;
  }
  return arr;
}

// Small through XL. Models are 1 unit wide before this scale.
const BANDS: ReadonlyArray<readonly [number, number]> = [
  [0.28, 0.48],
  [0.55, 0.88],
  [1.05, 1.5],
  [1.75, 2.65],
];

export function scaleFor(id: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x9e3779b1);
  const u = (h >>> 0) / 4294967296;
  const scaled = u * BANDS.length;
  const band = Math.min(BANDS.length - 1, Math.floor(scaled));
  const t = scaled - band;
  const range = BANDS[band] ?? BANDS[2]!;
  return range[0] + (range[1] - range[0]) * t;
}
