// Syllables, phonics, transcript extraction, and kid-safe word filtering

export const PHONICS_SOUNDS = Object.freeze({
  a: 'ah', b: 'buh', c: 'kuh', d: 'duh', e: 'eh', f: 'fff', g: 'guh', h: 'huh',
  i: 'ih', j: 'juh', k: 'kuh', l: 'ull', m: 'mmm', n: 'nnn', o: 'aw', p: 'puh',
  q: 'kwuh', r: 'rrr', s: 'sss', t: 'tuh', u: 'uh', v: 'vvv', w: 'wuh', x: 'ks',
  y: 'yuh', z: 'zzz',
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'
});

export const CUSTOM_PRONUNCIATIONS = Object.freeze({
  eva: 'aoife',
  megan: 'meaghan'
});

export const SYLLABLE_DICT = Object.freeze({
  'wonderful': ['won', 'der', 'ful'],
  'banana': ['ba', 'nan', 'a'],
  'elephant': ['el', 'e', 'phant'],
  'butterfly': ['but', 'ter', 'fly'],
  'chocolate': ['choc', 'o', 'late'],
  'dinosaur': ['di', 'no', 'saur'],
  'computer': ['com', 'pu', 'ter'],
  'san francisco': ['San', 'Fran', 'cis', 'co'],
  'madison square garden': ['Mad', 'i', 'son', 'Square', 'Gar', 'den'],
  'new york': ['New', 'York'],
  'ice cream': ['ice', 'cream'],
  'hot dog': ['hot', 'dog'],
  'apple': ['ap', 'ple'],
  'pizza': ['piz', 'za'],
  'orange': ['or', 'ange'],
  'purple': ['pur', 'ple'],
  'yellow': ['yel', 'low'],
  'monkey': ['mon', 'key'],
  'chicken': ['chick', 'en'],
  'tiger': ['ti', 'ger'],
  'lion': ['li', 'on'],
  'giraffe': ['gi', 'raffe'],
  'zebra': ['ze', 'bra'],
  'kangaroo': ['kan', 'ga', 'roo'],
  'dolphin': ['dol', 'phin'],
  'octopus': ['oc', 'to', 'pus'],
  'penguin': ['pen', 'guin'],
  'squirrel': ['squir', 'rel'],
  'alligator': ['al', 'li', 'ga', 'tor'],
  'crocodile': ['croc', 'o', 'dile'],
  'hippopotamus': ['hip', 'po', 'pot', 'a', 'mus'],
  'rhinoceros': ['rhi', 'noc', 'er', 'os'],
  'caterpillar': ['cat', 'er', 'pil', 'lar'],
  'watermelon': ['wa', 'ter', 'mel', 'on'],
  'strawberry': ['straw', 'ber', 'ry'],
  'blueberry': ['blue', 'ber', 'ry'],
  'raspberry': ['rasp', 'ber', 'ry'],
  'pineapple': ['pine', 'ap', 'ple'],
  'cherry': ['cher', 'ry'],
  'lemon': ['lem', 'on'],
  'mango': ['man', 'go'],
  'melon': ['mel', 'on'],
  'tomato': ['to', 'ma', 'to'],
  'carrot': ['car', 'rot'],
  'broccoli': ['broc', 'co', 'li'],
  'vegetable': ['veg', 'e', 'ta', 'ble'],
  'spaghetti': ['spa', 'ghet', 'ti'],
  'macaroni': ['mac', 'a', 'ro', 'ni'],
  'turtle': ['tur', 'tle'],
  'rabbit': ['rab', 'bit'],
  'puppy': ['pup', 'py'],
  'kitten': ['kit', 'ten'],
  'panda': ['pan', 'da'],
  'koala': ['ko', 'a', 'la'],
  'unicorn': ['u', 'ni', 'corn'],
  'dragon': ['drag', 'on'],
  'flamingo': ['fla', 'min', 'go'],
  'volcano': ['vol', 'ca', 'no'],
  'mountain': ['moun', 'tain'],
  'ocean': ['o', 'cean'],
  'island': ['is', 'land'],
  'planet': ['plan', 'et'],
  'rocket': ['rock', 'et'],
  'robot': ['ro', 'bot'],
  'castle': ['cas', 'tle'],
  'pirate': ['pi', 'rate'],
  'pencil': ['pen', 'cil'],
  'crayon': ['cray', 'on'],
  'notebook': ['note', 'book'],
  'backpack': ['back', 'pack'],
  'garden': ['gar', 'den'],
  'umbrella': ['um', 'brel', 'la'],
  'rainbow': ['rain', 'bow'],
  'sunshine': ['sun', 'shine'],
  'helicopter': ['hel', 'i', 'cop', 'ter'],
  'airplane': ['air', 'plane'],
  'motorcycle': ['mo', 'tor', 'cy', 'cle'],
  'bicycle': ['bi', 'cy', 'cle'],
  'firefighter': ['fire', 'fight', 'er'],
  'astronaut': ['as', 'tro', 'naut'],
  'guitar': ['gui', 'tar'],
  'piano': ['pi', 'an', 'o'],
  'family': ['fam', 'i', 'ly'],
  'mother': ['moth', 'er'],
  'father': ['fa', 'ther'],
  'brother': ['broth', 'er'],
  'sister': ['sis', 'ter'],
  'grandmother': ['grand', 'moth', 'er'],
  'grandfather': ['grand', 'fa', 'ther'],
  'teacher': ['teach', 'er'],
  'kindergarten': ['kin', 'der', 'gar', 'ten'],
  'library': ['li', 'brar', 'y'],
  'hospital': ['hos', 'pi', 'tal'],
  'science': ['sci', 'ence'],
  'beautiful': ['beau', 'ti', 'ful'],
  'favorite': ['fa', 'vor', 'ite'],
  'animal': ['an', 'i', 'mal'],
  'tomorrow': ['to', 'mor', 'row'],
  'yesterday': ['yes', 'ter', 'day'],
  'together': ['to', 'geth', 'er'],
  'remember': ['re', 'mem', 'ber'],
  'adventure': ['ad', 'ven', 'ture'],
  'imagine': ['i', 'mag', 'ine'],
  'calendar': ['cal', 'en', 'dar'],
  'celebrate': ['cel', 'e', 'brate'],
  'happy': ['hap', 'py'],
  'cookie': ['cook', 'ie'],
  'pancake': ['pan', 'cake'],
  'cupcake': ['cup', 'cake'],
  'sandwich': ['sand', 'wich'],
  'princess': ['prin', 'cess'],
  'superhero': ['su', 'per', 'he', 'ro'],
  'people': ['peo', 'ple'],
  'water': ['wa', 'ter'],
  'because': ['be', 'cause'],
  'every': ['ev', 'ery'],
  'different': ['dif', 'fer', 'ent'],
  'aoife': ['Aoife'],
  'meaghan': ['Meagh', 'an']
});

