// Off-main-thread Whisper ASR Web Worker (keeps UI 60fps during download & transcription)
let whisperPipeline = null;

async function initModel() {
  try {
    self.postMessage({ type: 'status', pct: 0, text: 'Connecting to speech model...' });

    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    env.allowLocalModels = false;
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
    }

    const fileProgress = {};
    const ESTIMATED_TOTAL_BYTES = 41800000;
    let smoothedPct = 0;

    whisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: (item) => {
        if (item.status === 'initiate') {
          if (smoothedPct === 0) {
            self.postMessage({ type: 'status', pct: 0, text: 'Connecting to speech model...' });
          }
        } else if (item.status === 'progress') {
          if (item.file && typeof item.loaded === 'number') {
            fileProgress[item.file] = item.loaded;
            const totalLoaded = Object.values(fileProgress).reduce((acc, bytes) => acc + bytes, 0);
            const calcPct = Math.min(98, Math.round((totalLoaded / ESTIMATED_TOTAL_BYTES) * 100));
            smoothedPct = Math.max(smoothedPct, calcPct);
            self.postMessage({
              type: 'status',
              pct: smoothedPct,
              text: `Downloading speech engine (${smoothedPct}%)...`
            });
          }
        } else if (item.status === 'done') {
          if (item.file && item.total) {
            fileProgress[item.file] = item.total;
          }
        } else if (item.status === 'ready') {
          smoothedPct = Math.max(smoothedPct, 99);
          self.postMessage({
            type: 'status',
            pct: smoothedPct,
            text: 'Initializing speech engine...'
          });
        }
      }
    });

    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'error', stage: 'init', message: err?.message || String(err) });
  }
}

self.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'init') {
    await initModel();
  } else if (msg.type === 'transcribe') {
    if (!whisperPipeline) {
      self.postMessage({ type: 'transcript', id: msg.id, text: '' });
      return;
    }
    try {
      const out = await whisperPipeline(msg.audio);
      const text = out && out.text ? out.text.trim() : '';
      self.postMessage({ type: 'transcript', id: msg.id, text });
    } catch (err) {
      self.postMessage({
        type: 'error',
        stage: 'transcribe',
        id: msg.id,
        message: err?.message || String(err)
      });
    }
  }
});
