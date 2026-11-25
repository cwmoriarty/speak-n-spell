// Deduplicated, cached, relevance-scored line-art illustration & reference lookup

const INK_COLOR_PARAM = '%231d1a16';
const iconUrl = (prefix, name) => `https://api.iconify.design/${prefix}/${name}.svg?color=${INK_COLOR_PARAM}`;

// Curated kid-friendly line-art picture shelf (synced with sw.js offline precache)
export const PICTURE_CATALOG = Object.freeze([
  {
    category: 'Fruit',
    items: [
      { word: 'apple', url: iconUrl('lucide', 'apple') },
      { word: 'banana', url: iconUrl('lucide', 'banana') },
      { word: 'cherry', url: iconUrl('lucide', 'cherry') },
      { word: 'grape', url: iconUrl('lucide', 'grape') },
      { word: 'orange', url: iconUrl('lucide', 'citrus') },
      { word: 'watermelon', url: iconUrl('tabler', 'melon') }
    ]
  },
  {
    category: 'Animals',
    items: [
      { word: 'cat', url: iconUrl('lucide', 'cat') },
      { word: 'dog', url: iconUrl('lucide', 'dog') },
      { word: 'butterfly', url: iconUrl('tabler', 'butterfly') },
      { word: 'bird', url: iconUrl('lucide', 'bird') },
      { word: 'fish', url: iconUrl('lucide', 'fish') },
      { word: 'turtle', url: iconUrl('lucide', 'turtle') },
      { word: 'rabbit', url: iconUrl('lucide', 'rabbit') },
      { word: 'squirrel', url: iconUrl('lucide', 'squirrel') }
    ]
  },
  {
    category: 'Nature & Space',
    items: [
      { word: 'sun', url: iconUrl('lucide', 'sun') },
      { word: 'moon', url: iconUrl('lucide', 'moon') },
      { word: 'star', url: iconUrl('lucide', 'star') },
      { word: 'rainbow', url: iconUrl('lucide', 'rainbow') },
      { word: 'flower', url: iconUrl('lucide', 'flower-2') },
      { word: 'tree', url: iconUrl('lucide', 'tree-pine') },
      { word: 'cloud', url: iconUrl('lucide', 'cloud') },
      { word: 'rocket', url: iconUrl('lucide', 'rocket') }
    ]
  },
  {
    category: 'Everyday',
    items: [
      { word: 'house', url: iconUrl('lucide', 'house') },
      { word: 'car', url: iconUrl('lucide', 'car') },
      { word: 'bike', url: iconUrl('lucide', 'bike') },
      { word: 'airplane', url: iconUrl('lucide', 'plane') },
      { word: 'pizza', url: iconUrl('lucide', 'pizza') },
      { word: 'cake', url: iconUrl('lucide', 'cake') },
      { word: 'book', url: iconUrl('lucide', 'book-open') },
      { word: 'umbrella', url: iconUrl('lucide', 'umbrella') }
    ]
  }
]);

// Flatten catalog + helpful aliases into fast O(1) starter icon lookup
const starterEntries = {};
for (const group of PICTURE_CATALOG) {
  for (const item of group.items) {
    starterEntries[item.word] = item.url;
  }
}
starterEntries.grapes = starterEntries.grape;
starterEntries.lemon = iconUrl('tabler', 'lemon');
starterEntries.carrot = iconUrl('lucide', 'carrot');
starterEntries.cookie = iconUrl('lucide', 'cookie');
starterEntries['ice cream'] = iconUrl('lucide', 'ice-cream-cone');
starterEntries.snail = iconUrl('lucide', 'snail');
starterEntries.plane = starterEntries.airplane;
starterEntries.bicycle = starterEntries.bike;
starterEntries.home = starterEntries.house;
starterEntries.heart = iconUrl('lucide', 'heart');
starterEntries.crown = iconUrl('lucide', 'crown');

export const OFFLINE_STARTER_ICONS = Object.freeze(starterEntries);

