// Unified Speech Recognition (Web Speech API + Off-Main-Thread Whisper VAD) & Synchronized Chunked TTS Engine

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

    // Strict playback sequence locking (prevents echo & overlapping timers)
    this.activeUtterance = null;
    this.speechPlaybackSeq = 0;
    this.speechCooldownTimer = null;
    this.speechStepTimer = null;
    this.speechWatchdogTimer = null;
    this.recognitionRestartTimer = null;
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

    const edgeNatural = this.voices.find(
      (v) => isEnglish(v) && (v.name.includes('Online (Natural)') || (v.name.includes('Natural') && v.name.includes('Microsoft')))
    );
    if (edgeNatural) return edgeNatural;

    const appleEnhanced = this.voices.find(
      (v) => isEnglish(v) && (v.name.includes('(Enhanced)') || v.name.includes('(Premium)') || v.name.includes('Siri'))
    );
    if (appleEnhanced) return appleEnhanced;

    const googleVoice = this.voices.find((v) => isEnglish(v) && v.name.includes('Google US English'));
    if (googleVoice) return googleVoice;

    const preferredNames = ['Jenny', 'Aria', 'Ava', 'Samantha', 'Allison', 'Daniel', 'Karen', 'Moira'];
    for (const name of preferredNames) {
      const found = this.voices.find((v) => isEnglish(v) && v.name.includes(name));
      if (found) return found;
    }

    const usVoice = this.voices.find((v) => v.lang === 'en-US' || v.lang === 'en_US');
    if (usVoice) return usVoice;

    return this.voices.find(isEnglish) || null;
  }

  // Synthesized Web Audio Earcons (subtle, gentle acoustic feedback)
  playEarcon(type) {
    try {
      if (!this.earconCtx) {
        this.earconCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.earconCtx.state === 'suspended') {
        this.earconCtx.resume();
      }
      const ctx = this.earconCtx;
      const playTone = (freq, startOffset, duration, peakGain = 0.11) => {
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
        playTone(523.25, 0.00, 0.09, 0.10);
        playTone(659.25, 0.07, 0.09, 0.10);
        playTone(783.99, 0.14, 0.14, 0.12);
      } else if (type === 'toggle') {
        playTone(587.33, 0.00, 0.10, 0.10);
      } else if (type === 'repeat') {
        playTone(659.25, 0.00, 0.08, 0.10);
        playTone(783.99, 0.07, 0.14, 0.11);
      }
    } catch {
      // AudioContext unavailable or blocked before user gesture
    }
  }

  resetAudioBuffers() {
    this.preSpeechRingBuffer = [];
    this.speechBuffer = [];
    this.isSpeakingVoice = false;
    this.silenceBuffers = 0;
    this.cb.onAudioLevel?.(0);
  }

  clearSpeechTimers() {
    clearTimeout(this.speechCooldownTimer);
    clearTimeout(this.speechStepTimer);
    clearTimeout(this.speechWatchdogTimer);
    clearTimeout(this.recognitionRestartTimer);
  }

  beginSpeakingLock() {
    this.clearSpeechTimers();
    this.isSpeaking = true;
    this.speechDetected = false;
    this.pauseRecognition();
    this.resetAudioBuffers();
    if (this.micAudioCtx && this.micAudioCtx.state === 'running') {
      this.micAudioCtx.suspend().catch(() => {});
    }
  }

  endSpeakingLock(seq) {
    if (seq !== this.speechPlaybackSeq) return;
    clearTimeout(this.speechWatchdogTimer);
    clearTimeout(this.speechStepTimer);
    this.activeUtterance = null;
    clearTimeout(this.speechCooldownTimer);

    // 750ms hardware echo cooldown prevents speaker tail / Bluetooth lag from re-triggering mic
    this.speechCooldownTimer = setTimeout(() => {
      if (seq !== this.speechPlaybackSeq) return;
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
    this.speechPlaybackSeq++;
    this.clearSpeechTimers();
    this.activeUtterance = null;
    this.isSpeaking = false;
    this.speechDetected = false;
    this.cb.onClearHighlights?.();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Speaks a queue of short utterances one at a time.
   * Guarantees exact letter-by-letter visual sync on every browser/voice
   * and eliminates Chrome's 15-second SpeechSynthesis hang bug.
   */
  runUtteranceQueue(steps, rate, { onFlashEnd = false } = {}) {
    const mySeq = ++this.speechPlaybackSeq;
    this.beginSpeakingLock();
    this.cb.onClearHighlights?.();

    if (!('speechSynthesis' in window) || !steps.length) {
      this.endSpeakingLock(mySeq);
      return mySeq;
    }

    window.speechSynthesis.cancel();
    const chosenVoice = this.getBestVoice();

    const speakStep = (index) => {
      if (mySeq !== this.speechPlaybackSeq) return;

      if (index >= steps.length) {
        if (onFlashEnd) {
          this.cb.onFlashAll?.(mySeq);
        } else {
          this.cb.onClearHighlights?.();
        }
        this.endSpeakingLock(mySeq);
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
      const advance = () => {
        if (stepDone || mySeq !== this.speechPlaybackSeq) return;
        stepDone = true;
        clearTimeout(this.speechWatchdogTimer);

        if (step.pauseAfterMs > 0) {
          this.speechStepTimer = setTimeout(() => speakStep(index + 1), step.pauseAfterMs);
        } else {
          speakStep(index + 1);
        }
      };

      utterance.onstart = () => {
        if (mySeq !== this.speechPlaybackSeq) return;
        this.isSpeaking = true;
        if (step.charIdx === 'all') {
          this.cb.onFlashAll?.(mySeq);
        } else if (typeof step.charIdx === 'number' && step.charIdx >= 0) {
          this.cb.onHighlightLetter?.(step.charIdx);
        } else {
          this.cb.onClearHighlights?.();
        }
      };

      utterance.onend = advance;
      utterance.onerror = advance;

      // Per-step bounded watchdog (never cuts off active speech prematurely)
      const startedAt = Date.now();
      const baseWait = Math.max(2600, Math.round((step.text.length * 190) / utterance.rate) + 1500);
      const armWatchdog = (ms) => {
        clearTimeout(this.speechWatchdogTimer);
        this.speechWatchdogTimer = setTimeout(() => {
          if (stepDone || mySeq !== this.speechPlaybackSeq) return;
          if (window.speechSynthesis.speaking && Date.now() - startedAt < 10000) {
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
    return mySeq;
  }

  speakWord(word, { rate = 0.92, phonicsMode = false } = {}) {
    if (!word) return;
    const trimmed = word.trim();
    const steps = [];

    // Build alphanumeric character list along with word-boundary pause markers
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

    if (!phonicsMode) {
      steps.push({ text: `${trimmed} is spelled`, charIdx: -1, pauseAfterMs: 140 });
      for (const t of tokens) {
        steps.push({
          text: t.ch.toUpperCase(),
          charIdx: t.charIdx,
          pauseAfterMs: t.isEndOfSubword ? 260 : 75
        });
      }
      steps.push({ text: trimmed, charIdx: 'all', pauseAfterMs: 0 });
    } else {
      for (const t of tokens) {
        const lower = t.ch.toLowerCase();
        const sound = PHONICS_SOUNDS[lower] || lower;
        steps.push({
          text: `${t.ch.toUpperCase()} says ${sound}`,
          charIdx: t.charIdx,
          pauseAfterMs: t.isEndOfSubword ? 260 : 120
        });
      }
      steps.push({ text: trimmed, charIdx: 'all', pauseAfterMs: 0 });
    }

    return this.runUtteranceQueue(steps, rate, { onFlashEnd: false });
  }

  speakSingleLetter(ch, charIdx, { rate = 0.92, phonicsMode = false } = {}) {
    if (!ch) return;
    const upper = ch.toUpperCase();
    const lower = ch.toLowerCase();
    const text = phonicsMode ? `${upper} says ${PHONICS_SOUNDS[lower] || lower}` : upper;
    return this.runUtteranceQueue([{ text, charIdx, pauseAfterMs: 120 }], rate, { onFlashEnd: false });
  }

  speakMessage(text, rate = 0.92) {
    if (!text) return;
    return this.runUtteranceQueue([{ text, charIdx: -1, pauseAfterMs: 0 }], rate, { onFlashEnd: false });
  }

  // Starts either native Web Speech API or off-main-thread Whisper fallback
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
    } catch (err) {
      // Transient InvalidStateError when abort/stop hasn't finished yet — bounded retry
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

  // Off-main-thread Whisper fallback
  switchToWhisper() {
    if (this.whisperInitStarted) return;
    this.useWhisper = true;
    this.whisperInitStarted = true;
    this.cb.onWhisperProgress?.(0, 'Connecting to speech model...');

    try {
      const worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
      this.whisperWorker = worker;

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
            this.cb.onWhisperError?.(msg.message);
          } else {
            this.isTranscribing = false;
          }
        }
      };

      worker.onerror = (err) => {
        this.cb.onWhisperError?.(err?.message || 'Worker failed');
      };

      worker.postMessage({ type: 'init' });
    } catch (err) {
      this.cb.onWhisperError?.(err?.message || 'Speech engine unavailable');
    }
  }

  async startWhisperMic() {
    if (!this.isEnabled) return;

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
        // Zero-gain node keeps audio graph alive without routing mic back to speakers
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

    // Visual acoustic meter (normalized 0..1)
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
    setTimeout(() => {
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
