// Kokoro-82M TTS worker. Runs the ONNX/WASM inference OFF the main thread so generating
// audio never blocks scrolling or the rest of the UI. The main thread talks to it over
// postMessage; the worker loads the model once, generates one clip at a time (serialized), and
// posts the audio back as a transferable ArrayBuffer (the main thread wraps it in a Blob URL).

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

type KokoroModel = {
  generate: (text: string, options: { voice: string }) => Promise<{ toBlob: () => Blob }>;
};

// Minimal worker-scope typing so we don't need the DOM/webworker lib combo (whose postMessage
// signatures clash). The runtime is a DedicatedWorkerGlobalScope.
const ctx = self as unknown as {
  postMessage: (message: unknown, options?: { transfer?: Transferable[] }) => void;
  addEventListener: (type: "message", listener: (event: { data: WorkerRequest }) => void) => void;
};

type WorkerRequest = { id: number; type: "generate" | "preload"; text?: string; voice?: string };

let modelPromise: Promise<KokoroModel> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function loadModel(): Promise<KokoroModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      return (await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "wasm",
      })) as unknown as KokoroModel;
    })().catch((error) => {
      modelPromise = null; // allow a retry on the next request
      throw error;
    });
  }
  return modelPromise;
}

ctx.addEventListener("message", (event) => {
  const { id, type, text, voice } = event.data || ({} as WorkerRequest);
  if (type === "preload") {
    void loadModel().then(
      () => ctx.postMessage({ id, ok: true }),
      (error) => ctx.postMessage({ id, ok: false, error: String(error) }),
    );
    return;
  }
  if (type === "generate") {
    queue = queue.then(async () => {
      try {
        const model = await loadModel();
        const audio = await model.generate(String(text ?? ""), { voice: voice || "af_heart" });
        const buffer = await audio.toBlob().arrayBuffer();
        ctx.postMessage({ id, ok: true, buffer }, { transfer: [buffer] });
      } catch (error) {
        ctx.postMessage({ id, ok: false, error: String(error) });
      }
    });
  }
});
