import { useState } from "react";
import { useApp } from "./app-context";

function boldify(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function MarkdownRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  return (
    <div className="md-body">
      {lines.map((line, i) => {
        if (line.startsWith("- ") || line.startsWith("* "))
          return <li key={i} dangerouslySetInnerHTML={{ __html: boldify(line.slice(2)) }} />;
        if (line.trim() === "") return <div key={i} style={{ height: "0.5rem" }} />;
        return <p key={i} dangerouslySetInnerHTML={{ __html: boldify(line) }} />;
      })}
    </div>
  );
}

export function QAPanel() {
  const { askQuestion } = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ q: string; a: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    if (!input.trim()) return;
    const q = input.trim();
    setInput("");
    setLoading(true);
    try {
      const a = await askQuestion(q);
      setMessages((m) => [...m, { q, a }]);
    } catch (e: any) {
      setMessages((m) => [...m, { q, a: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="qa-panel">
      <div className="panel-label">Ask about the content</div>
      <div className="qa-scroll">
        {messages.length === 0 && (
          <p className="muted-sm">Ask anything about what's been said.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="qa-entry">
            <div className="qa-q">❓ {m.q}</div>
            <div className="qa-a">
              <MarkdownRenderer markdown={m.a} />
            </div>
          </div>
        ))}
        {loading && <div className="qa-loading">✦ thinking…</div>}
      </div>
      <div className="qa-input-row">
        <input
          className="qa-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk()}
          placeholder="What is multi-head attention?"
          disabled={loading}
        />
        <button className="qa-send" onClick={handleAsk} disabled={loading || !input.trim()}>
          Ask
        </button>
      </div>
    </div>
  );
}