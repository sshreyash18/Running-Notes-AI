import { useEffect, useRef } from "react";
import { useApp } from "./app-context";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function TranscriptPanel() {
  const { session, currentTimestamp, liveTranscript, isRecording } = useApp();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.transcriptChunks.length]);

  return (
    <div className="transcript-panel">
      <div className="panel-label">Live transcript</div>
      <div className="transcript-scroll">
        {session.transcriptChunks.map((chunk) => (
          <div
            key={chunk.id}
            className={`transcript-chunk ${chunk.timestamp <= currentTimestamp ? "past" : ""}`}
          >
            <span className="chunk-ts">{formatTime(chunk.timestamp)}</span>
            <span className="chunk-text">{chunk.text}</span>
          </div>
        ))}
        {isRecording && liveTranscript && (
          <div className="transcript-chunk live">
            <span className="chunk-ts">live</span>
            <span className="chunk-text typing">{liveTranscript}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}