export interface SpeechRecognitionOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
}

export class BrowserSpeechService {
  private recognition: any = null;
  private isRunning = false;

  isSupported(): boolean {
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
  }

  start(options: SpeechRecognitionOptions): void {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SR) {
      options.onError("Web Speech API not supported in this browser");
      return;
    }

    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (text) {
          options.onTranscript(text, result.isFinal);
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error !== "no-speech") {
        options.onError(`Speech recognition error: ${event.error}`);
      }
    };

    this.recognition.onend = () => {
      // Auto-restart if still supposed to be running
      if (this.isRunning) {
        setTimeout(() => {
          try {
            this.recognition?.start();
          } catch {}
        }, 300);
      }
    };

    this.isRunning = true;
    this.recognition.start();
    console.log("[Speech] Browser Speech API started");
  }

  stop(): void {
    this.isRunning = false;
    try {
      this.recognition?.stop();
    } catch {}
    this.recognition = null;
    console.log("[Speech] Browser Speech API stopped");
  }
}