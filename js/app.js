// Speak N Spell — Main Application Controller

import { getSyllables, checkIsProfane } from './syllables.js';
import { resolveWordMedia } from './media.js';
import { SpeechEngine, SPEEDS } from './speech-engine.js';
import { renderMascotSvg } from './mascot.js';

// DOM Elements
const displayArea = document.getElementById('displayArea');
const upperEl = document.getElementById('resultUpper');
const lowerEl = document.getElementById('resultLower');
const syllablesEl = document.getElementById('syllablesDisplay');
const metaSep = document.getElementById('metaSep');
const lookupLink = document.getElementById('lookupLink');
const lookupLabel = document.getElementById('lookupLabel');
const pictureContainer = document.getElementById('pictureContainer');
const wordImage = document.getElementById('wordImage');
const pictureCaption = document.getElementById('pictureCaption');

const voiceCompanion = document.getElementById('voiceCompanion');
const bottomLeft = document.getElementById('bottomLeft');
const speechToggle = document.getElementById('speechToggle');
const promptText = document.getElementById('promptText');
const heardHint = document.getElementById('heardHint');
const voiceMeter = document.getElementById('voiceMeter');
const voiceBars = voiceMeter ? Array.from(voiceMeter.querySelectorAll('span')) : [];
const infoEl = document.getElementById('info');
const recentTray = document.getElementById('recentTray');

