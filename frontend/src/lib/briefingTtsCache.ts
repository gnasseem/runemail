const KEY_PREFIX = "runemail_briefing_tts_v1";

function fnv1aHash(text: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(36);
}

export function briefingTtsStorageKey(userId: string, text: string): string {
  return `${KEY_PREFIX}_${userId}_${fnv1aHash(text)}`;
}

export function getBriefingTtsFromCache(
  userId: string,
  text: string,
): string | null {
  try {
    const raw = localStorage.getItem(briefingTtsStorageKey(userId, text));
    if (!raw) return null;
    const j = JSON.parse(raw) as { audioContent?: string };
    return typeof j.audioContent === "string" && j.audioContent.length > 0
      ? j.audioContent
      : null;
  } catch {
    return null;
  }
}

export function setBriefingTtsCache(
  userId: string,
  text: string,
  audioContent: string,
): void {
  try {
    localStorage.setItem(
      briefingTtsStorageKey(userId, text),
      JSON.stringify({ audioContent, ts: Date.now() }),
    );
  } catch {
    /* quota or private mode */
  }
}
