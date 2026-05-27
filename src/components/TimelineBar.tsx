import { useApp } from "./app-context";
import { CONFIG } from "../config";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function TimelineBar() {
  const { session, currentTimestamp, seekTo } = useApp();
  const total = Math.max(currentTimestamp + 60, 120);
  const pct = Math.min((currentTimestamp / total) * 100, 100);

  return (
    <div className="timeline-bar">
      <div
        className="timeline-track"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          seekTo(Math.floor(ratio * total));
        }}
      >
        <div className="timeline-fill" style={{ width: `${pct}%` }} />
        {session.topics.map((t) => (
          <div
            key={t.id}
            className="timeline-marker"
            style={{ left: `${Math.min((t.startTimestamp / total) * 100, 99)}%` }}
            title={t.heading}
          />
        ))}
      </div>
      <div className="timeline-time">
        {formatTime(currentTimestamp)} / {formatTime(total)}
      </div>
    </div>
  );
}