const repeatBtn = document.getElementById('repeatBtn');
const speedBtn = document.getElementById('speedBtn');
const speedLabel = document.getElementById('speedLabel');
const phonicsBtn = document.getElementById('phonicsBtn');
const phonicsLabel = document.getElementById('phonicsLabel');
const printBtn = document.getElementById('printBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const fullscreenIcon = document.getElementById('fullscreenIcon');
const fullscreenLabel = document.getElementById('fullscreenLabel');
const reloadBtn = document.getElementById('reloadBtn');

const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMascot = document.getElementById('loadingMascot');
const loadingStatus = document.getElementById('loadingStatus');
const progressBar = document.getElementById('progressBar');
const startMicBtn = document.getElementById('startMicBtn');

// Print worksheet nodes
const printArtFrame = document.getElementById('printArtFrame');
const printArtImg = document.getElementById('printArtImg');
const printUpper = document.getElementById('printUpper');
const printLower = document.getElementById('printLower');
const printSyllables = document.getElementById('printSyllables');
const printTraceUpper = document.getElementById('printTraceUpper');
const printTraceLower = document.getElementById('printTraceLower');
const printDate = document.getElementById('printDate');

// App State
const MAX_RECENT_WORDS = 8;
let currentWord = 'wonderful';
let currentDestinationUrl = 'https://en.wikipedia.org/wiki/Wonderful';
let currentIconUrl = null;
let currentSpeedIndex = 0;
let isPhonicsMode = false;
let hasSpelledAny = false;
let recentWords = [];

let spellingMatchSeq = 0;
let activeMediaController = null;
let resetMascotTimer = null;
let flashClearTimer = null;
let resizeRafId = null;
let wakeLockSentinel = null;

// Cached canvas for fast font width measurement
const textMeasureCanvas = document.createElement('canvas');

// --- Mascot & Prompt Status ---
function setMascotState(state, message, { isError = false, heard = '' } = {}) {
  clearTimeout(resetMascotTimer);

  if (speechToggle) {
    speechToggle.innerHTML = renderMascotSvg(state);
    if (state === 'listening') {
      speechToggle.title = 'Speech mode on — click or press M to mute';
      speechToggle.setAttribute('aria-label', 'Speech mode on');
      speechToggle.setAttribute('aria-pressed', 'true');
    } else if (state === 'muted') {
      speechToggle.title = 'Speech mode off — click or press M to listen';
      speechToggle.setAttribute('aria-label', 'Speech mode off');
      speechToggle.setAttribute('aria-pressed', 'false');
    } else {
      speechToggle.title = 'Did not match command — try saying Spell followed by a word';
      speechToggle.setAttribute('aria-label', 'Did not match spelling command');
    }
  }

  if (voiceMeter) {
    voiceMeter.classList.toggle('muted', state === 'muted');
  }

  if (promptText) {
    promptText.classList.toggle('status-error', isError);
    if (message) {
      promptText.textContent = message;
    } else if (state === 'listening') {
      promptText.textContent = 'Say "Spell ______"';
    } else if (state === 'muted') {
      promptText.textContent = 'Microphone muted — click the monkey to listen';
    } else {
      promptText.textContent = 'Say "Spell [word]" — for example, "Spell dog"';
    }
  }

  if (heardHint) {
    if (heard) {
      const clipped = heard.length > 42 ? `${heard.slice(0, 42)}…` : heard;
      heardHint.textContent = `Heard "${clipped}"`;
    } else if (state === 'listening' || state === 'muted') {
      heardHint.textContent = '';
    }
  }

  if (state === 'retry') {
    resetMascotTimer = setTimeout(() => {
      if (speechEngine.isEnabled && !speechEngine.isSpeaking) {
        setMascotState('listening');
      }
    }, 3200);
  }
}

function updateVoiceMeter(level) {
  if (!voiceBars.length) return;
  const clamped = Math.max(0, Math.min(1, level));
  const weights = [0.65, 1.0, 0.75];
  for (let i = 0; i < voiceBars.length; i++) {
    const h = clamped > 0.05 ? Math.round(4 + clamped * weights[i] * 12) : 4;
    voiceBars[i].style.height = `${h}px`;
    voiceBars[i].style.opacity = clamped > 0.05 ? '0.95' : '0.35';
  }
}

// --- Typography & Responsive Sizing ---
function resizeElementText(element, targetWidth, isMobileSplit) {
  if (!element) return;
  const text = element.textContent || '';
  if (!text) return;

  const ctx = textMeasureCanvas.getContext('2d');
  const style = window.getComputedStyle(element);
  const baseFontSize = 100;
  const fontWeight = style.fontWeight || (element === upperEl ? '600' : '400');
  const fontFamily = style.fontFamily || 'Open Sans, sans-serif';
  ctx.font = `${fontWeight} ${baseFontSize}px ${fontFamily}`;

  const measuredWidth = ctx.measureText(text).width || 1;
  const vh = window.innerHeight || 800;
  const maxFontHeight = isMobileSplit ? vh * 0.14 : (hasSpelledAny ? vh * 0.21 : vh * 0.19);
  let newFontSize = Math.min((targetWidth / measuredWidth) * baseFontSize, maxFontHeight);
  newFontSize = Math.max(24, newFontSize);
  element.style.fontSize = `${newFontSize}px`;

  // Final DOM safety clamp so long words never clip horizontally
  const actualWidth = element.scrollWidth;
  if (actualWidth > targetWidth && actualWidth > 0) {
    element.style.fontSize = `${Math.max(20, newFontSize * (targetWidth / actualWidth))}px`;
  }
}

function resizeAll() {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const isSplit = displayArea.classList.contains('has-split');
  const isMobile = vw <= 768;
  const horizontalPad = isMobile ? 32 : 64;
  const maxStage = Math.min(vw, 1440) - horizontalPad;
  const targetWidth = isSplit && !isMobile ? Math.max(220, maxStage * 0.63) : Math.max(200, maxStage);

  resizeElementText(upperEl, targetWidth, isMobile && isSplit);
  resizeElementText(lowerEl, targetWidth, isMobile && isSplit);
}

function scheduleResize() {
  if (resizeRafId) cancelAnimationFrame(resizeRafId);
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null;
    resizeAll();
  });
}

