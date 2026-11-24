// Deduplicated, cached, abortable line-art illustration & reference lookup

export const OFFLINE_STARTER_ICONS = Object.freeze({
  cat: 'https://api.iconify.design/tabler/cat.svg?color=%231d1a16',
  dog: 'https://api.iconify.design/tabler/dog.svg?color=%231d1a16',
  apple: 'https://api.iconify.design/tabler/apple.svg?color=%231d1a16',
  banana: 'https://api.iconify.design/lucide/banana.svg?color=%231d1a16',
  pizza: 'https://api.iconify.design/tabler/pizza.svg?color=%231d1a16',
  sun: 'https://api.iconify.design/tabler/sun.svg?color=%231d1a16',
  car: 'https://api.iconify.design/tabler/car.svg?color=%231d1a16',
  star: 'https://api.iconify.design/tabler/star.svg?color=%231d1a16',
  butterfly: 'https://api.iconify.design/tabler/butterfly.svg?color=%231d1a16',
  fish: 'https://api.iconify.design/tabler/fish.svg?color=%231d1a16',
  bird: 'https://api.iconify.design/lucide/bird.svg?color=%231d1a16',
  flower: 'https://api.iconify.design/tabler/flower.svg?color=%231d1a16',
  tree: 'https://api.iconify.design/tabler/tree.svg?color=%231d1a16',
  house: 'https://api.iconify.design/tabler/home.svg?color=%231d1a16',
  moon: 'https://api.iconify.design/tabler/moon.svg?color=%231d1a16',
  cloud: 'https://api.iconify.design/tabler/cloud.svg?color=%231d1a16',
  book: 'https://api.iconify.design/tabler/book.svg?color=%231d1a16',
  cake: 'https://api.iconify.design/tabler/cake.svg?color=%231d1a16',
  heart: 'https://api.iconify.design/tabler/heart.svg?color=%231d1a16',
  rocket: 'https://api.iconify.design/tabler/rocket.svg?color=%231d1a16'
});

const INK_COLOR_PARAM = '%231d1a16';
const LINE_ART_PREFIXES = 'tabler,lucide,icon-park-outline,iconoir,streamline';
const MAX_CACHE_ENTRIES = 120;

const mediaCache = new Map();

function rememberCache(key, value) {
  if (mediaCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = mediaCache.keys().next().value;
    mediaCache.delete(oldestKey);
  }
  mediaCache.set(key, value);
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

function pickBestOutlineIcon(icons) {
  if (!Array.isArray(icons) || icons.length === 0) return null;
  const preferred = icons.find(
    (name) =>
      !name.includes('filled') &&
      !name.includes('fill') &&
      !name.includes('solid') &&
      !name.includes('brand') &&
      !name.includes('color')
  );
  const chosen = preferred || icons[0];
  const [prefix, iconName] = chosen.split(':');
  if (!prefix || !iconName) return null;
  return `https://api.iconify.design/${prefix}/${iconName}.svg?color=${INK_COLOR_PARAM}`;
}

async function fetchLineArtIcon(cleanWord, signal) {
  const lower = cleanWord.toLowerCase();
  if (OFFLINE_STARTER_ICONS[lower]) {
    return { iconUrl: OFFLINE_STARTER_ICONS[lower], isLineArt: true };
  }

  const query = encodeURIComponent(lower);

  // 1. Primary: Clean outline/line-art icon sets so children can trace and draw
  const primary = await fetchJsonWithTimeout(
    `https://api.iconify.design/search?query=${query}&prefixes=${LINE_ART_PREFIXES}&limit=12`,
    2200,
    signal
  );
  const primaryUrl = pickBestOutlineIcon(primary?.icons);
  if (primaryUrl) return { iconUrl: primaryUrl, isLineArt: true };

  // 2. Hyphenated form for multi-word nouns (e.g. "ice cream" -> "ice-cream")
  if (lower.includes(' ')) {
    const queryHyphen = encodeURIComponent(lower.replace(/\s+/g, '-'));
    const hyphenData = await fetchJsonWithTimeout(
      `https://api.iconify.design/search?query=${queryHyphen}&prefixes=${LINE_ART_PREFIXES}&limit=10`,
      1800,
      signal
    );
    const hyphenUrl = pickBestOutlineIcon(hyphenData?.icons);
    if (hyphenUrl) return { iconUrl: hyphenUrl, isLineArt: true };
  }

  // 3. Broad Iconify fallback preferring outline/line variants
  const broad = await fetchJsonWithTimeout(
    `https://api.iconify.design/search?query=${query}&limit=16`,
    2000,
    signal
  );
  if (broad?.icons?.length) {
    const outline =
      broad.icons.find(
        (n) => (n.includes('outline') || n.includes('line')) && !n.includes('fill') && !n.includes('color')
      ) ||
      broad.icons.find((n) => !n.includes('fill') && !n.includes('color') && !n.includes('brand'));
    if (outline) {
      const [prefix, iconName] = outline.split(':');
      return {
        iconUrl: `https://api.iconify.design/${prefix}/${iconName}.svg?color=${INK_COLOR_PARAM}`,
        isLineArt: true
      };
    }
    const [prefix, iconName] = broad.icons[0].split(':');
    return {
      iconUrl: `https://api.iconify.design/${prefix}/${iconName}.svg`,
      isLineArt: false
    };
  }

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
    const thumbnailUrl = data.thumbnail?.source || null;
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
