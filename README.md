# Second Brain — Real-time AI Note Companion

A live, intelligent note-taking system that runs while you watch videos, attend meetings, or listen to lectures. Unlike post-video summarizers, Second Brain continuously listens, understands context, and evolves structured notes in real time.

## What makes it different

Most AI note tools work after the fact — they transcribe everything, then summarize. Second Brain works *while* the content plays:

- Only notes **important moments** — skips filler, captures concepts
- Notes are **additive** — new bullets append as new ideas are heard, nothing gets rewritten or repeated
- Works with **live streams** — not just recorded files
- Runs **entirely local** — Whisper WASM in the browser, Ollama on your network, no cloud required
- **Free to run** — no OpenAI API key, no subscriptions

## Features

- 🎙 **Microphone** — uses Web Speech API (Chrome/Edge) for high quality live transcription
- 📁 **Local file** — drag and drop any `.mp4`, `.mp3`, `.wav`, `.webm`
- 📡 **WHEP streams** — connect to any WebRTC/WHEP endpoint (MediaMTX, STB platforms)
- ✦ **Importance detection** — checks every 10s if something worth noting was said before generating notes
- 📝 **Structured markdown notes** — bullet points, bold key terms, no repetition
- 🗂 **Auto chapters** — topic shifts detected and marked on the timeline
- ❓ **Q&A** — ask anything about what was said, answered from the transcript context
- ⬇️ **Export** — download notes as `.md` or full transcript as `.txt`
- 🔄 **Rolling memory** — handles long sessions without overflowing the LLM context window

## Tech stack

| Layer | Technology |
|---|---|
| Transcription (mic) | Web Speech API (Chrome/Edge built-in) |
| Transcription (file/stream) | Whisper WASM via `@huggingface/transformers` |
| AI note generation | Ollama (local LLM — tested with `llama3.1`, `qwen2.5-coder`) |
| Frontend | React + TypeScript (Vite) |
| Live streaming | WebRTC WHEP via `RTCPeerConnection` |
| Memory | Rolling context — short-term verbatim + mid-term compressed |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.ai/) running locally or on your network
- Chrome or Edge (for Web Speech API microphone mode)

### Install

```bash
git clone https://github.com/sshreyash18/Running-Notes-AI.git
npm install
```

### Configure

Create a `.env` file:

```env
VITE_OLLAMA_BASE=http://192.168.0.x:11434/v1
VITE_OLLAMA_MODEL=llama3.1:latest
```

### Run

```bash
npm run dev
```

Open `http://localhost:5173`

## Usage

**Microphone mode** — Click `● Start → 🎙 Microphone`. Speak or play audio near your mic. Notes appear within 10-15 seconds of an important point being made.

**File mode** — Click `● Start → 📁 Local file`. Drop any video or audio file. Whisper model downloads once (~150MB) and is cached permanently.

**WHEP stream** — Click `● Start → 📡 WHEP stream`. Paste a WHEP URL (e.g. `http://localhost:8889/stream/whep`). Works with MediaMTX and any WebRTC publisher.

## Roadmap

- [ ] Semantic search over transcript and notes
- [ ] Flashcard generation from notes
- [ ] Knowledge graph visualization
- [ ] Multi-speaker diarization
- [ ] Electron desktop app with system audio capture
- [ ] WebSocket-based stream discovery (auto-detect active WHEP streams)
- [ ] Offline-first IndexedDB session persistence
- [ ] Study mode with spaced repetition