// --- Interactive Letter Rendering & Sync Highlighting ---
function clearLetterHighlights() {
  clearTimeout(flashClearTimer);
  document.querySelectorAll('.letter-glyph.highlighted-letter').forEach((el) => {
    el.classList.remove('highlighted-letter');
  });
}

function highlightLetterAtIndex(idx) {
  clearTimeout(flashClearTimer);
  document.querySelectorAll('.letter-glyph.highlighted-letter').forEach((el) => {
    el.classList.remove('highlighted-letter');
  });
  if (idx < 0) return;
  document.querySelectorAll(`.letter-glyph[data-char-idx="${idx}"]`).forEach((el) => {
    el.classList.add('highlighted-letter');
  });
}

function flashAllLetters(seq) {
  clearTimeout(flashClearTimer);
  document.querySelectorAll('.letter-glyph').forEach((el) => {
    el.classList.add('highlighted-letter');
  });
  flashClearTimer = setTimeout(() => {
    if (seq === speechEngine.speechPlaybackSeq) {
      clearLetterHighlights();
    }
  }, 550);
}

function onLetterTap(ch, idx) {
  const sel = window.getSelection ? window.getSelection().toString() : '';
  if (sel.length > 0) return; // User is selecting text, do not interrupt with click
  speechEngine.speakSingleLetter(ch, idx, {
    rate: getSpeechRate(),
    phonicsMode: isPhonicsMode
  });
}

function createLetterLine(container, chars, rawChars) {
  container.innerHTML = '';
  let charIdx = 0;

  for (let i = 0; i < rawChars.length; i++) {
    const raw = rawChars[i];
    const displayChar = chars[i];

    if (raw === ' ') {
      const spaceSpan = document.createElement('span');
      spaceSpan.className = 'letter-space';
      spaceSpan.textContent = ' ';
      container.appendChild(spaceSpan);
      continue;
    }

    const isAlpha = /[A-Za-z0-9]/.test(raw);
    const span = document.createElement('span');
    span.textContent = displayChar;

    if (isAlpha) {
      const thisIdx = charIdx++;
      span.className = 'letter-glyph';
      span.dataset.charIdx = String(thisIdx);
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      span.setAttribute('aria-label', `Hear letter ${raw.toUpperCase()}`);
      span.title = `Hear "${raw.toUpperCase()}"`;
      span.addEventListener('click', () => onLetterTap(raw, thisIdx));
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onLetterTap(raw, thisIdx);
        }
      });
    }

    container.appendChild(span);
  }
}

function renderWordLetters(word) {
  clearLetterHighlights();
  const rawChars = word.split('');
  createLetterLine(upperEl, word.toUpperCase().split(''), rawChars);
  createLetterLine(lowerEl, word.toLowerCase().split(''), rawChars);
}

function updateSyllablesUI(word) {
  if (!syllablesEl) return;
  if (!word || word.toUpperCase() === 'NO') {
    syllablesEl.textContent = '';
    syllablesEl.style.display = 'none';
    if (metaSep) metaSep.style.display = 'none';
    return;
  }
  const text = getSyllables(word);
  syllablesEl.textContent = text;
  syllablesEl.style.display = text ? 'inline' : 'none';
  if (metaSep) metaSep.style.display = text && currentDestinationUrl ? 'inline' : 'none';
}

function updateReferenceUI(url, serviceName, word) {
  currentDestinationUrl = url || '';
  const tooltip = word && serviceName ? `Open "${word}" on ${serviceName}` : '';

  if (pictureContainer) {
    pictureContainer.title = tooltip;
    pictureContainer.setAttribute('aria-label', tooltip);
  }
  if (lookupLink && lookupLabel) {
    if (currentDestinationUrl) {
      lookupLink.href = currentDestinationUrl;
      lookupLabel.textContent = serviceName || 'Lookup';
      lookupLink.title = tooltip;
      lookupLink.style.display = 'inline-flex';
    } else {
      lookupLink.style.display = 'none';
    }
  }
  if (metaSep) {
    metaSep.style.display = syllablesEl?.textContent && currentDestinationUrl ? 'inline' : 'none';
  }
}