const VALID_ONSETS = new Set([
  'b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 't', 'v', 'w', 'x', 'y', 'z',
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'dw', 'fl', 'fr', 'gh', 'gl', 'gn', 'gr', 'kn',
  'ph', 'pl', 'pr', 'qu', 'rh', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw',
  'th', 'tr', 'tw', 'wh', 'wr',
  'chr', 'phr', 'sch', 'scr', 'shr', 'spl', 'spr', 'squ', 'str', 'thr'
]);

const VOWEL_TEAMS = /^(?:eau|iou|ai|au|aw|ay|ea|ee|ei|eu|ew|ey|ie|oa|oe|oi|oo|ou|ow|oy|ue|ui)/i;

function isVowelChar(ch) {
  return /[aeiouy]/i.test(ch);
}

/**
 * Find contiguous vowel nuclei indices [start, end) in a lowercase word.
 * Treats vowel teams as a single nucleus and excludes silent trailing -e / -ed.
 */
function findVowelNuclei(lower) {
  const nuclei = [];
  let i = 0;

  // Treat leading 'y' (e.g. "yellow", "yes") as consonant
  while (i < lower.length) {
    const ch = lower[i];
    const isYConsonant = ch === 'y' && (i === 0 || isVowelChar(lower[i + 1] || ''));
    // 'qu' treats 'u' as part of consonant cluster before another vowel
    if (ch === 'q' && lower[i + 1] === 'u' && isVowelChar(lower[i + 2] || '')) {
      i += 2;
      continue;
    }

    if (isVowelChar(ch) && !isYConsonant) {
      const rest = lower.slice(i);
      const team = rest.match(VOWEL_TEAMS);
      const len = team ? team[0].length : 1;
      nuclei.push({ start: i, end: i + len });
      i += len;
    } else {
      i++;
    }
  }

  // Handle silent final 'e' (unless consonant + 'le' like "table", "apple", "little")
  if (nuclei.length > 1) {
    const last = nuclei[nuclei.length - 1];
    if (last.start === lower.length - 1 && lower[last.start] === 'e') {
      const isConsonantLe =
        lower.length >= 3 &&
        lower[lower.length - 2] === 'l' &&
        !isVowelChar(lower[lower.length - 3]);
      if (!isConsonantLe) {
        nuclei.pop();
      }
    } else if (
      // Silent '-ed' ending unless preceded by 't' or 'd' (e.g. "walked" vs "wanted")
      last.start === lower.length - 2 &&
      lower.endsWith('ed') &&
      lower.length >= 4 &&
      !/[td]$/.test(lower.slice(0, -2))
    ) {
      nuclei.pop();
    } else if (
      // Silent '-es' plural after silent e (e.g. "cakes", "smiles", "houses" keeps 2 when sibilant)
      last.start === lower.length - 2 &&
      lower.endsWith('es') &&
      lower.length >= 4 &&
      !/[sxz]$/.test(lower.slice(0, -2)) &&
      !/(?:ch|sh|ge|ce)$/.test(lower.slice(0, -1))
    ) {
      nuclei.pop();
    }
  }

  return nuclei;
}

