// Kokoro-82M neural text-to-speech (82M params, well under the 32B limit — no API key, no
// backend). The heavy ONNX/WASM inference runs in a Web Worker (tts.worker.ts) so generating
// audio NEVER blocks the main thread: the app stays scrollable and responsive while a clip is
// being prepared in the background, ready to play the instant the user hits Play.

const DEFAULT_VOICE = "af_heart"; // warm, natural American female

type WorkerReply = { id: number; ok: boolean; buffer?: ArrayBuffer; error?: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: ArrayBuffer | null) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
      const { id, ok, buffer } = event.data || ({} as WorkerReply);
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.resolve(ok && buffer ? buffer : null);
    });
    worker.addEventListener("error", () => {
      // A worker-level failure rejects everything in flight; callers fall back to browser speech.
      for (const [, entry] of pending) entry.resolve(null);
      pending.clear();
      worker = null;
    });
  } catch {
    worker = null;
  }
  return worker;
}

// Warm the model in the background (off-thread) so the first Play is instant.
export function preloadKokoro(): void {
  const w = getWorker();
  if (w) w.postMessage({ id: nextId++, type: "preload" });
}

// Synthesize text and return an object-URL for an audio blob. Caller plays + revokes it.
// Returns null if the worker/model is unavailable so the caller can fall back to browser speech.
export async function synthesizeKokoro(
  text: string,
  voice: string = DEFAULT_VOICE,
): Promise<string | null> {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  const buffer = await new Promise<ArrayBuffer | null>((resolve) => {
    pending.set(id, { resolve });
    w.postMessage({ id, type: "generate", text, voice });
  });
  if (!buffer) return null;
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}
