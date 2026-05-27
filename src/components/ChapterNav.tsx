import { useApp } from "./app-context";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function ChapterNav() {
  const { session, seekTo } = useApp();
  return (
    <nav className="chapter-nav">
      <div className="panel-label">Chapters</div>
      {session.topics.length === 0 ? (
        <p className="muted-sm">Detected automatically…</p>
      ) : (
        session.topics.map((t) => (
          <button
            key={t.id}
            className={`chapter-btn ${t.id === session.currentTopicId ? "active" : ""}`}
            onClick={() => seekTo(t.startTimestamp)}
          >
            <span className="chapter-ts">{formatTime(t.startTimestamp)}</span>
            <span className="chapter-title">{t.heading}</span>
          </button>
        ))
      )}
    </nav>
  );
}