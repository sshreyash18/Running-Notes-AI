import { useRef, useState } from "react";
import { useApp } from "./app-context";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function Controls() {
  const {
    isRecording, isProcessing, currentTimestamp,
    stopRecording, exportMarkdown, exportTranscript,
    clearSession, error, session, modelStatus,
    startMicrophone, startFile, startWhep,
    activeWhepStreams,
  } = useApp();

  const [showPicker, setShowPicker] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showWhepInput, setShowWhepInput] = useState(false);
  const [whepUrl1, setWhepUrl1] = useState("");
  const [whepUrl2, setWhepUrl2] = useState("");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowPicker(false);
    await startFile(file);
  };

  const handleMic = async () => {
    setShowPicker(false);
    await startMicrophone();
  };

const handleWhepConnect = () => {
  const urls = [whepUrl1, whepUrl2].filter((u) => u.trim() !== "");
  if (urls.length === 0) return;
  setShowWhepInput(false);
  startWhep(urls);
};
  const isLoading = modelStatus !== "idle" && modelStatus !== "ready" && !isRecording;

  return (
    <div className="controls-bar">
      <div className="ctrl-left">
        <div className="session-title">{session.title}</div>
        <div className="session-meta">
          {formatTime(currentTimestamp)} · {session.transcriptChunks.length} chunks · {session.topics.length} topics
          {modelStatus !== "idle" && modelStatus !== "ready" && (
            <span className="model-status"> · {modelStatus}</span>
          )}
          {activeWhepStreams.length > 0 && (
            <span className="model-status">
              {" · "}📡 {activeWhepStreams.map((s) => `${s.deviceName}${s.isMuted ? " 🔇" : ""}`).join(", ")}
            </span>
          )}
        </div>
      </div>

      <div className="ctrl-right">
        {error && (
          <span className="error-badge" title={error}>⚠ {error.slice(0, 40)}</span>
        )}
        {isProcessing && <span className="proc-badge">✦ AI</span>}

        {/* Source picker */}
        {showPicker && !isRecording && (
          <div className="source-picker">
            <button className="source-btn" onClick={handleMic}>
              🎙 Microphone
            </button>
            <button className="source-btn" onClick={() => fileInputRef.current?.click()}>
              📁 Local file
            </button>
            <button className="source-btn" onClick={() => {
              setShowPicker(false);
              setShowWhepInput(true);
            }}>
              📡 WHEP stream
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* WHEP URL input */}
        {showWhepInput && !isRecording && (
          <div className="whep-input-row">
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <input
                className="qa-input"
                value={whepUrl1}
                onChange={(e) => setWhepUrl1(e.target.value)}
                placeholder="WHEP URL 1 (required)"
              />
              <input
                className="qa-input"
                value={whepUrl2}
                onChange={(e) => setWhepUrl2(e.target.value)}
                placeholder="WHEP URL 2 (optional)"
              />
            </div>
            <button className="source-btn" onClick={handleWhepConnect}>
              Connect
            </button>
            <button className="source-btn" onClick={() => setShowWhepInput(false)}>
              Cancel
            </button>
          </div>
        )}

        {/* Export picker */}
        {showExport && (
          <div className="source-picker">
            <button className="source-btn" onClick={() => { exportMarkdown(); setShowExport(false); }}>
              📝 Notes (.md)
            </button>
            <button className="source-btn" onClick={() => { exportTranscript(); setShowExport(false); }}>
              📄 Transcript (.txt)
            </button>
          </div>
        )}

        {isRecording ? (
          <button className="btn btn-stop" onClick={stopRecording}>◼ Stop</button>
        ) : isLoading ? (
          <button className="btn btn-record" disabled>⏳ {modelStatus}</button>
        ) : (
          <button
            className="btn btn-record"
            onClick={() => { setShowPicker((v) => !v); setShowExport(false); setShowWhepInput(false); }}
          >
            ● Start
          </button>
        )}

        <button
          className="btn btn-ghost"
          onClick={() => { setShowExport((v) => !v); setShowPicker(false); setShowWhepInput(false); }}
        >
          ↓ Export
        </button>
        <button className="btn btn-ghost" onClick={clearSession}>↺ Clear</button>
      </div>
    </div>
  );
}