function setDisplayMode(hasIcon, imageUrl, { word = '', isLineArt = true } = {}) {
  currentIconUrl = hasIcon && imageUrl ? imageUrl : null;

  if (currentIconUrl) {
    wordImage.src = currentIconUrl;
    wordImage.alt = word ? `Illustration for ${word}` : '';
    wordImage.style.display = 'block';
    if (pictureCaption) {
      pictureCaption.textContent = isLineArt ? 'Draw & color' : 'Reference';
    }
    displayArea.classList.remove('no-split');
    displayArea.classList.add('has-split');
  } else {
    wordImage.src = '';
    wordImage.alt = '';
    wordImage.style.display = 'none';
    displayArea.classList.remove('has-split');
    displayArea.classList.add('no-split');
  }

  updatePrintWorksheet(word || currentWord, currentIconUrl);
  scheduleResize();
}

wordImage.addEventListener('error', () => {
  setDisplayMode(false);
});

// --- Printable Coloring & Handwriting Worksheet ---
function updatePrintWorksheet(word, iconUrl) {
  if (!printUpper || !printLower) return;
  const clean = word && word.toUpperCase() !== 'NO' ? word : '';
  printUpper.textContent = clean.toUpperCase();
  printLower.textContent = clean.toLowerCase();
  if (printSyllables) {
    printSyllables.textContent = clean ? getSyllables(clean) : '';
  }
  if (printTraceUpper) {
    printTraceUpper.textContent = clean.toUpperCase();
  }
  if (printTraceLower) {
    printTraceLower.textContent = clean.toLowerCase();
  }
  if (printDate) {
    printDate.textContent = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
  if (printArtFrame && printArtImg) {
    if (iconUrl) {
      printArtImg.src = iconUrl;
      printArtImg.alt = clean ? `Coloring picture for ${clean}` : '';
      printArtFrame.classList.remove('empty');
    } else {
      printArtImg.src = '';
      printArtFrame.classList.add('empty');
    }
  }
}

// --- Recent Words Session Tray ---
function loadRecentWords() {
  try {
    const saved = sessionStorage.getItem('speak_recent_words');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        recentWords = parsed.filter((w) => typeof w === 'string' && w.trim()).slice(0, MAX_RECENT_WORDS);
      }
    }
  } catch {}
  renderRecentTray();
}

function recordRecentWord(word) {
  const clean = word.trim();
  if (!clean || clean.toUpperCase() === 'NO') return;
  recentWords = [clean, ...recentWords.filter((w) => w.toLowerCase() !== clean.toLowerCase())].slice(
    0,
    MAX_RECENT_WORDS
  );
  try {
    sessionStorage.setItem('speak_recent_words', JSON.stringify(recentWords));
  } catch {}
  renderRecentTray();
}

function renderRecentTray() {
  if (!recentTray) return;
  recentTray.innerHTML = '';

  if (recentWords.length === 0) {
    recentTray.classList.remove('has-items');
    return;
  }

  recentTray.classList.add('has-items');
  const label = document.createElement('span');
  label.className = 'recent-label';
  label.textContent = 'Recent';
  recentTray.appendChild(label);

  for (const w of recentWords) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-chip';
    if (w.toLowerCase() === currentWord.toLowerCase()) {
      btn.classList.add('active');
    }
    btn.textContent = w.toLowerCase();
    btn.title = `Spell "${w}" again`;
    btn.addEventListener('click', () => {
      handleWordSelected(w, { fromRecent: true });
    });
    recentTray.appendChild(btn);
  }
}

function dockBrandHeader() {
  if (hasSpelledAny) return;
  hasSpelledAny = true;
  document.body.classList.add('has-spelled');
  if (voiceCompanion && bottomLeft && voiceCompanion.parentElement !== bottomLeft) {
    bottomLeft.prepend(voiceCompanion);
  }
  scheduleResize();
}

