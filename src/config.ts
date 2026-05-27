export const CONFIG = {
  ollamaBase:
    (import.meta as any).env?.VITE_OLLAMA_BASE ||
    "http://192.168.0.16:11434/v1",
  model: "llama3.1:latest",
  whisperModel: "Xenova/whisper-tiny.en",
  chunkSeconds: 4,
  importanceCheckInterval: 10000,
  shortTermSeconds: 60,
  recentChunkCount: 3,
};