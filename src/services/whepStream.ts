export interface StreamInfo {
  streamId: string;
  whepUrl: string;
  deviceName: string;
  role: "host" | "cohost";
  isMuted: boolean;
}

export interface WhepStreamOptions {
  onAudioChunk: (pcm: Float32Array, sampleRate: number, streamInfo: StreamInfo) => void;
  onError: (error: string) => void;
}

interface ActiveStream {
  info: StreamInfo;
  peerConnection: RTCPeerConnection;
  audioContext: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
}

export class WhepStreamService {
  private activeStreams = new Map<string, ActiveStream>();
  private options: WhepStreamOptions;
  private chunkSeconds: number;

  constructor(options: WhepStreamOptions, chunkSeconds = 4) {
    this.options = options;
    this.chunkSeconds = chunkSeconds;
  }

  async addStream(whepUrl: string, deviceName = "Stream"): Promise<void> {
    const streamId = crypto.randomUUID();
    const info: StreamInfo = {
      streamId,
      whepUrl,
      deviceName,
      role: "host",
      isMuted: false,
    };
    console.log("[WHEP] Connecting to:", whepUrl);
    await this.connectStream(info);
  }

  private async connectStream(info: StreamInfo): Promise<void> {
  try {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      bundlePolicy: "max-bundle",
    });

    // Set up audio context
    const audioContext = new AudioContext();
    const sampleRate = audioContext.sampleRate;
    const samplesPerChunk = Math.floor(sampleRate * this.chunkSeconds);

    // Store early
    this.activeStreams.set(info.streamId, {
      info,
      peerConnection: pc,
      audioContext,
      processor: null as any,
      source: null as any,
    });

    // Track handler
    pc.ontrack = (e) => {
      console.log("[WHEP] ontrack fired:", e.track.kind, e.track.readyState);
      if (e.track.kind !== "audio") return;

      const ms = new MediaStream([e.track]);
      const source = audioContext.createMediaStreamSource(ms);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      let collected = new Float32Array(samplesPerChunk);
      let collectedCount = 0;

      processor.onaudioprocess = (ev) => {
  const active = this.activeStreams.get(info.streamId);
  if (active?.info.isMuted) return;
  const input = ev.inputBuffer.getChannelData(0);
  let i = 0;
  while (i < input.length) {
    const space = samplesPerChunk - collectedCount;
    const toCopy = Math.min(space, input.length - i);
    collected.set(input.subarray(i, i + toCopy), collectedCount);
    collectedCount += toCopy;
    i += toCopy;
    if (collectedCount >= samplesPerChunk) {
      const maxAmp = collected.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
      console.log("[WHEP Audio] Chunk ready, maxAmp:", maxAmp.toFixed(3));  // ADD THIS
      if (maxAmp > 0.01) {
        this.options.onAudioChunk(collected.slice(), sampleRate, info);
      }
      collected = new Float32Array(samplesPerChunk);
      collectedCount = 0;
    }
  }
};

 source.connect(processor);
processor.connect(audioContext.destination);

// Resume AudioContext
audioContext.resume().then(() => {
  console.log("[WHEP] AudioContext state after resume:", audioContext.state);
});

// Monitor track state
e.track.onmute = () => console.log("[WHEP] Track muted");
e.track.onunmute = () => console.log("[WHEP] Track unmuted");
e.track.onended = () => console.log("[WHEP] Track ended");
console.log("[WHEP] Track enabled:", e.track.enabled, "muted:", e.track.muted, "readyState:", e.track.readyState);

      const active = this.activeStreams.get(info.streamId);
      if (active) {
        active.processor = processor;
        active.source = source;
      }

      console.log("[WHEP] Audio pipeline connected for:", info.deviceName);
    };

    pc.oniceconnectionstatechange = () => {
      console.log("[WHEP] ICE state:", pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log("[WHEP] Connection state:", pc.connectionState);
    };

    // Add transceivers BEFORE creating offer
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete before sending offer
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }
      pc.onicegatheringstatechange = () => {
        console.log("[WHEP] ICE gathering:", pc.iceGatheringState);
        if (pc.iceGatheringState === "complete") resolve();
      };
      // Timeout fallback — send offer anyway after 3s
      setTimeout(resolve, 3000);
    });

    console.log("[WHEP] Sending offer SDP to:", info.whepUrl);

    const res = await fetch(info.whepUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
        "Accept": "application/sdp",
      },
      body: pc.localDescription!.sdp,
    });

    console.log("[WHEP] WHEP response status:", res.status);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WHEP handshake failed: ${res.status} — ${body}`);
    }

    const answerSdp = await res.text();
    console.log("[WHEP] Answer SDP received, length:", answerSdp.length);

    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    console.log("[WHEP] Remote description set, waiting for ICE + tracks...");

    // Wait for connection + audio track
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const active = this.activeStreams.get(info.streamId);
        if (active?.processor) {
          resolve();
        } else {
          reject(new Error(
            `Audio track not received. ICE state: ${pc.iceConnectionState}, ` +
            `Connection state: ${pc.connectionState}`
          ));
        }
      }, 15000);

      const check = setInterval(() => {
        const active = this.activeStreams.get(info.streamId);
        if (active?.processor) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 200);
    });

    console.log("[WHEP] ✓ Stream fully connected:", info.deviceName);

  } catch (e: any) {
    console.error("[WHEP] Failed:", e.message);
    this.activeStreams.delete(info.streamId);
    this.options.onError(`WHEP failed: ${e.message}`);
  }
}

  removeStream(streamId: string): void {
    const active = this.activeStreams.get(streamId);
    if (!active) return;
    try {
      active.processor.disconnect();
      active.source.disconnect();
      active.audioContext.close();
      active.peerConnection.close();
    } catch {}
    this.activeStreams.delete(streamId);
    console.log("[WHEP] Stream removed:", streamId);
  }

  getActiveStreams(): StreamInfo[] {
    return Array.from(this.activeStreams.values()).map((s) => s.info);
  }

  disconnect(): void {
    for (const id of [...this.activeStreams.keys()]) {
      this.removeStream(id);
    }
    console.log("[WHEP] All streams disconnected");
  }
}