// --- Speed & Phonics Preferences ---
function getSpeechRate() {
  return SPEEDS[currentSpeedIndex].rate;
}

function initPreferences() {
  try {
    const savedSpeed = localStorage.getItem('speak_speed');
    if (savedSpeed) {
      const idx = SPEEDS.findIndex((s) => s.id === savedSpeed);
      if (idx !== -1) currentSpeedIndex = idx;
    }
    isPhonicsMode = localStorage.getItem('speak_phonics') === 'true';
  } catch {}
  updateSpeedUI();
  updatePhonicsUI();
}

function updateSpeedUI() {
  const speed = SPEEDS[currentSpeedIndex];
  if (speedLabel) speedLabel.textContent = speed.label;
  if (speedBtn) {
    speedBtn.title = speed.title;
    speedBtn.setAttribute('aria-label', speed.title);
  }
}

function cycleSpeed() {
  currentSpeedIndex = (currentSpeedIndex + 1) % SPEEDS.length;
  try {
    localStorage.setItem('speak_speed', SPEEDS[currentSpeedIndex].id);
  } catch {}
  updateSpeedUI();
}

function updatePhonicsUI() {
  if (phonicsLabel) phonicsLabel.textContent = isPhonicsMode ? 'Phonics' : 'Letters';
  if (phonicsBtn) {
    phonicsBtn.classList.toggle('active', isPhonicsMode);
    const title = isPhonicsMode
      ? 'Mode: Phonics sounds (P to switch to Letters)'
      : 'Mode: Letter names (P to switch to Phonics)';
    phonicsBtn.title = title;
    phonicsBtn.setAttribute('aria-label', title);
    phonicsBtn.setAttribute('aria-pressed', String(isPhonicsMode));
  }
}

function togglePhonics() {
  isPhonicsMode = !isPhonicsMode;
  try {
    localStorage.setItem('speak_phonics', String(isPhonicsMode));
  } catch {}
  updatePhonicsUI();
}

// --- Core Word Flow (Race-Free & Immediately Echo-Locked) ---
async function handleWordSelected(rawWord, { fromRecent = false } = {}) {
  const myMatchSeq = ++spellingMatchSeq;
  if (activeMediaController) activeMediaController.abort();
  activeMediaController = new AbortController();
  const { signal } = activeMediaController;

  // Lock microphone immediately so chimes/speech never feed back into dictation
  speechEngine.speechPlaybackSeq++;
  const lockSeq = speechEngine.speechPlaybackSeq;
  speechEngine.beginSpeakingLock();

  const word = rawWord.trim();
  if (!word) {
    speechEngine.endSpeakingLock(lockSeq);
    return;
  }

  if (!fromRecent) {
    const isBad = await checkIsProfane(word, signal);
    if (myMatchSeq !== spellingMatchSeq) return;

    if (isBad) {
      currentWord = 'NO';
      setDisplayMode(false);
      upperEl.textContent = 'NO';
      lowerEl.textContent = 'no';
      clearLetterHighlights();
      updateSyllablesUI('');
      updateReferenceUI('', '', '');
      updatePrintWorksheet('', null);
      scheduleResize();
      setMascotState('muted', "Let's pick a different word", { isError: true });
      speechEngine.speakMessage("Let's pick a different word.", getSpeechRate());
      return;
    }
  }

  currentWord = word;
  dockBrandHeader();
  renderWordLetters(word);
  updateSyllablesUI(word);
  updatePrintWorksheet(word, null);
  recordRecentWord(word);
  setMascotState('listening');
  scheduleResize();

  // Deduplicated parallel media + Wikipedia lookup (non-blocking)
  resolveWordMedia(word, signal).then((media) => {
    if (!media || myMatchSeq !== spellingMatchSeq) return;
    updateReferenceUI(media.referenceUrl, media.serviceName, word);
    setDisplayMode(!!media.iconUrl, media.iconUrl, { word, isLineArt: media.isLineArt });
  });

  speechEngine.playEarcon(fromRecent ? 'repeat' : 'match');
  setTimeout(() => {
    if (myMatchSeq !== spellingMatchSeq || lockSeq !== speechEngine.speechPlaybackSeq) return;
    speechEngine.speakWord(word, {
      rate: getSpeechRate(),
      phonicsMode: isPhonicsMode
    });
  }, 200);
}

