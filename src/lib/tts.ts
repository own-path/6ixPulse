// Kokoro-82M neural text-to-speech, run entirely in the browser via transformers.js (ONNX).
// 82M params — well under the hackathon's 32B limit — with no API key and no backend. The
// model (~80MB, quantised) downloads from the Hugging Face CDN on first use, then is cached.

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DEFAULT_VOICE = "af_heart"; // warm, natural American female

// kokoro-js has no bundled types; keep the surface we use minimal.
type KokoroModel = {
  generate: (text: string, options: { voice: string }) => Promise<{ toBlob: () => Blob }>;
};

let modelPromise: Promise<KokoroModel> | null = null;

async function loadModel(): Promise<KokoroModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      return (await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "wasm",
      })) as unknown as KokoroModel;
    })().catch((error) => {
      modelPromise = null; // allow a retry on next click
      throw error;
    });
  }
  return modelPromise;
}

// Warm the model in the background so the first Play click is fast.
export function preloadKokoro(): void {
  void loadModel().catch(() => {});
}

// Synthesize text and return an object-URL for an audio blob. Caller plays + revokes it.
export async function synthesizeKokoro(text: string, voice: string = DEFAULT_VOICE): Promise<string> {
  // Serialize generation: Kokoro is a single in-browser WASM model, so overlapping generate()
  // calls thrash the main thread (freezing scroll) and corrupt each other's output. Chaining
  // them keeps the UI responsive and makes playback reliable when switching neighbourhoods.
  const run = generationQueue.then(async () => {
    const model = await loadModel();
    const audio = await model.generate(text, { voice });
    return URL.createObjectURL(audio.toBlob());
  });
  // Keep the queue alive even if this job fails, so later jobs still run.
  generationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let generationQueue: Promise<unknown> = Promise.resolve();