// Pure grammar / sight words where an arbitrary icon is confusing rather than helpful
const NON_VISUAL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'for', 'of', 'by',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'it', 'its', 'he', 'him', 'his', 'she', 'her', 'we', 'us', 'our', 'they', 'them', 'their',
  'you', 'your', 'me', 'my', 'i', 'this', 'that', 'these', 'those',
  'what', 'when', 'where', 'who', 'whom', 'whose', 'which', 'why', 'how',
  'not', 'no', 'yes', 'so', 'very', 'just', 'also', 'because', 'with', 'from', 'into',
  'about', 'please', 'thank', 'thanks', 'here', 'there', 'then', 'than', 'some', 'any',
  'all', 'more', 'most', 'other', 'each', 'every', 'many', 'much', 'such', 'only', 'now', 'out'
]);

const REJECTED_ICON_TOKENS = new Set([
  'brand', 'filled', 'fill', 'solid', 'color', 'off', 'slash', 'x', 'plus', 'minus',
  'edit', 'settings', 'cog', 'check', 'alert', 'exclamation', 'question', 'dots', 'code', 'api'
]);

const LINE_ART_PREFIXES = 'lucide,tabler,icon-park-outline,iconoir,streamline';
const MAX_CACHE_ENTRIES = 120;

const mediaCache = new Map();

function rememberCache(key, value) {
  if (mediaCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = mediaCache.keys().next().value;
    mediaCache.delete(oldestKey);
  }
  mediaCache.set(key, value);
}

export function singularizeWord(word) {
  const lower = String(word || '').toLowerCase().trim();
  if (lower.length <= 3 || lower.includes(' ')) return lower;
  if (lower.endsWith('ies') && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|ses)$/.test(lower) && lower.length > 4) return lower.slice(0, -2);
  if (lower.endsWith('s') && !/(?:ss|us|is)$/.test(lower)) return lower.slice(0, -1);
  return lower;
}

/**
 * Strictly scores Iconify search hits so unrelated substring matches
 * (e.g., "the" -> "thermometer", "cat" -> "category") are rejected.
 */
export function pickRelevantOutlineIcon(icons, queryWord) {
  if (!Array.isArray(icons) || icons.length === 0 || !queryWord) return null;

  const lower = queryWord.toLowerCase().trim();
  const singular = singularizeWord(lower);
  const hyphenated = lower.replace(/\s+/g, '-');
  const queryWords = lower.split(/\s+/).filter(Boolean);

  let bestIcon = null;
  let bestScore = -1;

  for (const fullId of icons) {
    const [prefix, iconName] = String(fullId).split(':');
    if (!prefix || !iconName) continue;

    const nameLower = iconName.toLowerCase();
    const tokens = nameLower.split(/[-_]+/).filter(Boolean);

    // Reject noisy UI modifier/brand variants
    if (tokens.some((t) => REJECTED_ICON_TOKENS.has(t))) continue;

    let score = -1;
    if (nameLower === lower || nameLower === singular || nameLower === hyphenated) {
      score = 100;
    } else if (queryWords.length === 1) {
      if (tokens.includes(lower) || tokens.includes(singular)) {
        // Prefer concise names (e.g., "cat-outline" over "cat-sitting-basket")
        score = Math.max(40, 80 - (tokens.length - 1) * 15);
      }
    } else {
      // Multi-word phrase: require all phrase tokens to appear in the icon name
      const allMatch = queryWords.every((qw) => tokens.includes(qw) || tokens.includes(singularizeWord(qw)));
      if (allMatch) {
        score = Math.max(45, 90 - Math.max(0, tokens.length - queryWords.length) * 12);
      }
    }

    if (score < 0) continue;

    // Slight preference for crisp outline/lucide/tabler collections
    if (prefix === 'lucide' || prefix === 'tabler') score += 8;
    else if (prefix === 'icon-park-outline' || prefix === 'iconoir') score += 4;

    if (score > bestScore) {
      bestScore = score;
      bestIcon = { prefix, iconName };
    }
  }

  if (!bestIcon) return null;
  return iconUrl(bestIcon.prefix, bestIcon.iconName);
}

export function peekCachedMedia(word) {
  if (!word) return null;
  const clean = word.trim().toLowerCase();
  if (mediaCache.has(clean)) {
    return mediaCache.get(clean);
  }
  const singular = singularizeWord(clean);
  const starterUrl = OFFLINE_STARTER_ICONS[clean] || OFFLINE_STARTER_ICONS[singular];
  if (starterUrl) {
    return {
      iconUrl: starterUrl,
      isLineArt: true,
      referenceUrl: '',
      serviceName: '',
      partial: true
    };
  }
  return null;
}