export function splitWordSyllables(word) {
  if (!word) return [];
  const trimmed = word.trim();
  const lower = trimmed.toLowerCase();

  if (SYLLABLE_DICT[lower]) {
    return [...SYLLABLE_DICT[lower]];
  }

  // Short words, numbers, or contractions stay intact unless clearly multi-syllable
  if (lower.length <= 3 || /[^a-z]/i.test(lower)) {
    return [trimmed];
  }

  const nuclei = findVowelNuclei(lower);
  if (nuclei.length <= 1) {
    return [trimmed];
  }

  const splitPoints = [];
  for (let n = 0; n < nuclei.length - 1; n++) {
    const prev = nuclei[n];
    const next = nuclei[n + 1];
    const gapStart = prev.end;
    const gapEnd = next.start;
    const cluster = lower.slice(gapStart, gapEnd);

    if (cluster.length === 0) {
      // Adjacent separate vowels (e.g., "li-on", "pi-a-no")
      splitPoints.push(gapStart);
    } else if (cluster.length === 1) {
      // V-CV (unless consonant + le at end)
      splitPoints.push(gapStart);
    } else if (cluster.length === 2 && cluster[0] === cluster[1]) {
      // Double consonant: split between them ("hap-py", "but-ter")
      splitPoints.push(gapStart + 1);
    } else if (cluster === 'ck') {
      // Keep 'ck' with preceding short vowel ("chick-en", "pock-et")
      splitPoints.push(gapEnd);
    } else if (
      // Consonant + 'le' final syllable ("ta-ble", "pur-ple", "can-dle", "bub-ble")
      n === nuclei.length - 2 &&
      lower.endsWith('le') &&
      cluster.endsWith('l') &&
      cluster.length >= 2
    ) {
      splitPoints.push(Math.max(gapStart, gapEnd - 2));
    } else {
      // Maximal onset: keep largest legal English onset with the following syllable,
      // while leaving at least one consonant in the coda when cluster length >= 2 (except digraphs).
      if (VALID_ONSETS.has(cluster) && cluster.length === 2 && /^(?:ch|sh|th|ph|wh)$/.test(cluster)) {
        splitPoints.push(gapStart);
      } else {
        let chosen = gapStart + 1;
        for (let k = gapStart + 1; k < gapEnd; k++) {
          const onset = lower.slice(k, gapEnd);
          if (VALID_ONSETS.has(onset)) {
            chosen = k;
            break;
          }
        }
        splitPoints.push(chosen);
      }
    }
  }

  const syllables = [];
  let cursor = 0;
  for (const pt of splitPoints) {
    if (pt > cursor && pt < trimmed.length) {
      syllables.push(trimmed.slice(cursor, pt));
      cursor = pt;
    }
  }
  if (cursor < trimmed.length) {
    syllables.push(trimmed.slice(cursor));
  }

  return syllables.length ? syllables : [trimmed];
}

