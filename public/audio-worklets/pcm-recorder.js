/**
 * PCM16 recorder AudioWorklet.
 *
 * Receives Float32 microphone audio at the AudioContext's sampleRate,
 * downsamples to the target rate (24000 Hz by default) using linear
 * interpolation, converts to PCM16 little-endian, and posts ~50ms chunks
 * back to the main thread.
 *
 * Loaded by VoiceLiveClient via audioWorklet.addModule("/audio-worklets/pcm-recorder.js")
 */

class PCMRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetSampleRate = opts.targetSampleRate || 24000;
    // Buffer ~50ms worth of samples at the target rate before posting
    this.chunkSamples = Math.floor(this.targetSampleRate * 0.05);
    this.buffer = new Int16Array(this.chunkSamples);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channel = input[0];
    const inputRate = sampleRate; // global in AudioWorkletGlobalScope
    const ratio = inputRate / this.targetSampleRate;

    // Linear interpolation downsample
    for (let i = 0; i < channel.length / ratio; i++) {
      const srcIdx = i * ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(idx0 + 1, channel.length - 1);
      const frac = srcIdx - idx0;
      const sample = channel[idx0] * (1 - frac) + channel[idx1] * frac;

      const clamped = Math.max(-1, Math.min(1, sample));
      this.buffer[this.bufferIndex++] =
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

      if (this.bufferIndex >= this.chunkSamples) {
        // Transfer the buffer to the main thread, allocate a fresh one
        const out = this.buffer.buffer.slice(0);
        this.port.postMessage(out, [out]);
        this.buffer = new Int16Array(this.chunkSamples);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-recorder", PCMRecorder);
