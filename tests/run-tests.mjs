// Automated unit tests for Speak N Spell core modules (Node built-in assert, zero dependencies)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractTargetWord,
  splitWordSyllables,
  getSyllables,
  checkIsProfane,
  PHONICS_SOUNDS
} from '../js/syllables.js';
import {
  OFFLINE_STARTER_ICONS,
  PICTURE_CATALOG,
  singularizeWord,
  pickRelevantOutlineIcon,
  peekCachedMedia
} from '../js/media.js';
import {
  SpeechEngine,
  flattenFloat32Arrays,
  resampleTo16k,
  isWhisperHallucination,
  formatSpokenLetter
} from '../js/speech-engine.js';
import { renderMascotSvg } from '../js/mascot.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// 1. Transcript extraction
test('extractTargetWord: standard prompts', () => {
  assert.equal(extractTargetWord('How do you spell chicken?'), 'chicken');
  assert.equal(extractTargetWord('How do you spell, "chicken"?'), 'chicken');
  assert.equal(extractTargetWord('Spell dog'), 'dog');
  assert.equal(extractTargetWord('Please spell the word elephant for me'), 'elephant');
  assert.equal(extractTargetWord('Can you spell a dinosaur please'), 'dinosaur');
  assert.equal(extractTargetWord('Spell out butterfly thanks'), 'butterfly');
});

test('extractTargetWord: multi-word phrases and apostrophes', () => {
  assert.equal(extractTargetWord('Spell San Francisco'), 'San Francisco');
  assert.equal(extractTargetWord('How do you spell Madison Square Garden'), 'Madison Square Garden');
  assert.equal(extractTargetWord("How do you spell don't"), "don't");
  assert.equal(extractTargetWord('How do you spell ice-cream'), 'ice-cream');
  assert.equal(extractTargetWord('Spell one two three four five six'), 'one two three four');
});

test('extractTargetWord: kindergarten sight words work instead of failing', () => {
  assert.equal(extractTargetWord('How do you spell the'), 'the');
  assert.equal(extractTargetWord('Spell a'), 'a');
  assert.equal(extractTargetWord('How do you spell please'), 'please');
  assert.equal(extractTargetWord('Spell you'), 'you');
  assert.equal(extractTargetWord('Spell what'), 'what');
  assert.equal(extractTargetWord('Spell for'), 'for');
});

test('extractTargetWord: custom family pronunciations', () => {
  assert.equal(extractTargetWord('How do you spell Eva'), 'aoife');
  assert.equal(extractTargetWord('Spell Megan'), 'meaghan');
});

test('extractTargetWord: rejects unmatched speech and self-echo', () => {
  assert.equal(extractTargetWord('ill check in'), null);
  assert.equal(extractTargetWord('hello how are you'), null);
  assert.equal(extractTargetWord('How do you spell'), null);
  assert.equal(extractTargetWord('cat is spelled C, A, T'), null);
  assert.equal(extractTargetWord('C, A, T spells cat'), null);
  assert.equal(extractTargetWord(''), null);
});

// 2. Syllable splitting
test('splitWordSyllables: preserves single-syllable silent-e and -ed words', () => {
  assert.deepEqual(splitWordSyllables('cake'), ['cake']);
  assert.deepEqual(splitWordSyllables('smile'), ['smile']);
  assert.deepEqual(splitWordSyllables('snake'), ['snake']);
  assert.deepEqual(splitWordSyllables('bike'), ['bike']);
  assert.deepEqual(splitWordSyllables('house'), ['house']);
  assert.deepEqual(splitWordSyllables('walked'), ['walked']);
  assert.deepEqual(splitWordSyllables('cat'), ['cat']);
});

test('splitWordSyllables: accurately splits digraphs, consonant+le, double consonants, and dictionary words', () => {
  assert.equal(getSyllables('wonderful'), 'won · der · ful');
  assert.equal(getSyllables('chicken'), 'chick · en');
  assert.equal(getSyllables('mother'), 'moth · er');
  assert.equal(getSyllables('father'), 'fa · ther');
  assert.equal(getSyllables('teacher'), 'teach · er');
  assert.equal(getSyllables('San Francisco'), 'San · Fran · cis · co');
  assert.deepEqual(splitWordSyllables('table'), ['ta', 'ble']);
  assert.deepEqual(splitWordSyllables('candle'), ['can', 'dle']);
  assert.deepEqual(splitWordSyllables('wanted'), ['wan', 'ted']);
  assert.deepEqual(splitWordSyllables('kitten'), ['kit', 'ten']);
  assert.deepEqual(splitWordSyllables('pocket'), ['pock', 'et']);
  assert.deepEqual(splitWordSyllables('rocket'), ['rock', 'et']);
});

// 3. Icon relevance, plural singularization & instant starter cache peek
test('singularizeWord handles regular and -ies plurals without breaking -ss/-us/-is', () => {
  assert.equal(singularizeWord('apples'), 'apple');
  assert.equal(singularizeWord('butterflies'), 'butterfly');
  assert.equal(singularizeWord('boxes'), 'box');
  assert.equal(singularizeWord('princess'), 'princess');
  assert.equal(singularizeWord('octopus'), 'octopus');
  assert.equal(singularizeWord('bus'), 'bus');
});

