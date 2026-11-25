// Speak N Spell — Main Application Controller

import { getSyllables, checkIsProfane } from './syllables.js';
import { PICTURE_CATALOG, peekCachedMedia, resolveWordMedia } from './media.js';
import { SpeechEngine, SPEEDS } from './speech-engine.js';
import { renderMascotSvg } from './mascot.js';

// DOM Elements
const srAnnouncer = document.getElementById('srAnnouncer');
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
const offlineBadge = document.getElementById('offlineBadge');
const recentTray = document.getElementById('recentTray');

const picturesBtn = document.getElementById('picturesBtn');
const repeatBtn = document.getElementById('repeatBtn');
const practiceBtn = document.getElementById('practiceBtn');
const practiceIcon = document.getElementById('practiceIcon');
const practiceLabel = document.getElementById('practiceLabel');
const speedBtn = document.getElementById('speedBtn');
const speedLabel = document.getElementById('speedLabel');
const phonicsBtn = document.getElementById('phonicsBtn');
const phonicsLabel = document.getElementById('phonicsLabel');
const printBtn = document.getElementById('printBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const fullscreenIcon = document.getElementById('fullscreenIcon');
const fullscreenLabel = document.getElementById('fullscreenLabel');
const reloadBtn = document.getElementById('reloadBtn');

// Picture & Coloring Dialog nodes
const pictureDialog = document.getElementById('pictureDialog');
const closePicturesBtn = document.getElementById('closePicturesBtn');
const pictureTabs = document.getElementById('pictureTabs');
const pictureGrid = document.getElementById('pictureGrid');

// Whisper Loading Overlay nodes
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
let isPracticeHidden = false;
let activePictureCategory = PICTURE_CATALOG[0]?.category || 'Fruit';
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

function announceSR(text) {
  if (!srAnnouncer || !text) return;
  srAnnouncer.textContent = '';
  requestAnimationFrame(() => {
    srAnnouncer.textContent = text;
  });
}

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
      speechToggle.title = 'Did not match command — say Spell followed by a word';
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

function updateOnlineStatus() {
  if (!offlineBadge) return;
  offlineBadge.hidden = navigator.onLine !== false;
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

// --- Practice Mode (Cover & Check Active Recall) ---
function setPracticeHidden(hidden, { speakOnReveal = false } = {}) {
  isPracticeHidden = Boolean(hidden);
  document.body.classList.toggle('practice-hidden', isPracticeHidden);

  document.querySelectorAll('.letter-glyph').forEach((el) => {
    el.classList.toggle('letter-hidden', isPracticeHidden);
    el.classList.remove('letter-peeked');
  });

  if (practiceBtn && practiceLabel && practiceIcon) {
    practiceBtn.classList.toggle('active', isPracticeHidden);
    practiceBtn.setAttribute('aria-pressed', String(isPracticeHidden));
    practiceLabel.textContent = isPracticeHidden ? 'Reveal' : 'Practice';
    const title = isPracticeHidden
      ? 'Reveal full word to check spelling (H)'
      : 'Cover word to practice spelling (H)';
    practiceBtn.title = title;
    practiceBtn.setAttribute('aria-label', title);

    practiceIcon.innerHTML = isPracticeHidden
      ? '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
      : '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>';
  }

  if (isPracticeHidden) {
    speechEngine.cancelSpeech();
    if (promptText) promptText.textContent = 'Practice mode — click any blank for a hint';
    announceSR(`Practice mode on. ${currentWord.replace(/[^A-Za-z0-9]/g, '').length} hidden letters. Select any slot for a hint.`);
  } else {
    if (speechEngine.isEnabled) setMascotState('listening');
    if (speakOnReveal && currentWord && currentWord.toUpperCase() !== 'NO') {
      handleRepeat();
    }
  }
}

function togglePracticeMode() {
  if (!currentWord || currentWord.toUpperCase() === 'NO') return;
  const nextHidden = !isPracticeHidden;
  setPracticeHidden(nextHidden, { speakOnReveal: !nextHidden });
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

function flashAllLetters(token) {
  clearTimeout(flashClearTimer);
  document.querySelectorAll('.letter-glyph').forEach((el) => {
    el.classList.add('highlighted-letter');
  });
  flashClearTimer = setTimeout(() => {
    if (speechEngine.isTokenCurrent(token)) {
      clearLetterHighlights();
    }
  }, 550);
}

function onLetterTap(ch, idx) {
  const sel = window.getSelection ? window.getSelection().toString() : '';
  if (sel.length > 0) return;

  // In Practice mode, tapping a covered slot peeks just that letter as a gentle hint
  if (isPracticeHidden) {
    const matching = document.querySelectorAll(`.letter-glyph[data-char-idx="${idx}"]`);
    matching.forEach((el) => el.classList.add('letter-peeked'));

    const remainingHidden = document.querySelectorAll('#resultUpper .letter-glyph.letter-hidden:not(.letter-peeked)');
    if (remainingHidden.length === 0) {
      setPracticeHidden(false, { speakOnReveal: false });
    }
  }

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

async function printCurrentWorksheet() {
  // Ensure the coloring SVG/image is decoded before opening print dialog
  if (currentIconUrl && printArtImg && !printArtImg.complete) {
    await Promise.race([
      printArtImg.decode().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1200))
    ]);
  }
  window.print();
}

// --- Picture & Coloring Shelf Dialog ---
function renderPictureDialog() {
  if (!pictureTabs || !pictureGrid) return;

  pictureTabs.innerHTML = '';
  for (const group of PICTURE_CATALOG) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.role = 'tab';
    const isActive = group.category === activePictureCategory;
    tab.className = `dialog-tab${isActive ? ' active' : ''}`;
    tab.setAttribute('aria-selected', String(isActive));
    tab.textContent = group.category;
    tab.addEventListener('click', () => {
      activePictureCategory = group.category;
      renderPictureDialog();
    });
    pictureTabs.appendChild(tab);
  }

  const currentGroup =
    PICTURE_CATALOG.find((g) => g.category === activePictureCategory) || PICTURE_CATALOG[0];
  pictureGrid.classList.toggle('cols-3', currentGroup.items.length === 6);
  pictureGrid.innerHTML = '';

  for (const item of currentGroup.items) {
    const card = document.createElement('div');
    card.className = 'picture-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Spell ${item.word}`);

    const img = document.createElement('img');
    img.src = item.url;
    img.alt = '';
    img.loading = 'lazy';

    const label = document.createElement('span');
    label.className = 'picture-card-word';
    label.textContent = item.word;

    const printAction = document.createElement('button');
    printAction.type = 'button';
    printAction.className = 'picture-card-print';
    printAction.title = `Print coloring sheet for ${item.word}`;
    printAction.setAttribute('aria-label', `Print coloring sheet for ${item.word}`);
    printAction.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>';

    printAction.addEventListener('click', (e) => {
      e.stopPropagation();
      closePictureDialog();
      handleWordSelected(item.word, { fromCatalog: true, presetIconUrl: item.url, autoPrint: true });
    });

    const selectItem = () => {
      closePictureDialog();
      handleWordSelected(item.word, { fromCatalog: true, presetIconUrl: item.url });
    };

    card.addEventListener('click', selectItem);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectItem();
      }
    });

    card.appendChild(printAction);
    card.appendChild(img);
    card.appendChild(label);
    pictureGrid.appendChild(card);
  }
}

