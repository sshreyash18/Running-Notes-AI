export type AudioSource = "microphone" | "file";

export interface AudioCaptureOptions {
  onChunk: (pcm: Float32Array, sampleRate: number) => void;
  chunkSeconds: number;
}

export class AudioCaptureService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | AudioBufferSourceNode | null = null;

  constructor(private options: AudioCaptureOptions) {}

  async startMicrophone(): Promise<void> {
    console.log("[Audio] Requesting microphone...");
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    console.log("[Audio] Microphone granted");
    await this.setupProcessor(this.mediaStream);
  }

  async startFile(file: File): Promise<void> {
    console.log("[Audio] Reading file:", file.name, file.type, file.size);

    this.audioContext = new AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    console.log("[Audio] ArrayBuffer size:", arrayBuffer.byteLength);

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.error("[Audio] decodeAudioData failed:", e);
      throw new Error(`Cannot decode audio from this file: ${e}`);
    }

    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const totalSamples = audioBuffer.length;
    console.log(`[Audio] Decoded: ${duration.toFixed(1)}s, ${sampleRate}Hz, ${audioBuffer.numberOfChannels}ch`);

    // Get mono channel data
    const channelData = audioBuffer.getChannelData(0);
    const samplesPerChunk = Math.floor(sampleRate * this.options.chunkSeconds);
    const totalChunks = Math.ceil(channelData.length / samplesPerChunk);
    console.log(`[Audio] Splitting into ${totalChunks} chunks of ${this.options.chunkSeconds}s each`);

    let chunkIndex = 0;
    let offset = 0;

    while (offset < channelData.length) {
      const end = Math.min(offset + samplesPerChunk, channelData.length);
      const chunk = channelData.slice(offset, end);

      // Skip silent chunks (all near-zero samples)
      const maxAmplitude = chunk.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
      if (maxAmplitude < 0.001) {
        console.log(`[Audio] Chunk ${chunkIndex} skipped (silence)`);
        offset += samplesPerChunk;
        chunkIndex++;
        continue;
      }

      console.log(`[Audio] Sending chunk ${chunkIndex + 1}/${totalChunks}, maxAmp=${maxAmplitude.toFixed(3)}`);
      this.options.onChunk(chunk, sampleRate);

      offset += samplesPerChunk;
      chunkIndex++;

      // Yield to UI thread between chunks
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log("[Audio] File processing complete");
  }

  private async setupProcessor(stream: MediaStream): Promise<void> {
    this.audioContext = new AudioContext();
    const sampleRate = this.audioContext.sampleRate;
    const samplesPerChunk = Math.floor(sampleRate * this.options.chunkSeconds);
    console.log(`[Audio] Mic processor: ${sampleRate}Hz, ${samplesPerChunk} samples/chunk`);

    this.source = this.audioContext.createMediaStreamSource(stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    let collected = new Float32Array(samplesPerChunk);
    let collectedCount = 0;

    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let i = 0;
      while (i < input.length) {
        const space = samplesPerChunk - collectedCount;
        const toCopy = Math.min(space, input.length - i);
        collected.set(input.subarray(i, i + toCopy), collectedCount);
        collectedCount += toCopy;
        i += toCopy;

        if (collectedCount >= samplesPerChunk) {
          console.log("[Audio] Mic chunk ready, sending...");
          this.options.onChunk(collected.slice(), sampleRate);
          collected = new Float32Array(samplesPerChunk);
          collectedCount = 0;
        }
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop(): void {
    console.log("[Audio] Stopping capture");
    this.processor?.disconnect();
    this.source?.disconnect();
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();
    this.processor = null;
    this.source = null;
    this.mediaStream = null;
    this.audioContext = null;
  }
}