test('pickRelevantOutlineIcon rejects unrelated substring matches and UI clutter', () => {
  assert.equal(pickRelevantOutlineIcon(['tabler:thermometer', 'lucide:theater'], 'the'), null);
  assert.equal(pickRelevantOutlineIcon(['tabler:forklift', 'tabler:format'], 'for'), null);
  assert.equal(pickRelevantOutlineIcon(['tabler:category', 'lucide:cat-off', 'lucide:cat'], 'cat'),
    'https://api.iconify.design/lucide/cat.svg?color=%231d1a16');
  assert.equal(pickRelevantOutlineIcon(['tabler:brand-apple', 'lucide:apple'], 'apples'),
    'https://api.iconify.design/lucide/apple.svg?color=%231d1a16');
  assert.equal(pickRelevantOutlineIcon(['lucide:ice-cream-cone', 'lucide:ice-cream'], 'ice cream'),
    'https://api.iconify.design/lucide/ice-cream.svg?color=%231d1a16');
});

test('peekCachedMedia instantaneously resolves offline starter words and their plurals', () => {
  const apple = peekCachedMedia('apples');
  assert.ok(apple && apple.iconUrl.includes('lucide/apple.svg'));
  const butterfly = peekCachedMedia('butterflies');
  assert.ok(butterfly && butterfly.iconUrl.includes('tabler/butterfly.svg'));
  assert.equal(peekCachedMedia('xylophone'), null);
});

// 4. Audio DSP & SpeechEngine lock lifecycle
test('flattenFloat32Arrays, resampleTo16k, and formatSpokenLetter', () => {
  const flat = flattenFloat32Arrays([new Float32Array([1, 2]), new Float32Array([3, 4, 5])]);
  assert.deepEqual(Array.from(flat), [1, 2, 3, 4, 5]);

  const orig = new Float32Array(48000);
  orig.fill(0.5);
  const resampled = resampleTo16k(orig, 48000);
  assert.equal(resampled.length, 16000);
  assert.ok(Math.abs(resampled[100] - 0.5) < 1e-5);

  assert.equal(formatSpokenLetter('a'), 'A.');
  assert.equal(formatSpokenLetter('Z'), 'Z.');
});

test('SpeechEngine playback lock token invalidates stale locks cleanly', () => {
  const engine = new SpeechEngine();
  const t1 = engine.acquireLock();
  assert.equal(engine.isSpeaking, true);
  assert.equal(engine.isTokenCurrent(t1), true);

  const t2 = engine.acquireLock();
  assert.equal(engine.isTokenCurrent(t1), false);
  assert.equal(engine.isTokenCurrent(t2), true);

  // Stale release must be ignored
  engine.releaseLock(t1);
  assert.equal(engine.isSpeaking, true);
  engine.cancelSpeech();
  assert.equal(engine.isSpeaking, false);
});

test('isWhisperHallucination filters silence artifacts', () => {
  assert.equal(isWhisperHallucination(''), true);
  assert.equal(isWhisperHallucination('Thank you.'), true);
  assert.equal(isWhisperHallucination('[BLANK_AUDIO]'), true);
  assert.equal(isWhisperHallucination('(music)'), true);
  assert.equal(isWhisperHallucination('How do you spell cat?'), false);
});

// 5. Mascot SVG & Phonics coverage
test('renderMascotSvg generates valid static SVGs for all 3 states without emojis', () => {
  for (const state of ['listening', 'retry', 'muted']) {
    const svg = renderMascotSvg(state);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(svg));
  }
});

test('PHONICS_SOUNDS covers all 26 letters and 10 digits', () => {
  for (const ch of 'abcdefghijklmnopqrstuvwxyz0123456789') {
    assert.ok(typeof PHONICS_SOUNDS[ch] === 'string' && PHONICS_SOUNDS[ch].length > 0, `Missing phonics for ${ch}`);
  }
});

// 6. Offline precache synchronization (sw.js vs PICTURE_CATALOG & OFFLINE_STARTER_ICONS)
test('sw.js precaches all static modules, catalog items, and starter icons', () => {
  const swSource = readFileSync(resolve(rootDir, 'sw.js'), 'utf8');
  for (const mod of ['styles.css', 'js/app.js', 'js/mascot.js', 'js/media.js', 'js/speech-engine.js', 'js/syllables.js', 'js/vad-worklet.js', 'js/whisper-worker.js']) {
    assert.ok(swSource.includes(mod), `sw.js missing static asset: ${mod}`);
  }
  const uniqueUrls = new Set(Object.values(OFFLINE_STARTER_ICONS));
  for (const group of PICTURE_CATALOG) {
    for (const item of group.items) uniqueUrls.add(item.url);
  }
  for (const url of uniqueUrls) {
    assert.ok(swSource.includes(url), `sw.js missing offline starter icon: ${url}`);
  }
});

// 7. Local profanity filter
await (async () => {
  assert.equal(await checkIsProfane('poop'), true);
  assert.equal(await checkIsProfane('big fart'), true);
  passed++;
})();

// 8. Unslop & build stamp invariants
test('index.html and styles.css contain no emojis, no transition-all, and Eastern TZ build stamp', () => {
  const html = readFileSync(resolve(rootDir, 'index.html'), 'utf8');
  const css = readFileSync(resolve(rootDir, 'styles.css'), 'utf8');
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(html), 'index.html should not contain raw emojis');
  assert.ok(!/transition\s*:\s*all\b/.test(css), 'styles.css should not use transition: all');
  assert.ok(/Built \d{4}-\d{2}-\d{2} \d{2}:\d{2} (?:EST|EDT)/.test(html), 'Build stamp must be in Eastern TZ');
});

console.log(`All ${passed} test suites passed.`);
