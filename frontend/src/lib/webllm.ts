/**
 * WebLLM integration for local on-device AI processing.
 * This runs entirely in the browser — no data leaves the device.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;
let loadProgress = 0;
// Single shared promise so concurrent callers wait instead of bailing
let loadingPromise: Promise<boolean> | null = null;

type ProgressCallback = (progress: number, text: string) => void;

export async function initWebLLM(
  onProgress?: ProgressCallback,
): Promise<boolean> {
  if (engine) return true;

  // If a load is already in progress, wait for it
  if (loadingPromise) return loadingPromise;

  loadProgress = 0;

  loadingPromise = (async () => {
    try {
      const webllm = await import("@mlc-ai/web-llm");

      engine = await webllm.CreateMLCEngine("Qwen2.5-3B-Instruct-q4f16_1-MLC", {
        initProgressCallback: (report: { progress: number; text: string }) => {
          loadProgress = Math.round(report.progress * 100);
          onProgress?.(loadProgress, report.text);
        },
      });

      loadingPromise = null;
      return true;
    } catch (err) {
      console.error("WebLLM init failed:", err);
      engine = null;
      loadingPromise = null;
      return false;
    }
  })();

  return loadingPromise;
}

export function isWebLLMReady(): boolean {
  return engine !== null;
}

export function getLoadProgress(): number {
  return loadProgress;
}

/**
 * Robustly extract JSON from a model response that may contain
 * markdown code fences, preamble, or trailing commentary.
 */
export function extractJSON<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;

  // Try code fence content first
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch { /* continue */ }
  }

  // Try full string
  try {
    return JSON.parse(raw.trim()) as T;
  } catch { /* continue */ }

  // Try first JSON object
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T;
    } catch { /* continue */ }
  }

  // Try first JSON array
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]) as T;
    } catch { /* continue */ }
  }

  return fallback;
}

export async function localInference(
  systemPrompt: string,
  userMessage: string,
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  if (!engine) {
    throw new Error("WebLLM not initialized. Call initWebLLM() first.");
  }

  const INFERENCE_TIMEOUT_MS = 60_000;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("WebLLM inference timed out after 60s")), INFERENCE_TIMEOUT_MS),
  );

  const response = await Promise.race([
    engine.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 256,
    }),
    timeoutPromise,
  ]);

  return response.choices[0]?.message?.content || "";
}

export async function localChatInference(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  if (!engine) {
    throw new Error("WebLLM not initialized. Call initWebLLM() first.");
  }

  const INFERENCE_TIMEOUT_MS = 90_000;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("WebLLM chat inference timed out after 90s")), INFERENCE_TIMEOUT_MS),
  );

  const response = await Promise.race([
    engine.chat.completions.create({
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 2048,
    }),
    timeoutPromise,
  ]);

  return response.choices[0]?.message?.content || "";
}