export function getSyllables(phrase) {
  if (!phrase) return '';
  const cleanPhrase = phrase.toLowerCase().trim();
  if (SYLLABLE_DICT[cleanPhrase]) {
    return SYLLABLE_DICT[cleanPhrase].join(' · ');
  }
  const words = phrase.trim().split(/\s+/);
  const parts = [];
  for (const w of words) {
    parts.push(...splitWordSyllables(w));
  }
  return parts.join(' · ');
}

/**
 * Extract the target word or short phrase (1-4 words) following the "spell" trigger.
 * Supports sight words ("spell the", "spell please", "spell a") while stripping
 * surrounding filler when a content word follows ("spell the word dog please" -> "dog").
 */
export function extractTargetWord(transcript) {
  if (!transcript || typeof transcript !== 'string') return null;

  // Reject self-speech echo phrasing
  if (/\bis\s+spelled\b|\bspells\b/i.test(transcript)) return null;

  // Preserve internal apostrophes and hyphens while removing outer punctuation
  const clean = transcript
    .replace(/[.,\/#!$%\^&\*;:{}=\_`~()?"]/g, ' ')
    .replace(/(^|\s)'+|'+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return null;

  const spellMatch = clean.match(/\bspell\b/i);
  if (!spellMatch) return null;

  const afterSpell = clean.slice(spellMatch.index + spellMatch[0].length).trim();
  if (!afterSpell) return null;

  let candidate = afterSpell;

  // Strip trailing polite phrases ONLY if something remains before them
  const trailingFillerRegex = /(?:\s+(?:please|for\s+me|for\s+us|thank\s+you|thanks))+$/i;
  const withoutTrailing = candidate.replace(trailingFillerRegex, '').trim();
  if (withoutTrailing) {
    candidate = withoutTrailing;
  }

  // Strip leading filler phrases ONLY if something remains after them
  // (so "Spell the" -> "the", while "Spell the word elephant" -> "elephant")
  const leadingFillerRegex = /^(?:out\s+|me\s+|us\s+|for\s+me\s+|for\s+us\s+|the\s+words?\s+|this\s+words?\s+|words?\s+|the\s+|a\s+|an\s+)+/i;
  const withoutLeading = candidate.replace(leadingFillerRegex, '').trim();
  if (withoutLeading) {
    candidate = withoutLeading;
  }

  if (!candidate) return null;

  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  // Limit multi-word phrases to 4 words (e.g. "Madison Square Garden", "Statue of Liberty")
  if (words.length > 4) {
    candidate = words.slice(0, 4).join(' ');
  }

  // Apply custom family pronunciation overrides
  const lower = candidate.toLowerCase();
  if (CUSTOM_PRONUNCIATIONS[lower]) {
    return CUSTOM_PRONUNCIATIONS[lower];
  }

  return candidate;
}

export const LOCAL_PROFANITY = new Set([
  'poop', 'poopy', 'poopoo', 'pee', 'peeing', 'fart', 'farting',
  'crap', 'crappy', 'butt', 'boob', 'boobs', 'damn', 'hell',
  'shit', 'fuck', 'fucking', 'bitch', 'ass', 'asshole', 'bastard',
  'dick', 'piss', 'cunt'
]);

const MAX_PROFANITY_CACHE = 200;
const profanityCache = new Map();

function rememberProfanity(key, value) {
  if (profanityCache.size >= MAX_PROFANITY_CACHE) {
    const oldest = profanityCache.keys().next().value;
    profanityCache.delete(oldest);
  }
  profanityCache.set(key, value);
}

export async function checkIsProfane(text, signal) {
  const clean = text.toLowerCase().trim();
  if (!clean) return false;

  if (profanityCache.has(clean)) {
    return profanityCache.get(clean);
  }

  if (LOCAL_PROFANITY.has(clean)) {
    rememberProfanity(clean, true);
    return true;
  }

  const parts = clean.split(/[\s\-]+/);
  for (const p of parts) {
    if (LOCAL_PROFANITY.has(p)) {
      rememberProfanity(clean, true);
      return true;
    }
  }

  try {
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) return false;
      signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), 800);

    const res = await fetch('https://vector.profanity.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Spell ' + clean }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onOuterAbort);

    if (res.ok) {
      const data = await res.json();
      const result = !!data.isProfanity;
      rememberProfanity(clean, result);
      return result;
    }
  } catch (err) {
    // Offline or timed out — default safe after passing local filter
  }
  return false;
}