async function fetchJsonWithTimeout(url, timeoutMs, outerSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) return null;
    outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
  }
}

async function fetchLineArtIcon(cleanWord, signal) {
  const lower = cleanWord.toLowerCase();
  if (NON_VISUAL_WORDS.has(lower)) {
    return { iconUrl: null, isLineArt: false };
  }

  const singular = singularizeWord(lower);
  const starterUrl = OFFLINE_STARTER_ICONS[lower] || OFFLINE_STARTER_ICONS[singular];
  if (starterUrl) {
    return { iconUrl: starterUrl, isLineArt: true };
  }

  const searchTerm = singular !== lower ? singular : lower;
  const query = encodeURIComponent(searchTerm);

  const primary = await fetchJsonWithTimeout(
    `https://api.iconify.design/search?query=${query}&prefixes=${LINE_ART_PREFIXES}&limit=16`,
    2200,
    signal
  );
  const primaryUrl = pickRelevantOutlineIcon(primary?.icons, cleanWord);
  if (primaryUrl) return { iconUrl: primaryUrl, isLineArt: true };

  if (lower.includes(' ')) {
    const queryHyphen = encodeURIComponent(lower.replace(/\s+/g, '-'));
    const hyphenData = await fetchJsonWithTimeout(
      `https://api.iconify.design/search?query=${queryHyphen}&prefixes=${LINE_ART_PREFIXES}&limit=12`,
      1800,
      signal
    );
    const hyphenUrl = pickRelevantOutlineIcon(hyphenData?.icons, cleanWord);
    if (hyphenUrl) return { iconUrl: hyphenUrl, isLineArt: true };
  }

  const broad = await fetchJsonWithTimeout(
    `https://api.iconify.design/search?query=${query}&limit=20`,
    2000,
    signal
  );
  const broadUrl = pickRelevantOutlineIcon(broad?.icons, cleanWord);
  if (broadUrl) return { iconUrl: broadUrl, isLineArt: true };

  return { iconUrl: null, isLineArt: false };
}

async function fetchWikipediaSummary(cleanWord, signal) {
  const wikiSlug = encodeURIComponent(cleanWord.replace(/\s+/g, '_'));
  const dictUrl = `https://dict.org/bin/Dict?Form=Dict1&Query=${encodeURIComponent(cleanWord)}&Strategy=*&Database=*`;

  const data = await fetchJsonWithTimeout(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${wikiSlug}`,
    2200,
    signal
  );

  if (data && data.type !== 'missingtitle') {
    const referenceUrl = data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${wikiSlug}`;
    const allowThumb = !NON_VISUAL_WORDS.has(cleanWord.toLowerCase()) && data.type !== 'disambiguation';
    const thumbnailUrl = allowThumb ? (data.thumbnail?.source || null) : null;
    return { referenceUrl, serviceName: 'Wikipedia', thumbnailUrl };
  }

  return { referenceUrl: dictUrl, serviceName: 'dict.org', thumbnailUrl: null };
}

/**
 * Resolves illustration and reference link in parallel with a single deduplicated Wikipedia lookup.
 */
export async function resolveWordMedia(word, signal) {
  if (!word) {
    return { iconUrl: null, isLineArt: false, referenceUrl: '', serviceName: '' };
  }

  const cleanWord = word.trim();
  const cacheKey = cleanWord.toLowerCase();
  if (mediaCache.has(cacheKey)) {
    return mediaCache.get(cacheKey);
  }

  const [iconResult, wikiResult] = await Promise.all([
    fetchLineArtIcon(cleanWord, signal),
    fetchWikipediaSummary(cleanWord, signal)
  ]);

  if (signal?.aborted) {
    return null;
  }

  const finalIconUrl = iconResult.iconUrl || wikiResult.thumbnailUrl || null;
  const isLineArt = iconResult.iconUrl ? iconResult.isLineArt : false;

  const resolved = {
    iconUrl: finalIconUrl,
    isLineArt,
    referenceUrl: wikiResult.referenceUrl,
    serviceName: wikiResult.serviceName
  };

  rememberCache(cacheKey, resolved);
  return resolved;
}