function handleRepeat() {
  if (!currentWord || currentWord.toUpperCase() === 'NO') return;
  const lockSeq = ++speechEngine.speechPlaybackSeq;
  speechEngine.beginSpeakingLock();
  speechEngine.playEarcon('repeat');
  setTimeout(() => {
    if (lockSeq !== speechEngine.speechPlaybackSeq) return;
    speechEngine.speakWord(currentWord, {
      rate: getSpeechRate(),
      phonicsMode: isPhonicsMode
    });
  }, 180);
}

// --- Wake Lock & Fullscreen ---
async function requestWakeLock() {
  if (document.visibilityState !== 'visible') return;
  if ('wakeLock' in navigator && typeof navigator.wakeLock?.request === 'function') {
    try {
      if (wakeLockSentinel && !wakeLockSentinel.released) return;
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch {}
  }
}

function isFullscreenActive() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

async function toggleFullscreen() {
  try {
    if (!isFullscreenActive()) {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen) await el.mozRequestFullScreen();
      requestWakeLock();
    } else {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      else if (document.mozCancelFullScreen) await document.mozCancelFullScreen();
    }
  } catch {}
}

function updateFullscreenUI() {
  if (!fullscreenBtn || !fullscreenIcon || !fullscreenLabel) return;
  const inFull = isFullscreenActive();
  fullscreenBtn.classList.toggle('active', inFull);
  fullscreenBtn.title = inFull ? 'Exit full screen' : 'Enter full screen';
  fullscreenBtn.setAttribute('aria-label', fullscreenBtn.title);
  fullscreenLabel.textContent = inFull ? 'Exit' : 'Fullscreen';
  fullscreenIcon.innerHTML = inFull
    ? '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>'
    : '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>';
}

function checkFullscreenSupport() {
  if (!fullscreenBtn) return;
  const el = document.documentElement;
  const supported = !!(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen);
  if (!supported) fullscreenBtn.style.display = 'none';
}

// --- Speech Engine Wiring ---
const speechEngine = new SpeechEngine({
  onListeningState: () => {
    infoEl.textContent = '';
    setMascotState('listening');
  },
  onAudioLevel: (level) => updateVoiceMeter(level),
  onHighlightLetter: (idx) => highlightLetterAtIndex(idx),
  onFlashAll: (seq) => flashAllLetters(seq),
  onClearHighlights: () => clearLetterHighlights(),
  onWordMatched: (word) => {
    handleWordSelected(word);
  },
  onUnmatchedSpeech: (transcript) => {
    setMascotState('retry', '', { heard: transcript });
  },
  onMicBlocked: () => {
    setMascotState('muted');
    infoEl.textContent = 'Microphone access blocked — allow access in browser settings and click the monkey';
  },
  onWhisperProgress: (pct, text) => {
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (loadingStatus) loadingStatus.textContent = text;
  },
  onWhisperReady: () => {
    if (progressBar) progressBar.style.width = '100%';
    if (loadingStatus) loadingStatus.textContent = 'Speech engine ready';
    if (startMicBtn) startMicBtn.style.display = 'inline-flex';
    setTimeout(() => {
      if (loadingOverlay && loadingOverlay.style.display !== 'none') {
        loadingOverlay.style.display = 'none';
        speechEngine.startWhisperMic();
      }
    }, 700);
  },
  onWhisperError: () => {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    setMascotState('retry', 'Speech engine unavailable — click the monkey to retry', { isError: true });
    infoEl.textContent = 'Could not load offline speech engine — check your connection and retry';
  }
});