function openPictureDialog() {
  if (!pictureDialog) return;
  renderPictureDialog();
  if (typeof pictureDialog.showModal === 'function') {
    if (!pictureDialog.open) pictureDialog.showModal();
  } else {
    pictureDialog.setAttribute('open', '');
  }
}

function closePictureDialog() {
  if (!pictureDialog) return;
  if (typeof pictureDialog.close === 'function' && pictureDialog.open) {
    pictureDialog.close();
  } else {
    pictureDialog.removeAttribute('open');
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

// --- Core Word Flow (Race-Free, Leak-Free Lock & Zero Stale Image Flash) ---
async function handleWordSelected(
  rawWord,
  { fromRecent = false, fromCatalog = false, presetIconUrl = null, autoPrint = false } = {}
) {
  const myMatchSeq = ++spellingMatchSeq;
  if (activeMediaController) activeMediaController.abort();
  activeMediaController = new AbortController();
  const { signal } = activeMediaController;

  const lockToken = speechEngine.acquireLock();

  try {
    const word = String(rawWord || '').trim();
    if (!word) {
      speechEngine.releaseLock(lockToken);
      return;
    }

    if (!fromRecent && !fromCatalog) {
      const isBad = await checkIsProfane(word, signal);
      if (myMatchSeq !== spellingMatchSeq) {
        speechEngine.releaseLock(lockToken);
        return;
      }

      if (isBad) {
        if (isPracticeHidden) setPracticeHidden(false);
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
        speechEngine.speakMessage("Let's pick a different word.", getSpeechRate(), lockToken);
        return;
      }
    }

    if (isPracticeHidden) setPracticeHidden(false);

    currentWord = word;
    dockBrandHeader();
    renderWordLetters(word);
    updateSyllablesUI(word);
    recordRecentWord(word);
    setMascotState('listening');
    announceSR(`Spelling ${word}: ${word.toLowerCase().split('').join(' ')}`);

    // Immediately show cached/preset illustration OR clear stale illustration from previous word
    const cached = presetIconUrl
      ? { iconUrl: presetIconUrl, isLineArt: true, referenceUrl: '', serviceName: '' }
      : peekCachedMedia(word);

    if (cached && cached.iconUrl) {
      setDisplayMode(true, cached.iconUrl, { word, isLineArt: cached.isLineArt });
      if (cached.referenceUrl) {
        updateReferenceUI(cached.referenceUrl, cached.serviceName, word);
      }
    } else {
      setDisplayMode(false, null, { word });
    }

    scheduleResize();

    // Deduplicated parallel media & reference lookup
    resolveWordMedia(word, signal).then((media) => {
      if (!media || myMatchSeq !== spellingMatchSeq) return;
      updateReferenceUI(media.referenceUrl, media.serviceName, word);
      const finalIcon = presetIconUrl || media.iconUrl;
      const finalLineArt = presetIconUrl ? true : media.isLineArt;
      setDisplayMode(!!finalIcon, finalIcon, { word, isLineArt: finalLineArt });
    });

    if (autoPrint) {
      speechEngine.releaseLock(lockToken);
      await printCurrentWorksheet();
      return;
    }

    speechEngine.playEarcon(fromRecent ? 'repeat' : 'match');
    setTimeout(() => {
      if (myMatchSeq !== spellingMatchSeq || !speechEngine.isTokenCurrent(lockToken)) return;
      speechEngine.speakWord(word, {
        rate: getSpeechRate(),
        phonicsMode: isPhonicsMode,
        token: lockToken
      });
    }, 180);
  } catch (err) {
    console.warn('handleWordSelected error:', err);
    speechEngine.releaseLock(lockToken);
  }
}

function handleRepeat() {
  if (!currentWord || currentWord.toUpperCase() === 'NO') return;
  const lockToken = speechEngine.acquireLock();
  speechEngine.playEarcon('repeat');
  setTimeout(() => {
    if (!speechEngine.isTokenCurrent(lockToken)) return;
    speechEngine.speakWord(currentWord, {
      rate: getSpeechRate(),
      phonicsMode: isPhonicsMode,
      token: lockToken
    });
  }, 160);
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
  onFlashAll: (token) => flashAllLetters(token),
  onClearHighlights: () => clearLetterHighlights(),
  onWordMatched: (word) => {
    closePictureDialog();
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
picturesBtn?.addEventListener('click', openPictureDialog);
closePicturesBtn?.addEventListener('click', closePictureDialog);
pictureDialog?.addEventListener('click', (e) => {
  if (e.target === pictureDialog) closePictureDialog();
});

repeatBtn?.addEventListener('click', handleRepeat);
practiceBtn?.addEventListener('click', togglePracticeMode);
speedBtn?.addEventListener('click', cycleSpeed);
phonicsBtn?.addEventListener('click', togglePhonics);
printBtn?.addEventListener('click', printCurrentWorksheet);
fullscreenBtn?.addEventListener('click', toggleFullscreen);

syllablesEl?.addEventListener('click', () => {
  const sel = window.getSelection ? window.getSelection().toString() : '';
  if (sel.length > 0 || !currentWord || currentWord.toUpperCase() === 'NO') return;
  speechEngine.speakSlowWord(currentWord);
});
syllablesEl?.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && currentWord && currentWord.toUpperCase() !== 'NO') {
    e.preventDefault();
    speechEngine.speakSlowWord(currentWord);
  }
});

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

// Smart beforeunload: protect active sessions without blocking intentional reload button
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

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (pictureDialog?.open) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const key = e.key.toLowerCase();
  if ((e.key === ' ' && tag !== 'BUTTON' && tag !== 'A' && !document.activeElement?.classList.contains('letter-glyph') && document.activeElement !== syllablesEl) || key === 'r') {
    e.preventDefault();
    handleRepeat();
  } else if (key === 'm') {
    e.preventDefault();
    speechToggle?.click();
  } else if (key === 'p') {
    e.preventDefault();
    togglePhonics();
  } else if (key === 's') {
    e.preventDefault();
    cycleSpeed();
  } else if (key === 'h') {
    e.preventDefault();
    togglePracticeMode();
  } else if (key === 'b') {
    e.preventDefault();
    openPictureDialog();
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

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

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
updateOnlineStatus();
checkFullscreenSupport();
initPreferences();
loadRecentWords();
renderWordLetters(currentWord);
updateSyllablesUI(currentWord);
updateReferenceUI(currentDestinationUrl, 'Wikipedia', currentWord);
updatePrintWorksheet(currentWord, null);
requestWakeLock();
scheduleResize();

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
