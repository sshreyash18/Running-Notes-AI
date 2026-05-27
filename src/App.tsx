import { useState, useRef, useCallback } from "react";
import "./App.css";
import { AppContext } from "./components/app-context";
import {
  Controls,
  QAPanel,
  NotesPanel,
  ChapterNav,
  TranscriptPanel,
  TimelineBar,
} from "./components";
import { CONFIG } from "./config";
import { loadWhisper, transcribeChunk } from "./services/whisper";
import { AudioCaptureService } from "./services/audioCapture";
import { BrowserSpeechService } from "./services/speechRecognition";
import type {
  SessionState,
  Topic,
  NoteBlock,
  TranscriptChunk,
  WhepStreamInfo
} from "./components/app-context";
import { WhepStreamService, type StreamInfo } from "./services/whepStream";

// ─── MEMORY SERVICE ──────────────────────────────────────────────────────────

class MemoryService {
  private chunks: TranscriptChunk[] = [];
  private midTermSummaries: string[] = [];
  private shortTermSeconds = CONFIG.shortTermSeconds;

  addChunk(chunk: TranscriptChunk) {
    this.chunks.push(chunk);
    this.evict();
  }

  private evict() {
    const now = Date.now() / 1000;
    const cutoff = now - this.shortTermSeconds;
    const evicted = this.chunks.filter((c) => c.wallTime / 1000 < cutoff);
    this.chunks = this.chunks.filter((c) => c.wallTime / 1000 >= cutoff);
    if (evicted.length > 0) {
      const text = evicted.map((c) => c.text).join(" ");
      this.midTermSummaries.push(text.slice(0, 300));
      if (this.midTermSummaries.length > 4) this.midTermSummaries.shift();
    }
  }

  getRecentChunks(n: number): TranscriptChunk[] {
    return this.chunks.slice(-n);
  }

  getShortTermText(): string {
    return this.chunks.map((c) => c.text).join(" ");
  }

  getMidTermContext(): string {
    return this.midTermSummaries.join("\n---\n");
  }

  buildPromptContext(currentTopicHeading: string, existingNotes: string): string {
    const mid = this.getMidTermContext();
    const short = this.getShortTermText();
    return `## Session context
Current topic: ${currentTopicHeading || "General"}
${mid ? `\n### Earlier content (compressed)\n${mid}\n` : ""}
### Recent transcript
${short || "(nothing yet)"}

### Existing notes
${existingNotes || "(none yet)"}`;
  }

  clear() {
    this.chunks = [];
    this.midTermSummaries = [];
  }
}

// ─── OLLAMA ──────────────────────────────────────────────────────────────────

async function* streamOllama(
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const response = await fetch(`${CONFIG.ollamaBase}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: CONFIG.model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Ollama error ${response.status}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {}
    }
  }
}

async function quickOllamaCall(prompt: string, signal?: AbortSignal): Promise<string> {
  let result = "";
  for await (const delta of streamOllama(
    "You are a helpful assistant. Be very brief.",
    prompt,
    signal
  )) {
    result += delta;
  }
  return result.trim();
}

// ─── PROVIDER ────────────────────────────────────────────────────────────────