// --- Event Listeners ---
repeatBtn?.addEventListener('click', handleRepeat);
speedBtn?.addEventListener('click', cycleSpeed);
phonicsBtn?.addEventListener('click', togglePhonics);
printBtn?.addEventListener('click', () => window.print());
fullscreenBtn?.addEventListener('click', toggleFullscreen);

pictureContainer?.addEventListener('click', () => {
  if (currentDestinationUrl) {
    window.open(currentDestinationUrl, '_blank', 'noopener,noreferrer');
  }
});
pictureContainer?.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && currentDestinationUrl) {
    e.preventDefault();
    window.open(currentDestinationUrl, '_blank', 'noopener,noreferrer');
  }
});

speechToggle?.addEventListener('click', () => {
  spellingMatchSeq++;
  if (activeMediaController) activeMediaController.abort();
  const enabled = speechEngine.toggleEnabled();
  if (enabled) {
    infoEl.textContent = '';
    requestWakeLock();
    setMascotState('listening');
  } else {
    setMascotState('muted');
  }
});

startMicBtn?.addEventListener('click', () => {
  if (loadingOverlay) loadingOverlay.style.display = 'none';
  requestWakeLock();
  speechEngine.startWhisperMic();
});

// Smart beforeunload: protect active kids' sessions without blocking intentional reload button
let allowUnload = false;
window.addEventListener('beforeunload', (event) => {
  if (!hasSpelledAny || allowUnload) return;
  event.preventDefault();
  event.returnValue = '';
});

reloadBtn?.addEventListener('click', () => {
  allowUnload = true;
  location.reload();
});

// Keyboard shortcuts for parents/teachers (safely skip modified or focused-link presses)
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if ((e.key === ' ' && tag !== 'BUTTON' && tag !== 'A' && !document.activeElement?.classList.contains('letter-glyph')) || e.key.toLowerCase() === 'r') {
    e.preventDefault();
    handleRepeat();
  } else if (e.key.toLowerCase() === 'm') {
    e.preventDefault();
    speechToggle?.click();
  } else if (e.key.toLowerCase() === 'p') {
    e.preventDefault();
    togglePhonics();
  } else if (e.key.toLowerCase() === 's') {
    e.preventDefault();
    cycleSpeed();
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && recentWords.length > 1) {
    e.preventDefault();
    const curIdx = recentWords.findIndex((w) => w.toLowerCase() === currentWord.toLowerCase());
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = curIdx === -1 ? 0 : (curIdx + delta + recentWords.length) % recentWords.length;
    handleWordSelected(recentWords[nextIdx], { fromRecent: true });
  }
});

['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange'].forEach((evt) => {
  document.addEventListener(evt, updateFullscreenUI);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

window.addEventListener('focus', requestWakeLock);
['click', 'touchstart', 'pointerdown'].forEach((evt) => {
  window.addEventListener(evt, () => {
    if (!wakeLockSentinel) requestWakeLock();
  }, { passive: true });
});

window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(scheduleResize);
}

// --- Bootstrap ---
if (loadingMascot) loadingMascot.innerHTML = renderMascotSvg('listening');
setMascotState('listening');
checkFullscreenSupport();
initPreferences();
loadRecentWords();
renderWordLetters(currentWord);
updateSyllablesUI(currentWord);
updateReferenceUI(currentDestinationUrl, 'Wikipedia', currentWord);
updatePrintWorksheet(currentWord, null);
requestWakeLock();
scheduleResize();

// Pre-resolve starter word reference calmly
resolveWordMedia(currentWord).then((media) => {
  if (!media || currentWord !== 'wonderful') return;
  updateReferenceUI(media.referenceUrl, media.serviceName, currentWord);
});

speechEngine.init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}
