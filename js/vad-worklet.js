// Off-main-thread Voice Activity Detection (VAD) AudioWorkletProcessor
class VadCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 4096;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];
    let readPos = 0;

    while (readPos < channel.length) {
      const remaining = this.chunkSize - this.offset;
      const toCopy = Math.min(remaining, channel.length - readPos);
      this.buffer.set(channel.subarray(readPos, readPos + toCopy), this.offset);
      this.offset += toCopy;
      readPos += toCopy;

      if (this.offset >= this.chunkSize) {
        let sumSquares = 0;
        for (let i = 0; i < this.chunkSize; i++) {
          const sample = this.buffer[i];
          sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / this.chunkSize);
        const frame = this.buffer;
        this.buffer = new Float32Array(this.chunkSize);
        this.offset = 0;

        this.port.postMessage({ type: 'frame', rms, samples: frame }, [frame.buffer]);
      }
    }

    return true;
  }
}

registerProcessor('vad-capture-processor', VadCaptureProcessor);