function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState>({
    id: crypto.randomUUID(),
    title: "New session",
    startedAt: Date.now(),
    transcriptChunks: [],
    topics: [],
    notes: [],
    currentTopicId: null,
  });
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [streamingNote, setStreamingNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<string>("idle");
  const [activeWhepStreams, setActiveWhepStreams] = useState<WhepStreamInfo[]>([]);

  const memory = useRef(new MemoryService());
  const noteAbortRef = useRef<AbortController | null>(null);
  const importanceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureRef = useRef<AudioCaptureService | null>(null);
  const speechRef = useRef<BrowserSpeechService | null>(null);
  const whepServiceRef = useRef<WhepStreamService | null>(null);
  const sessionTimestampRef = useRef(0);
  const isTranscribingRef = useRef(false);
  const isWhepTranscribingRef = useRef(false);
  const chunkQueueRef = useRef<{ pcm: Float32Array; sampleRate: number }[]>([]);
  const whepChunkQueueRef = useRef<{ pcm: Float32Array; sampleRate: number; streamInfo: StreamInfo }[]>([]);
  const isCheckingImportanceRef = useRef(false);
  const recentTranscriptRef = useRef<string[]>([]);
  const currentTopicIdRef = useRef<string | null>(null);
  const sessionRef = useRef<SessionState>(session);

  // ── Keep sessionRef in sync ─────────────────────────────────────────────
  const updateSession = useCallback((updater: (prev: SessionState) => SessionState) => {
    setSession((prev) => {
      const next = updater(prev);
      sessionRef.current = next;
      currentTopicIdRef.current = next.currentTopicId;
      return next;
    });
  }, []);

  // ── Ensure initial topic exists ─────────────────────────────────────────
  const ensureInitialTopic = useCallback(() => {
    if (sessionRef.current.topics.length === 0) {
      const topic: Topic = {
        id: crypto.randomUUID(),
        heading: "General Notes",
        startTimestamp: 0,
        summary: "",
      };
      updateSession((s) => ({
        ...s,
        topics: [topic],
        currentTopicId: topic.id,
        title: "Session notes",
      }));
      currentTopicIdRef.current = topic.id;
      return topic.id;
    }
    return currentTopicIdRef.current;
  }, [updateSession]);

  // ── Importance check + note generation ─────────────────────────────────
  const checkAndGenerateNotes = useCallback(async () => {
    if (isCheckingImportanceRef.current) return;
    const recentText = recentTranscriptRef.current.join(" ").trim();
    if (!recentText || recentText.length < 20) return;

    isCheckingImportanceRef.current = true;
    const topicId = ensureInitialTopic();

    try {
      const importancePrompt = `You are checking if a transcript snippet contains important educational content worth noting.

Transcript snippet:
"${recentText}"

Does this contain any important concept, definition, explanation, key point, or significant information worth adding to study notes?
Reply with ONLY "YES" or "NO".`;

      console.log("[Importance] Checking:", recentText.slice(0, 80) + "...");
      const importance = await quickOllamaCall(importancePrompt);
      console.log("[Importance] Result:", importance);

      if (!importance.toUpperCase().includes("YES")) {
        console.log("[Importance] Skipping — not important enough");
        recentTranscriptRef.current = [];
        return;
      }

      console.log("[Notes] Important content detected, generating notes...");

      if (noteAbortRef.current) noteAbortRef.current.abort();
      const controller = new AbortController();
      noteAbortRef.current = controller;

      const s = sessionRef.current;
      const currentTopic =
        s.topics.find((t) => t.id === topicId) ||
        s.topics[s.topics.length - 1];

      if (!currentTopic) return;

      const existingNote = s.notes.find((n) => n.topicId === currentTopic.id);
      const context = memory.current.buildPromptContext(
        currentTopic.heading,
        existingNote?.markdown || ""
      );

      const sys = `You are an intelligent real-time note-taking assistant.

Rules:
- Write structured markdown bullet points only
- NEVER repeat what is already in existing notes
- Only capture genuinely important concepts, definitions, explanations
- Be concise — one clear bullet per idea
- Use **bold** for key terms
- No headings, no preamble, just bullet points starting with "- "
- If nothing new to add, output nothing at all`;

      setIsProcessing(true);
      setStreamingNote("");
      recentTranscriptRef.current = [];

      let accumulated = "";
      for await (const delta of streamOllama(sys, context, controller.signal)) {
        if (controller.signal.aborted) break;
        accumulated += delta;
        setStreamingNote(accumulated);
      }

      if (accumulated.trim() && !controller.signal.aborted) {
        updateSession((s) => {
          const topic =
            s.topics.find((t) => t.id === currentTopic.id) ||
            s.topics[s.topics.length - 1];
          if (!topic) return s;

          const existingNote = s.notes.find((n) => n.topicId === topic.id);
          const newMarkdown = existingNote
            ? existingNote.markdown + "\n" + accumulated.trim()
            : accumulated.trim();

          const noteId = existingNote?.id || crypto.randomUUID();
          const updated: NoteBlock = {
            id: noteId,
            topicId: topic.id,
            markdown: newMarkdown,
            updatedAt: Date.now(),
            timestamp: sessionTimestampRef.current,
          };
          return {
            ...s,
            notes: [...s.notes.filter((n) => n.id !== noteId), updated],
          };
        });
      }

      setStreamingNote("");
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.error("[Notes] Error:", e.message);
      }
    } finally {
      setIsProcessing(false);
      isCheckingImportanceRef.current = false;
    }
  }, [ensureInitialTopic, updateSession]);

  // ── Add transcript chunk ────────────────────────────────────────────────
  const addTranscriptChunk = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const chunk: TranscriptChunk = {
      id: crypto.randomUUID(),
      text: trimmed,
      timestamp: sessionTimestampRef.current,
      wallTime: Date.now(),
      isFinal: true,
    };

    memory.current.addChunk(chunk);
    setLiveTranscript(trimmed);
    recentTranscriptRef.current.push(trimmed);

    updateSession((prev) => ({
      ...prev,
      transcriptChunks: [...prev.transcriptChunks, chunk],
    }));
  }, [updateSession]);

  // ── Process file/mic whisper queue ──────────────────────────────────────
  const processQueue = useCallback(async () => {
    if (isTranscribingRef.current) return;
    if (chunkQueueRef.current.length === 0) return;

    isTranscribingRef.current = true;
    const { pcm, sampleRate } = chunkQueueRef.current.shift()!;

    try {
      const text = await transcribeChunk(pcm, sampleRate);
      if (text && text.length > 2) {
        sessionTimestampRef.current += CONFIG.chunkSeconds;
        setCurrentTimestamp(sessionTimestampRef.current);
        addTranscriptChunk(text);
      }
    } catch (e: any) {
      console.error("[Whisper] Error:", e.message);
    } finally {
      isTranscribingRef.current = false;
      if (chunkQueueRef.current.length > 0) processQueue();
    }
  }, [addTranscriptChunk]);

  // ── Process WHEP whisper queue ──────────────────────────────────────────
  const processWhepQueue = useCallback(async () => {
  if (isWhepTranscribingRef.current) return;
  if (whepChunkQueueRef.current.length === 0) return;

  isWhepTranscribingRef.current = true;
  const { pcm, sampleRate, streamInfo } = whepChunkQueueRef.current.shift()!;
  
  console.log("[WHEP Queue] Processing chunk, queue remaining:", whepChunkQueueRef.current.length);

  try {
    const text = await transcribeChunk(pcm, sampleRate);
    console.log("[WHEP Queue] Transcribed:", text);
    if (text && text.length > 2) {
      sessionTimestampRef.current += CONFIG.chunkSeconds;
      setCurrentTimestamp(sessionTimestampRef.current);
      const tagged = `[${streamInfo.deviceName}] ${text}`;
      addTranscriptChunk(tagged);
    }
  } catch (e: any) {
    console.error("[WHEP Whisper] Error:", e.message);
  } finally {
    isWhepTranscribingRef.current = false;
    if (whepChunkQueueRef.current.length > 0) processWhepQueue();
  }
}, [addTranscriptChunk]);

  // ── Start importance check interval ────────────────────────────────────
  const startImportanceInterval = useCallback(() => {
    if (importanceIntervalRef.current) clearInterval(importanceIntervalRef.current);
    importanceIntervalRef.current = setInterval(() => {
      checkAndGenerateNotes();
    }, CONFIG.importanceCheckInterval);
  }, [checkAndGenerateNotes]);

  // ── Start microphone (Web Speech API) ──────────────────────────────────
  const startMicrophone = useCallback(async () => {
    setError(null);
    memory.current.clear();
    recentTranscriptRef.current = [];
    sessionTimestampRef.current = 0;

    const speech = new BrowserSpeechService();
    if (!speech.isSupported()) {
      setError("Web Speech API not supported. Use Chrome or Edge.");
      return;
    }

    speechRef.current = speech;
    speech.start({
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          sessionTimestampRef.current += 2;
          setCurrentTimestamp(sessionTimestampRef.current);
          addTranscriptChunk(text);
          setLiveTranscript("");
        } else {
          setLiveTranscript(text);
        }
      },
      onError: (err) => setError(err),
    });

    ensureInitialTopic();
    setIsRecording(true);
    startImportanceInterval();
  }, [addTranscriptChunk, ensureInitialTopic, startImportanceInterval]);

  // ── Start file (Whisper WASM) ───────────────────────────────────────────
  const startFile = useCallback(async (file: File) => {
    setError(null);
    setModelStatus("Loading Whisper model…");
    console.log("[App] startFile:", file.name);

    try {
      await loadWhisper(CONFIG.whisperModel, (_pct, msg) => {
        setModelStatus(msg);
      });
      setModelStatus("ready");
    } catch (e: any) {
      setError(`Whisper load failed: ${e.message}`);
      setModelStatus("idle");
      return;
    }

    memory.current.clear();
    recentTranscriptRef.current = [];
    sessionTimestampRef.current = 0;
    chunkQueueRef.current = [];

    updateSession((s) => ({ ...s, title: file.name.replace(/\.[^.]+$/, "") }));
    ensureInitialTopic();
    setIsRecording(true);
    startImportanceInterval();

    const capture = new AudioCaptureService({
      chunkSeconds: CONFIG.chunkSeconds,
      onChunk: (pcm, sampleRate) => {
        chunkQueueRef.current.push({ pcm, sampleRate });
        processQueue();
      },
    });
    captureRef.current = capture;

    try {
      await capture.startFile(file);

      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (chunkQueueRef.current.length === 0 && !isTranscribingRef.current) {
            clearInterval(check);
            resolve();
          }
        }, 300);
      });

      await checkAndGenerateNotes();
    } catch (e: any) {
      setError(`File error: ${e.message}`);
    } finally {
      setIsRecording(false);
      if (importanceIntervalRef.current) clearInterval(importanceIntervalRef.current);
    }
  }, [processQueue, ensureInitialTopic, startImportanceInterval, checkAndGenerateNotes, updateSession]);

  const startWhep = useCallback(async (whepUrls: string[]) => {
  setError(null);
  setModelStatus("Loading Whisper model…");

  try {
    await loadWhisper(CONFIG.whisperModel, (_pct, msg) => setModelStatus(msg));
    setModelStatus("ready");
  } catch (e: any) {
    setError(`Whisper load failed: ${e.message}`);
    setModelStatus("idle");
    return;
  }

  memory.current.clear();
  recentTranscriptRef.current = [];
  sessionTimestampRef.current = 0;
  whepChunkQueueRef.current = [];

  ensureInitialTopic();
  setIsRecording(true);
  startImportanceInterval();

  const service = new WhepStreamService(
    {
      onAudioChunk: (pcm, sampleRate, streamInfo) => {
        whepChunkQueueRef.current.push({ pcm, sampleRate, streamInfo });
        processWhepQueue();
      },
      onError: (err) => setError(err),
    },
    CONFIG.chunkSeconds
  );

  whepServiceRef.current = service;

  // Connect each URL
  for (let i = 0; i < whepUrls.length; i++) {
    const url = whepUrls[i].trim();
    if (url) {
      await service.addStream(url, `Stream ${i + 1}`);
    }
  }

  // Update active streams display
  setActiveWhepStreams(service.getActiveStreams());
}, [processWhepQueue, ensureInitialTopic, startImportanceInterval]);

  // ── Stop WHEP ───────────────────────────────────────────────────────────
  const stopWhep = useCallback(() => {
    whepServiceRef.current?.disconnect();
    whepServiceRef.current = null;
    setActiveWhepStreams([]);
  }, []);

  const startRecording = useCallback(async () => {}, []);

  // ── Stop everything ─────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    setIsRecording(false);
    speechRef.current?.stop();
    speechRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    whepServiceRef.current?.disconnect();
    whepServiceRef.current = null;
    setActiveWhepStreams([]);
    if (importanceIntervalRef.current) clearInterval(importanceIntervalRef.current);
    if (noteAbortRef.current) noteAbortRef.current.abort();
    chunkQueueRef.current = [];
    whepChunkQueueRef.current = [];
  }, []);

  const seekTo = useCallback((ts: number) => {
    setCurrentTimestamp(ts);
  }, []);

  const askQuestion = useCallback(async (question: string): Promise<string> => {
    const context = memory.current.buildPromptContext("", "");
    const sys = `You are a helpful assistant answering questions about content the user is watching.
Use only the provided transcript context. Be concise and direct.
If the answer isn't in the context, say so.`;
    let answer = "";
    for await (const delta of streamOllama(sys, `${context}\n\nQuestion: ${question}`)) {
      answer += delta;
    }
    return answer.trim();
  }, []);

  const exportMarkdown = useCallback(() => {
    const lines: string[] = [
      `# ${session.title}`, "",
      `*Generated: ${new Date().toLocaleString()}*`, "",
    ];
    for (const topic of session.topics) {
      lines.push(`## ${topic.heading}`, "");
      const note = session.notes.find((n) => n.topicId === topic.id);
      if (note) lines.push(note.markdown, "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${session.title.replace(/\s+/g, "-")}.md`;
    a.click();
  }, [session]);

  const exportTranscript = useCallback(() => {
    const lines: string[] = [
      `# Transcript: ${session.title}`, "",
      `*Generated: ${new Date().toLocaleString()}*`, "",
    ];
    for (const chunk of session.transcriptChunks) {
      const m = Math.floor(chunk.timestamp / 60).toString().padStart(2, "0");
      const s = Math.floor(chunk.timestamp % 60).toString().padStart(2, "0");
      lines.push(`[${m}:${s}] ${chunk.text}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${session.title.replace(/\s+/g, "-")}-transcript.txt`;
    a.click();
  }, [session]);

  const clearSession = useCallback(() => {
    stopRecording();
    memory.current.clear();
    recentTranscriptRef.current = [];
    setCurrentTimestamp(0);
    setLiveTranscript("");
    setStreamingNote("");
    setModelStatus("idle");
    chunkQueueRef.current = [];
    whepChunkQueueRef.current = [];
    const newSession = {
      id: crypto.randomUUID(),
      title: "New session",
      startedAt: Date.now(),
      transcriptChunks: [],
      topics: [],
      notes: [],
      currentTopicId: null,
    };
    sessionRef.current = newSession;
    setSession(newSession);
  }, [stopRecording]);

  return (
    <AppContext.Provider
      value={{
        session,
        isRecording,
        isProcessing,
        currentTimestamp,
        liveTranscript,
        streamingNote,
        error,
        modelStatus,
        activeWhepStreams,
        startRecording,
        stopRecording,
        seekTo,
        askQuestion,
        exportMarkdown,
        exportTranscript,
        clearSession,
        startMicrophone,
        startFile,
        startWhep,
        stopWhep,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <AppProvider>
      <div className="app-shell">
        <Controls />
        <TimelineBar />
        <div className="main-grid">
          <ChapterNav />
          <TranscriptPanel />
          <NotesPanel />
          <QAPanel />
        </div>
      </div>
    </AppProvider>
  );
}