import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

let whisperPipeline: any = null;
let isLoading = false;

export async function loadWhisper(
  model: string,
  onProgress?: (progress: number, message: string) => void
): Promise<void> {
  if (whisperPipeline) return;
  if (isLoading) {
    while (isLoading) await new Promise((r) => setTimeout(r, 200));
    return;
  }

  isLoading = true;
  console.log("[Whisper] Loading model:", model);

  try {
    whisperPipeline = await pipeline(
      "automatic-speech-recognition",
      model,
      {
        dtype: {
          encoder_model: "fp32",
          decoder_model_merged: "fp32",
        },
        device: "wasm",
        progress_callback: (p: any) => {
          console.log("[Whisper] Progress:", p.status, p.file, p.progress?.toFixed(0));
          if (p.status === "downloading" || p.status === "progress") {
            const pct = p.progress ? Math.round(p.progress) : 0;
            onProgress?.(pct, `Downloading model… ${pct}%`);
          } else if (p.status === "loading") {
            onProgress?.(100, "Loading model into memory…");
          }
        },
      }
    );
    console.log("[Whisper] Model ready ✓");
  } finally {
    isLoading = false;
  }
}

export async function transcribeChunk(
  audioData: Float32Array,
  sampleRate: number
): Promise<string> {
  if (!whisperPipeline) throw new Error("Whisper not loaded");

  console.log(`[Whisper] Transcribing ${audioData.length} samples @ ${sampleRate}Hz`);

  const target = 16000;
  let samples = audioData;
  if (sampleRate !== target) {
    samples = resample(audioData, sampleRate, target);
    console.log(`[Whisper] Resampled → ${samples.length} samples`);
  }

  const result = await whisperPipeline(samples, {
    sampling_rate: target,
    return_timestamps: false,
  });

  const text = (result.text || "").trim();
  console.log(`[Whisper] Result: "${text}"`);
  return text;
}

function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  const ratio = fromRate / toRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const index = Math.floor(pos);
    const frac = pos - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? 0;
    output[i] = a + frac * (b - a);
  }
  return output;
}

export function isWhisperReady(): boolean {
  return whisperPipeline !== null;
}