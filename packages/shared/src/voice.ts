// Helpers for the voice-guided expense flow: turn what the phone's speech
// recogniser heard into an amount, and match it against the project list.
// Recognisers usually return digits ("2,300"), but sometimes words
// ("two thousand three hundred", "ألفين وثلاثمية"), so both are handled.

import { toLatinDigits } from './money';

/** Arabic text normalised for matching: no diacritics, unified alef/ya/ta marbuta. */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْٰـ]/g, '') // harakat, dagger alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

function normalize(s: string): string {
  return normalizeArabic(toLatinDigits(s).toLowerCase())
    .replace(/٫/g, '.')
    .replace(/[،,](?=\d{3}\b)/g, '') // thousands separators
    .replace(/[^\p{L}\p{N}.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// value: plain number; scale: multiplies what came before (hundred, thousand)
type NumWord = { value: number } | { scale: number } | { value: number; scale: number };

const EN: Record<string, NumWord> = {
  zero: { value: 0 }, oh: { value: 0 }, one: { value: 1 }, a: { value: 1 }, two: { value: 2 }, three: { value: 3 }, four: { value: 4 },
  five: { value: 5 }, six: { value: 6 }, seven: { value: 7 }, eight: { value: 8 }, nine: { value: 9 }, ten: { value: 10 },
  eleven: { value: 11 }, twelve: { value: 12 }, thirteen: { value: 13 }, fourteen: { value: 14 }, fifteen: { value: 15 },
  sixteen: { value: 16 }, seventeen: { value: 17 }, eighteen: { value: 18 }, nineteen: { value: 19 }, twenty: { value: 20 },
  thirty: { value: 30 }, forty: { value: 40 }, fourty: { value: 40 }, fifty: { value: 50 }, sixty: { value: 60 }, seventy: { value: 70 },
  eighty: { value: 80 }, ninety: { value: 90 }, hundred: { scale: 100 }, thousand: { scale: 1000 }, k: { scale: 1000 },
  million: { scale: 1_000_000 },
};

// Keys are already normalised (see normalizeArabic). Gulf/Saudi spoken forms included.
const AR: Record<string, NumWord> = {
  صفر: { value: 0 },
  واحد: { value: 1 }, واحده: { value: 1 },
  اثنين: { value: 2 }, اثنان: { value: 2 }, اتنين: { value: 2 }, ثنين: { value: 2 },
  ثلاث: { value: 3 }, ثلاثه: { value: 3 }, تلات: { value: 3 }, تلاته: { value: 3 }, ثلاثا: { value: 3 },
  اربع: { value: 4 }, اربعه: { value: 4 },
  خمس: { value: 5 }, خمسه: { value: 5 },
  ست: { value: 6 }, سته: { value: 6 },
  سبع: { value: 7 }, سبعه: { value: 7 },
  ثمان: { value: 8 }, ثماني: { value: 8 }, ثمانيه: { value: 8 }, تمن: { value: 8 }, تمانيه: { value: 8 }, ثمنيه: { value: 8 },
  تسع: { value: 9 }, تسعه: { value: 9 },
  عشر: { value: 10 }, عشره: { value: 10 },
  احدعش: { value: 11 }, حداش: { value: 11 }, احداش: { value: 11 }, احدعشر: { value: 11 },
  اثنعش: { value: 12 }, اطنعش: { value: 12 }, اثناعشر: { value: 12 }, اتناشر: { value: 12 },
  ثلطعش: { value: 13 }, ثلاثطعش: { value: 13 }, تلتاشر: { value: 13 },
  اربعطعش: { value: 14 }, اربعتاشر: { value: 14 },
  خمسطعش: { value: 15 }, خمستاشر: { value: 15 },
  ستطعش: { value: 16 }, ستاشر: { value: 16 },
  سبعطعش: { value: 17 }, سبعتاشر: { value: 17 },
  ثمنطعش: { value: 18 }, تمنتاشر: { value: 18 },
  تسعطعش: { value: 19 }, تسعتاشر: { value: 19 },
  عشرين: { value: 20 }, عشرون: { value: 20 },
  ثلاثين: { value: 30 }, ثلاثون: { value: 30 }, تلاتين: { value: 30 },
  اربعين: { value: 40 }, اربعون: { value: 40 },
  خمسين: { value: 50 }, خمسون: { value: 50 },
  ستين: { value: 60 }, ستون: { value: 60 },
  سبعين: { value: 70 }, سبعون: { value: 70 },
  ثمانين: { value: 80 }, ثمانون: { value: 80 }, تمانين: { value: 80 },
  تسعين: { value: 90 }, تسعون: { value: 90 },
  ميه: { scale: 100 }, مايه: { scale: 100 }, ميت: { scale: 100 },
  ميتين: { value: 200 }, مايتين: { value: 200 }, ماتين: { value: 200 }, مايتان: { value: 200 },
  ثلاثميه: { value: 300 }, ثلاثمايه: { value: 300 }, تلتميه: { value: 300 }, ثلثميه: { value: 300 },
  اربعميه: { value: 400 }, اربعمايه: { value: 400 },
  خمسميه: { value: 500 }, خمسمايه: { value: 500 },
  ستميه: { value: 600 }, ستمايه: { value: 600 },
  سبعميه: { value: 700 }, سبعمايه: { value: 700 },
  ثمانميه: { value: 800 }, ثمنميه: { value: 800 }, ثمانمايه: { value: 800 }, تمنميه: { value: 800 },
  تسعميه: { value: 900 }, تسعمايه: { value: 900 },
  الف: { scale: 1000 }, الاف: { scale: 1000 }, الوف: { scale: 1000 },
  الفين: { value: 2000 }, الفان: { value: 2000 },
  مليون: { scale: 1_000_000 }, ملايين: { scale: 1_000_000 },
};
// مئة / مائة / مئتين / ثلاثمئة normalise (ئ→ي) to ميه / مايه / ميتين / ثلاثميه, handled above.

const CURRENCY_WORDS = new Set(['sar', 'sr', 'riyal', 'riyals', 'rial', 'rials', 'ryal', 'ريال', 'ريالات', 'رس', 'and', 'sa']);
const SUB_UNIT = new Set(['halala', 'halalas', 'halalah', 'هلله', 'هللات', 'هلل']);
const POINT = new Set(['point', 'dot', 'فاصله', 'فاصل']);

function lookup(token: string): NumWord | undefined {
  if (EN[token]) return EN[token];
  if (AR[token]) return AR[token];
  // Arabic "و" (and) glued to the next word: "وخمسين"
  if (token.length > 2 && token.startsWith('و') && AR[token.slice(1)]) return AR[token.slice(1)];
  return undefined;
}

/**
 * Reads an amount from recognised speech. Returns halalas, or null if no amount was heard.
 * "2300", "2,300.50", "two thousand three hundred", "ألفين وثلاثمية", "١٥٠ ريال", "fifty riyals and 25 halalas".
 */
export function parseSpokenAmount(text: string): number | null {
  const norm = normalize(text);
  if (!norm) return null;
  // Digit runs separated only by spaces ("2 300") are one number.
  const tokens = norm.replace(/(\d)\s+(?=\d{3}\b)/g, '$1').split(' ').filter(Boolean);

  let total = 0; // committed thousands/millions
  let current = 0; // < 1000 part being built
  let seen = false;
  let fraction: number | null = null; // halalas
  let mode: 'int' | 'point' | 'sub' = 'int';
  let fracDigits = '';
  let subValue = 0;

  const addValue = (v: number) => {
    if (mode === 'point') {
      fracDigits += String(v);
      return;
    }
    if (mode === 'sub') {
      subValue += v;
      return;
    }
    current += v;
    seen = true;
  };

  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i];
    if (POINT.has(tok)) {
      mode = 'point';
      continue;
    }
    if (SUB_UNIT.has(tok)) {
      // "... 25 halalas": the number just read is the fraction
      if (mode === 'sub') fraction = Math.min(99, subValue);
      continue;
    }
    if (CURRENCY_WORDS.has(tok) || tok === 'و') {
      // after "riyals", a following number would be halalas if followed by "halala"
      if ((tok.startsWith('riyal') || tok.startsWith('ريال') || tok === 'sar') && seen) {
        const rest = tokens.slice(i + 1);
        if (rest.some((t) => SUB_UNIT.has(t))) mode = 'sub';
      }
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(tok)) {
      if (mode === 'point') {
        fracDigits += tok;
        continue;
      }
      const n = Number(tok);
      if (tok.includes('.')) {
        const [w, f] = tok.split('.');
        addValue(Number(w));
        fraction = Math.round(Number(`0.${f}`) * 100);
      } else {
        addValue(n);
      }
      continue;
    }
    if (tok.startsWith('و') && /^\d/.test(tok.slice(1))) {
      tok = tok.slice(1);
      i--;
      tokens[i + 1] = tok;
      continue;
    }
    const w = lookup(tok);
    if (!w) continue; // filler word ("it was", "تقريبا")
    if (mode === 'point') {
      if ('value' in w && !('scale' in w)) fracDigits += String(w.value);
      continue;
    }
    if (mode === 'sub') {
      if ('value' in w) subValue += w.value;
      continue;
    }
    if ('value' in w && 'scale' in w) {
      current = (current || 1) * w.value;
      seen = true;
    } else if ('scale' in w) {
      const base = current || 1;
      if (w.scale >= 1000) {
        total += base * w.scale;
        current = 0;
      } else {
        current = base * w.scale;
      }
      seen = true;
    } else {
      addValue(w.value);
    }
  }

  if (!seen) return null;
  if (fracDigits) fraction = Math.round(Number(`0.${fracDigits}`) * 100);
  if (fraction === null && mode === 'sub' && subValue) fraction = Math.min(99, subValue);
  return (total + current) * 100 + (fraction ?? 0);
}

// ---------------------------------------------------------------------------
// Project matching
// ---------------------------------------------------------------------------

const FILLER = new Set([
  'project', 'projects', 'the', 'for', 'this', 'is', 'its', 'it', 'a', 'an', 'of', 'to', 'on', 'site', 'job',
  'مشروع', 'المشروع', 'مشاريع', 'هذا', 'هذي', 'هذه', 'حق', 'لل', 'ل', 'في', 'على', 'تبع', 'حقت',
]);

function tokens(s: string): string[] {
  return normalize(s)
    .split(/[\s-]+/)
    .map((t) => t.replace(/^ال(?=\S{3,})/, '')) // Arabic definite article
    .filter((t) => t && !FILLER.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** How well a spoken phrase matches one label, 0..1. */
function labelScore(spoken: string[], label: string): number {
  const lt = tokens(label);
  if (!lt.length || !spoken.length) return 0;
  const joinedS = spoken.join('');
  const joinedL = lt.join('');
  // Whole-phrase similarity (handles "a b b" vs "abb", "p 001" vs "p-001")
  let best = similarity(joinedS, joinedL);
  if (joinedS.length >= 2 && joinedL.includes(joinedS)) best = Math.max(best, 0.6 + 0.4 * (joinedS.length / joinedL.length));
  // Token overlap: each label token matched by its closest spoken token
  let sum = 0;
  for (const t of lt) sum += Math.max(...spoken.map((s) => similarity(s, t)));
  best = Math.max(best, sum / lt.length);
  // Spoken tokens that clearly match a label token
  let hit = 0;
  for (const s of spoken) if (lt.some((t) => similarity(s, t) >= 0.8)) hit++;
  best = Math.max(best, (hit / spoken.length) * 0.9);
  return best;
}

export interface ProjectLike {
  id: string;
  code?: string | null;
  name: string;
  name_ar?: string | null;
}

/** Ranks projects by how well they match what was said. Best first; only reasonable matches. */
export function matchProjects<P extends ProjectLike>(spoken: string, projects: P[], limit = 3): Array<{ project: P; score: number }> {
  const st = tokens(spoken);
  if (!st.length) return [];
  return projects
    .map((p) => ({
      project: p,
      score: Math.max(
        p.code ? labelScore(st, p.code) : 0,
        labelScore(st, p.name),
        p.name_ar ? labelScore(st, p.name_ar) : 0,
        p.code ? labelScore(st, `${p.code} ${p.name}`) : 0,
      ),
    }))
    .filter((r) => r.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
