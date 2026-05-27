import { createContext, useContext } from "react";

export interface TranscriptChunk {
  id: string;
  text: string;
  timestamp: number;
  wallTime: number;
  isFinal: boolean;
}

export interface Topic {
  id: string;
  heading: string;
  startTimestamp: number;
  summary: string;
}

export interface NoteBlock {
  id: string;
  topicId: string;
  markdown: string;
  updatedAt: number;
  timestamp: number;
}

export interface SessionState {
  id: string;
  title: string;
  startedAt: number;
  transcriptChunks: TranscriptChunk[];
  topics: Topic[];
  notes: NoteBlock[];
  currentTopicId: string | null;
}

export interface WhepStreamInfo {
  streamId: string;
  deviceName: string;
  role: string;
  isMuted: boolean;
}

export interface AppContextType {
  session: SessionState;
  isRecording: boolean;
  isProcessing: boolean;
  currentTimestamp: number;
  liveTranscript: string;
  streamingNote: string;
  error: string | null;
  modelStatus: string;
  activeWhepStreams: WhepStreamInfo[];
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  seekTo: (ts: number) => void;
  askQuestion: (q: string) => Promise<string>;
  exportMarkdown: () => void;
  exportTranscript: () => void;
  clearSession: () => void;
  startMicrophone: () => Promise<void>;
  startFile: (file: File) => Promise<void>;
  startWhep: (wsUrl: string) => void;
  stopWhep: () => void;
}

export const AppContext = createContext<AppContextType | null>(null);
export const useApp = () => useContext(AppContext)!;