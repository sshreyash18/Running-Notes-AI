import { useEffect, useRef } from "react";
import { useApp } from "./app-context";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function boldify(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function MarkdownRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  return (
    <div className="md-body">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h3 key={i}>{line.slice(4)}</h3>;
        if (line.startsWith("## ")) return <h2 key={i}>{line.slice(3)}</h2>;
        if (line.startsWith("# ")) return <h1 key={i}>{line.slice(2)}</h1>;
        if (line.startsWith("- ") || line.startsWith("* "))
          return <li key={i} dangerouslySetInnerHTML={{ __html: boldify(line.slice(2)) }} />;
        if (line.trim() === "") return <div key={i} style={{ height: "0.5rem" }} />;
        return <p key={i} dangerouslySetInnerHTML={{ __html: boldify(line) }} />;
      })}
    </div>
  );
}

export function NotesPanel() {
  const { session, isProcessing, streamingNote } = useApp();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingNote, session.notes.length]);

  const sortedTopics = [...session.topics].sort(
    (a, b) => a.startTimestamp - b.startTimestamp
  );

  return (
    <div className="notes-panel">
      <div className="panel-label">
        AI notes
        {isProcessing && <span className="ai-badge">✦ generating</span>}
      </div>
      <div className="notes-scroll">
        {sortedTopics.length === 0 && (
          <p className="muted-sm">Notes appear as the session progresses…</p>
        )}
        {sortedTopics.map((topic) => {
          const note = session.notes.find((n) => n.topicId === topic.id);
          const isStreaming = isProcessing && topic.id === session.currentTopicId;
          return (
            <div key={topic.id} className="note-section">
              <div className="note-heading">
                <span className="note-ts">{formatTime(topic.startTimestamp)}</span>
                <h2>{topic.heading}</h2>
              </div>
              {isStreaming && streamingNote ? (
                <MarkdownRenderer markdown={streamingNote} />
              ) : note ? (
                <MarkdownRenderer markdown={note.markdown} />
              ) : (
                <p className="muted-sm">Waiting for content…</p>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}