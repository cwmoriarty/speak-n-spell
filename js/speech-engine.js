// Unified Speech Recognition (Web Speech API + Off-Main-Thread Whisper VAD) & Hybrid Synchronized TTS Engine

import { PHONICS_SOUNDS, extractTargetWord } from './syllables.js';

export const SPEEDS = Object.freeze([
  { id: 'normal', label: 'Normal', rate: 0.92, title: 'Spelling speed: Normal (S to change)' },
  { id: 'slow', label: 'Slow', rate: 0.72, title: 'Spelling speed: Slow (S to change)' },
  { id: 'fast', label: 'Fast', rate: 1.15, title: 'Spelling speed: Fast (S to change)' }
]);

const WHISPER_NOISE_HALLUCINATIONS = new Set([
  '', 'you', 'thank you', 'thanks', 'thanks for watching',
  'bye', 'goodbye', 'hmm', 'uh', 'um', 'blank audio', 'silence', 'music'
]);

export function flattenFloat32Arrays(chunks) {
  let totalLength = 0;
  for (let i = 0; i < chunks.length; i++) totalLength += chunks[i].length;
  const flat = new Float32Array(totalLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    flat.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return flat;
}

export function resampleTo16k(audioData, origSampleRate) {
  if (!origSampleRate || origSampleRate === 16000) return audioData;
  const ratio = origSampleRate / 16000;
  const newLength = Math.round(audioData.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < audioData.length; i++) {
      accum += audioData[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : (audioData[offsetBuffer] || 0);
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

export function isWhisperHallucination(transcript) {
  if (!transcript || typeof transcript !== 'string') return true;
  const trimmed = transcript.trim();
  if (!trimmed) return true;
  if (/^\[.*\]$/.test(trimmed) || /^\(.*\)$/.test(trimmed)) return true;
  const bare = trimmed.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  return WHISPER_NOISE_HALLUCINATIONS.has(bare);
}

/**
 * Format a standalone letter so TTS engines pronounce its letter name clearly
 * (e.g. prevents bare "A" from being reduced to schwa "uh").
 */
export function formatSpokenLetter(ch) {
  const upper = String(ch || '').toUpperCase();
  return upper ? `${upper}.` : '';
}

export class SpeechEngine {
  constructor(callbacks = {}) {
    this.cb = callbacks;

    // Core finite state
    this.isEnabled = true;
    this.isRecognizing = false;
    this.isSpeaking = false;
    this.speechDetected = false;
    this.recognition = null;
    this.voices = [];

    // Encapsulated playback sequence locking (prevents echo & overlapping timers)
    this.activeUtterance = null;
    this.playbackToken = 0;
    this.speechCooldownTimer = null;
    this.speechStepTimer = null;
    this.speechWatchdogTimer = null;
    this.recognitionRestartTimer = null;
    this.toggleResumeTimer = null;
    this.fallbackHighlightTimers = [];
    this.restartBackoffMs = 300;

    // Earcon AudioContext (separate from mic capture)
    this.earconCtx = null;

    // Firefox / Fallback VAD & Worker Whisper state
    this.useWhisper = false;
    this.whisperWorker = null;
    this.whisperReady = false;
    this.whisperInitStarted = false;
    this.transcribeReqId = 0;
    this.isTranscribing = false;

    this.micAudioCtx = null;
    this.micStream = null;
    this.micSource = null;
    this.micNode = null;
    this.micMuteGain = null;
    this.micGraphReady = false;

    this.isSpeakingVoice = false;
    this.speechBuffer = [];
    this.preSpeechRingBuffer = [];
    this.silenceBuffers = 0;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.loadVoices();
      window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  }

  loadVoices() {
    if ('speechSynthesis' in window) {
      this.voices = window.speechSynthesis.getVoices();
    }
  }

  getBestVoice() {
    if (!this.voices.length && 'speechSynthesis' in window) {
      this.voices = window.speechSynthesis.getVoices();
    }
    if (!this.voices.length) return null;

    const isEnglish = (v) => !v.lang || v.lang.toLowerCase().startsWith('en');

    // Tier 1: High-fidelity LOCAL neural voices (zero latency, offline, reliable onboundary)
    const localEnhanced = this.voices.find(
      (v) =>
        isEnglish(v) &&
        v.localService !== false &&
        (v.name.includes('(Enhanced)') || v.name.includes('(Premium)') || v.name.includes('Siri'))
    );
    if (localEnhanced) return localEnhanced;

    // Tier 2: Preferred local friendly character voices
    const preferredLocalNames = ['Samantha', 'Ava', 'Allison', 'Karen', 'Moira', 'Daniel'];
    for (const name of preferredLocalNames) {
      const found = this.voices.find((v) => isEnglish(v) && v.localService !== false && v.name.includes(name));
      if (found) return found;
    }

    // Tier 3: High-clarity cloud neural voices (Edge Online Natural / Chrome Google US English)
    const edgeNatural = this.voices.find(
      (v) => isEnglish(v) && (v.name.includes('Online (Natural)') || (v.name.includes('Natural') && v.name.includes('Microsoft')))
    );
    if (edgeNatural) return edgeNatural;

    const googleVoice = this.voices.find((v) => isEnglish(v) && v.name.includes('Google US English'));
    if (googleVoice) return googleVoice;

    // Tier 4: Preferred general names (remote or local)
    const generalNames = ['Jenny', 'Aria', 'Ava', 'Samantha', 'Daniel'];
    for (const name of generalNames) {
      const found = this.voices.find((v) => isEnglish(v) && v.name.includes(name));
      if (found) return found;
    }

    // Tier 5: Any US English or English voice
    const usVoice = this.voices.find((v) => v.lang === 'en-US' || v.lang === 'en_US');
    if (usVoice) return usVoice;

    return this.voices.find(isEnglish) || null;
  }

  playEarcon(type) {
    try {
      if (!this.earconCtx) {
        this.earconCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.earconCtx.state === 'suspended') {
        this.earconCtx.resume();
      }
      const ctx = this.earconCtx;
      const playTone = (freq, startOffset, duration, peakGain = 0.10) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const now = ctx.currentTime + startOffset;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.03);
      };

      if (type === 'match') {
        playTone(523.25, 0.00, 0.09, 0.09);
        playTone(659.25, 0.07, 0.09, 0.09);
        playTone(783.99, 0.14, 0.13, 0.11);
      } else if (type === 'toggle') {
        playTone(587.33, 0.00, 0.10, 0.09);
      } else if (type === 'repeat') {
        playTone(659.25, 0.00, 0.08, 0.09);
        playTone(783.99, 0.07, 0.13, 0.10);
      }
    } catch {
      // AudioContext unavailable or blocked prior to user gesture
    }
  }

  resetAudioBuffers() {
    this.preSpeechRingBuffer = [];
    this.speechBuffer = [];
    this.isSpeakingVoice = false;
    this.silenceBuffers = 0;
    this.cb.onAudioLevel?.(0);
  }

  clearFallbackHighlightTimers() {
    for (const t of this.fallbackHighlightTimers) clearTimeout(t);
    this.fallbackHighlightTimers = [];
  }

  clearSpeechTimers() {
    clearTimeout(this.speechCooldownTimer);
    clearTimeout(this.speechStepTimer);
    clearTimeout(this.speechWatchdogTimer);
    clearTimeout(this.recognitionRestartTimer);
    clearTimeout(this.toggleResumeTimer);
    this.clearFallbackHighlightTimers();
  }

  isTokenCurrent(token) {
    return token === this.playbackToken;
  }

  /**
   * Acquires exclusive speaking lock: pauses dictation and suspends mic capture immediately.
   * Returns a monotonic token that must be passed to releaseLock / speak methods.
   */
  acquireLock() {
    const token = ++this.playbackToken;
    this.clearSpeechTimers();
    this.isSpeaking = true;
    this.speechDetected = false;
    this.activeUtterance = null;
    this.pauseRecognition();
    this.resetAudioBuffers();
    if (this.micAudioCtx && this.micAudioCtx.state === 'running') {
      this.micAudioCtx.suspend().catch(() => {});
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    return token;
  }

  releaseLock(token) {
    if (token !== this.playbackToken) return;
    clearTimeout(this.speechWatchdogTimer);
    clearTimeout(this.speechStepTimer);
    this.clearFallbackHighlightTimers();
    this.activeUtterance = null;
    clearTimeout(this.speechCooldownTimer);

    // 750ms hardware echo cooldown prevents speaker tail / Bluetooth lag from triggering dictation
    this.speechCooldownTimer = setTimeout(() => {
      if (token !== this.playbackToken) return;
      this.isSpeaking = false;
      this.speechDetected = false;
      this.resetAudioBuffers();

      if (!this.isEnabled) return;

      if (this.useWhisper) {
        if (this.micAudioCtx && this.micAudioCtx.state === 'suspended') {
          this.micAudioCtx.resume().catch(() => {});
        }
      } else if (this.recognition && !this.isRecognizing) {
        this.startRecognition();
      }
    }, 750);
  }

  cancelSpeech() {
    this.playbackToken++;
    this.clearSpeechTimers();
    this.activeUtterance = null;
    this.isSpeaking = false;
    this.speechDetected = false;
    this.cb.onClearHighlights?.();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Executes a sequence of utterances while holding the active playback lock.
   * Supports both per-step highlighting (local voices) and boundary-synced fluent phrases (remote voices).
   */
  runUtteranceQueue(steps, rate, existingToken = null) {
    const token = existingToken !== null && this.isTokenCurrent(existingToken)
      ? existingToken
      : this.acquireLock();

    this.cb.onClearHighlights?.();

    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !steps.length) {
      this.releaseLock(token);
      return token;
    }

    window.speechSynthesis.cancel();
    const chosenVoice = this.getBestVoice();

    const speakStep = (index) => {
      if (token !== this.playbackToken) return;

      if (index >= steps.length) {
        this.releaseLock(token);
        return;
      }

      const step = steps[index];
      const utterance = new SpeechSynthesisUtterance(step.text);
      this.activeUtterance = utterance;
      if (chosenVoice) utterance.voice = chosenVoice;
      utterance.lang = chosenVoice?.lang || 'en-US';
      utterance.volume = 1.0;
      utterance.rate = step.rate || rate;
      utterance.pitch = 1.0;

      let stepDone = false;
      let boundaryTriggered = false;

      const advance = () => {
        if (stepDone || token !== this.playbackToken) return;
        stepDone = true;
        clearTimeout(this.speechWatchdogTimer);
        this.clearFallbackHighlightTimers();

        if (step.pauseAfterMs > 0) {
          this.speechStepTimer = setTimeout(() => speakStep(index + 1), step.pauseAfterMs);
        } else {
          speakStep(index + 1);
        }
      };

      utterance.onstart = () => {
        if (token !== this.playbackToken) return;
        this.isSpeaking = true;

        if (step.charIdx === 'all') {
          this.cb.onFlashAll?.(token);
        } else if (typeof step.charIdx === 'number' && step.charIdx >= 0) {
          this.cb.onHighlightLetter?.(step.charIdx);
        } else if (!step.charMap) {
          this.cb.onClearHighlights?.();
        }

        // Schedule calibrated fallback highlights for remote fluent phrases if voice drops onboundary
        if (step.fallbackSchedule) {
          this.clearFallbackHighlightTimers();
          for (const item of step.fallbackSchedule) {
            const t = setTimeout(() => {
              if (!boundaryTriggered && !stepDone && token === this.playbackToken) {
                if (item.charIdx === 'all') this.cb.onFlashAll?.(token);
                else this.cb.onHighlightLetter?.(item.charIdx);
              }
            }, item.delayMs);
            this.fallbackHighlightTimers.push(t);
          }
        }
      };

      if (step.charMap && step.charMap.length > 0) {
        utterance.onboundary = (event) => {
          if (token !== this.playbackToken || typeof event.charIndex !== 'number') return;
          for (let m = step.charMap.length - 1; m >= 0; m--) {
            if (event.charIndex >= step.charMap[m].start) {
              boundaryTriggered = true;
              const target = step.charMap[m].charIdx;
              if (target === 'all') this.cb.onFlashAll?.(token);
              else this.cb.onHighlightLetter?.(target);
              break;
            }
          }
        };
      }

      utterance.onend = advance;
      utterance.onerror = advance;

      // Per-step bounded watchdog (never cuts off active speech prematurely)
      const startedAt = Date.now();
      const maxCeilingMs = Math.max(10000, Math.round((step.text.length * 320) / utterance.rate) + 4000);
      const baseWait = Math.max(2600, Math.round((step.text.length * 210) / utterance.rate) + 1800);
      const armWatchdog = (ms) => {
        clearTimeout(this.speechWatchdogTimer);
        this.speechWatchdogTimer = setTimeout(() => {
          if (stepDone || token !== this.playbackToken) return;
          if (window.speechSynthesis.speaking && Date.now() - startedAt < maxCeilingMs) {
            armWatchdog(1000);
          } else {
            advance();
          }
        }, ms);
      };
      armWatchdog(baseWait);

      window.speechSynthesis.speak(utterance);
    };

    speakStep(0);
    return token;
  }

  /**
   * Hybrid strategy:
   * - Local voices (localService !== false): chunked per-letter queue for exact onstart sync & zero cutoff.
   * - Remote cloud voices (localService === false, e.g., Google US English): fluent phrase chunks
   *   to avoid per-letter network round-trip lag while syncing via onboundary + fallback timing.
   */
  speakWord(word, { rate = 0.92, phonicsMode = false, token = null } = {}) {
    if (!word) {
      if (token !== null) this.releaseLock(token);
      return token;
    }

    const trimmed = word.trim();
    const chosenVoice = this.getBestVoice();
    const isRemoteVoice = Boolean(chosenVoice && chosenVoice.localService === false);

    const tokens = [];
    let charIdx = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (/[A-Za-z0-9]/.test(ch)) {
        const nextChar = trimmed[i + 1] || '';
        const isEndOfSubword = nextChar === ' ' || nextChar === '-';
        tokens.push({ ch, charIdx: charIdx++, isEndOfSubword });
      }
    }

    if (!isRemoteVoice) {
      const steps = [];
      if (!phonicsMode) {
        steps.push({ text: `${trimmed} is spelled`, charIdx: -1, pauseAfterMs: 120 });
        for (const t of tokens) {
          steps.push({
            text: formatSpokenLetter(t.ch),
            charIdx: t.charIdx,
            pauseAfterMs: t.isEndOfSubword ? 240 : 40
          });
        }
        steps.push({ text: trimmed, charIdx: 'all', pauseAfterMs: 0 });
      } else {
        for (const t of tokens) {
          const lower = t.ch.toLowerCase();
          const sound = PHONICS_SOUNDS[lower] || lower;
          steps.push({
            text: `${t.ch.toUpperCase()} says ${sound}.`,
            charIdx: t.charIdx,
            pauseAfterMs: t.isEndOfSubword ? 240 : 80
          });
        }
        steps.push({ text: trimmed, charIdx: 'all', pauseAfterMs: 0 });
      }
      return this.runUtteranceQueue(steps, rate, token);
    }

    // Remote streaming voice path: fluent chunks (keeps each chunk under ~110 chars to avoid Chrome 15s cutoff)
    const steps = [];
    if (!phonicsMode) {
      const wordParts = trimmed.split(/\s+/);
      const spelledOut = wordParts.map((w) => w.toUpperCase().split('').join(', ')).join('. ');
      const prefix = `${trimmed} is spelled `;
      const fullText = `${prefix}${spelledOut}. ${trimmed}.`;

      const charMap = [];
      let searchPos = prefix.length;
      for (const t of tokens) {
        const found = fullText.toUpperCase().indexOf(t.ch.toUpperCase(), searchPos);
        if (found !== -1) {
          charMap.push({ charIdx: t.charIdx, start: found });
          searchPos = found + 1;
        }
      }
      const endWordPos = fullText.lastIndexOf(trimmed);
      if (endWordPos > searchPos) {
        charMap.push({ charIdx: 'all', start: endWordPos });
      }

      const leadInMs = Math.max(650, Math.round((prefix.length * 60) / rate));
      const perLetterMs = Math.round(480 / rate);
      const fallbackSchedule = tokens.map((t, idx) => ({
        charIdx: t.charIdx,
        delayMs: leadInMs + idx * perLetterMs
      }));
      fallbackSchedule.push({
        charIdx: 'all',
        delayMs: leadInMs + tokens.length * perLetterMs + Math.round(250 / rate)
      });

      steps.push({ text: fullText, charIdx: -1, charMap, fallbackSchedule, pauseAfterMs: 0 });
    } else {
      // Group phonics into chunks of up to 4 letters so remote voices stay fluent AND well under 15s
      const CHUNK_SIZE = 4;
      for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
        const slice = tokens.slice(i, i + CHUNK_SIZE);
        let text = '';
        const charMap = [];
        const fallbackSchedule = [];
        const perSegMs = Math.round(1250 / rate);

        slice.forEach((t, localIdx) => {
          const lower = t.ch.toLowerCase();
          const sound = PHONICS_SOUNDS[lower] || lower;
          const seg = `${t.ch.toUpperCase()} says ${sound}`;
          const start = text ? text.length + 2 : 0;
          text += (text ? '. ' : '') + seg;
          charMap.push({ charIdx: t.charIdx, start });
          fallbackSchedule.push({ charIdx: t.charIdx, delayMs: localIdx * perSegMs });
        });

        steps.push({ text: `${text}.`, charIdx: -1, charMap, fallbackSchedule, pauseAfterMs: 100 });
      }
      steps.push({ text: trimmed, charIdx: 'all', pauseAfterMs: 0 });
    }

    return this.runUtteranceQueue(steps, rate, token);
  }

  speakSingleLetter(ch, charIdx, { rate = 0.92, phonicsMode = false } = {}) {
    if (!ch) return;
    const upper = ch.toUpperCase();
    const lower = ch.toLowerCase();
    const text = phonicsMode ? `${upper} says ${PHONICS_SOUNDS[lower] || lower}.` : formatSpokenLetter(upper);
    return this.runUtteranceQueue([{ text, charIdx, pauseAfterMs: 100 }], rate);
  }

  speakSlowWord(word) {
    if (!word) return;
    return this.runUtteranceQueue([{ text: word.trim(), charIdx: 'all', rate: 0.68, pauseAfterMs: 0 }], 0.68);
  }

  speakMessage(text, rate = 0.92, token = null) {
    if (!text) {
      if (token !== null) this.releaseLock(token);
      return token;
    }
    return this.runUtteranceQueue([{ text, charIdx: -1, pauseAfterMs: 0 }], rate, token);
  }

  init() {
    const isFirefox = /firefox|fxios/i.test(navigator.userAgent);
    const hasNative = !isFirefox && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

    if (!hasNative) {
      this.switchToWhisper();
    } else {
      this.initNativeRecognition();
    }
  }

  initNativeRecognition() {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognitionAPI();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    this.recognition = rec;

    rec.onstart = () => {
      if (this.isSpeaking || !this.isEnabled) {
        this.pauseRecognition();
        return;
      }
      this.isRecognizing = true;
      this.restartBackoffMs = 300;
      this.cb.onListeningState?.('listening');
    };

    rec.onspeechstart = () => {
      if (!this.isSpeaking && this.isEnabled) {
        this.speechDetected = true;
        this.cb.onAudioLevel?.(0.65);
      }
    };

    rec.onsoundstart = () => {
      if (!this.isSpeaking && this.isEnabled) {
        this.speechDetected = true;
        this.cb.onAudioLevel?.(0.35);
      }
    };

    rec.onsoundend = () => {
      this.cb.onAudioLevel?.(0);
    };

    rec.onresult = (event) => {
      this.cb.onAudioLevel?.(0);
      if (this.isSpeaking || !this.isEnabled) {
        this.speechDetected = false;
        return;
      }

      const lastResult = event.results[event.results.length - 1];
      if (!lastResult || !lastResult[0]) return;

      const transcript = lastResult[0].transcript.trim();
      if (!transcript) return;

      if (/\bis\s+spelled\b|\bspells\b/i.test(transcript)) {
        this.speechDetected = false;
        return;
      }

      const targetWord = extractTargetWord(transcript);
      this.speechDetected = false;

      if (targetWord) {
        this.cb.onWordMatched?.(targetWord, transcript);
      } else {
        this.cb.onUnmatchedSpeech?.(transcript);
      }
    };

    rec.onnomatch = () => {
      this.cb.onAudioLevel?.(0);
      if (this.isSpeaking || !this.isEnabled) return;
      this.speechDetected = false;
      this.cb.onUnmatchedSpeech?.('');
    };

    rec.onerror = (event) => {
      this.cb.onAudioLevel?.(0);
      if (event.error === 'aborted' || event.error === 'no-speech') {
        return;
      }
      if (event.error === 'network' || event.error === 'service-not-allowed') {
        this.recognition = null;
        this.switchToWhisper();
      } else if (event.error === 'not-allowed') {
        this.isEnabled = false;
        this.isRecognizing = false;
        this.cb.onMicBlocked?.();
      }
    };

    rec.onend = () => {
      this.isRecognizing = false;
      this.cb.onAudioLevel?.(0);

      if (this.speechDetected && !this.isSpeaking && this.isEnabled) {
        this.speechDetected = false;
        this.cb.onUnmatchedSpeech?.('');
      }

      if (this.isEnabled && !this.isSpeaking && this.recognition) {
        clearTimeout(this.recognitionRestartTimer);
        const delay = this.restartBackoffMs;
        this.recognitionRestartTimer = setTimeout(() => {
          if (this.isEnabled && !this.isRecognizing && !this.isSpeaking && this.recognition) {
            this.startRecognition();
          }
        }, delay);
      }
    };

    this.startRecognition();
  }

  startRecognition() {
    if (!this.recognition || !this.isEnabled || this.isRecognizing || this.isSpeaking) return;
    try {
      this.recognition.start();
    } catch {
      this.restartBackoffMs = Math.min(2000, Math.round(this.restartBackoffMs * 1.5));
      clearTimeout(this.recognitionRestartTimer);
      this.recognitionRestartTimer = setTimeout(() => {
        if (this.isEnabled && !this.isRecognizing && !this.isSpeaking && this.recognition) {
          this.startRecognition();
        }
      }, this.restartBackoffMs);
    }
  }

  pauseRecognition() {
    clearTimeout(this.recognitionRestartTimer);
    if (!this.recognition) return;
    this.isRecognizing = false;
    try {
      this.recognition.abort();
    } catch {}
  }

  stopRecognition() {
    clearTimeout(this.recognitionRestartTimer);
    if (!this.recognition) return;
    this.isRecognizing = false;
    try {
      this.recognition.stop();
    } catch {}
  }

  // Off-main-thread Whisper fallback with clean retry recovery on failure
  switchToWhisper() {
    if (this.whisperInitStarted || this.whisperReady) return;
    this.useWhisper = true;
    this.whisperInitStarted = true;
    this.cb.onWhisperProgress?.(0, 'Connecting to speech model...');

    try {
      const worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
      this.whisperWorker = worker;

      const failInit = (msg) => {
        this.whisperInitStarted = false;
        this.whisperReady = false;
        try {
          worker.terminate();
        } catch {}
        if (this.whisperWorker === worker) this.whisperWorker = null;
        this.cb.onWhisperError?.(msg);
      };

      worker.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'status') {
          this.cb.onWhisperProgress?.(msg.pct, msg.text);
        } else if (msg.type === 'ready') {
          this.whisperReady = true;
          this.cb.onWhisperReady?.();
        } else if (msg.type === 'transcript') {
          this.isTranscribing = false;
          this.handleWhisperTranscript(msg.text);
        } else if (msg.type === 'error') {
          if (msg.stage === 'init') {
            failInit(msg.message);
          } else {
            this.isTranscribing = false;
          }
        }
      };

      worker.onerror = (err) => {
        failInit(err?.message || 'Worker failed');
      };

      worker.postMessage({ type: 'init' });
    } catch (err) {
      this.whisperInitStarted = false;
      this.cb.onWhisperError?.(err?.message || 'Speech engine unavailable');
    }
  }

  async startWhisperMic() {
    if (!this.isEnabled) return;
    if (!this.whisperReady) {
      this.switchToWhisper();
      return;
    }

    try {
      if (!this.micAudioCtx) {
        this.micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.micAudioCtx.state === 'suspended') {
        await this.micAudioCtx.resume();
      }
      if (!this.micStream) {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      }

      if (!this.micGraphReady) {
        this.micSource = this.micAudioCtx.createMediaStreamSource(this.micStream);
        this.micMuteGain = this.micAudioCtx.createGain();
        this.micMuteGain.gain.value = 0;

        let workletAttached = false;
        if (this.micAudioCtx.audioWorklet) {
          try {
            await this.micAudioCtx.audioWorklet.addModule(new URL('./vad-worklet.js', import.meta.url));
            const workletNode = new AudioWorkletNode(this.micAudioCtx, 'vad-capture-processor');
            workletNode.port.onmessage = (event) => {
              if (event.data?.type === 'frame') {
                this.handleMicFrame(event.data.rms, event.data.samples);
              }
            };
            this.micSource.connect(workletNode);
            workletNode.connect(this.micMuteGain);
            this.micMuteGain.connect(this.micAudioCtx.destination);
            this.micNode = workletNode;
            workletAttached = true;
          } catch {
            workletAttached = false;
          }
        }

        if (!workletAttached) {
          const processor = this.micAudioCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const channel = e.inputBuffer.getChannelData(0);
            let sumSquares = 0;
            for (let i = 0; i < channel.length; i++) {
              sumSquares += channel[i] * channel[i];
            }
            const rms = Math.sqrt(sumSquares / channel.length);
            this.handleMicFrame(rms, new Float32Array(channel));
          };
          this.micSource.connect(processor);
          processor.connect(this.micMuteGain);
          this.micMuteGain.connect(this.micAudioCtx.destination);
          this.micNode = processor;
        }

        this.micGraphReady = true;
      }

      this.cb.onListeningState?.('listening');
    } catch {
      this.cb.onMicBlocked?.();
    }
  }

  handleMicFrame(rms, samples) {
    if (!this.isEnabled || this.isSpeaking || this.isTranscribing || !this.whisperReady) {
      this.resetAudioBuffers();
      return;
    }

    const normalized = Math.min(1, rms / 0.08);
    this.cb.onAudioLevel?.(normalized > 0.08 ? normalized : 0);

    const sampleRate = this.micAudioCtx?.sampleRate || 48000;
    const maxUtteranceChunks = Math.round((10 * sampleRate) / 4096);

    if (rms > 0.009) {
      if (!this.isSpeakingVoice) {
        this.isSpeakingVoice = true;
        this.silenceBuffers = 0;
        this.speechBuffer.push(...this.preSpeechRingBuffer);
        this.preSpeechRingBuffer = [];
      }
      this.silenceBuffers = 0;
      if (this.speechBuffer.length < maxUtteranceChunks) {
        this.speechBuffer.push(samples);
      }
    } else if (this.isSpeakingVoice) {
      this.speechBuffer.push(samples);
      this.silenceBuffers++;

      const chunksNeeded = Math.max(3, Math.round((1.0 * sampleRate) / 4096));
      if (this.silenceBuffers >= chunksNeeded || this.speechBuffer.length >= maxUtteranceChunks) {
        const rawAudio = flattenFloat32Arrays(this.speechBuffer);
        this.resetAudioBuffers();

        const audio16k = resampleTo16k(rawAudio, sampleRate);
        if (audio16k.length >= 8000 && this.whisperWorker) {
          this.isTranscribing = true;
          const id = ++this.transcribeReqId;
          this.whisperWorker.postMessage({ type: 'transcribe', id, audio: audio16k }, [audio16k.buffer]);
        }
      }
    } else {
      const maxPreRoll = Math.max(2, Math.round((0.45 * sampleRate) / 4096));
      this.preSpeechRingBuffer.push(samples);
      if (this.preSpeechRingBuffer.length > maxPreRoll) {
        this.preSpeechRingBuffer.shift();
      }
    }
  }

  handleWhisperTranscript(transcript) {
    if (this.isSpeaking || !this.isEnabled) return;
    if (isWhisperHallucination(transcript)) return;
    if (/\bis\s+spelled\b|\bspells\b/i.test(transcript)) return;

    const targetWord = extractTargetWord(transcript);
    if (targetWord) {
      this.cb.onWordMatched?.(targetWord, transcript);
    } else {
      this.cb.onUnmatchedSpeech?.(transcript);
    }
  }

  toggleEnabled() {
    clearTimeout(this.toggleResumeTimer);
    this.playEarcon('toggle');

    if (this.isEnabled) {
      this.isEnabled = false;
      this.cancelSpeech();
      this.resetAudioBuffers();
      if (this.recognition) this.stopRecognition();
      if (this.micAudioCtx && this.micAudioCtx.state === 'running') {
        this.micAudioCtx.suspend().catch(() => {});
      }
      return false;
    }

    this.isEnabled = true;
    // Wait 240ms after toggle chime so chime does not trigger microphone
    this.toggleResumeTimer = setTimeout(() => {
      if (!this.isEnabled || this.isSpeaking) return;
      if (this.useWhisper) {
        this.startWhisperMic();
      } else if (this.recognition) {
        this.startRecognition();
      }
    }, 240);
    return true;
  }
}
