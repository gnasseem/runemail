const KEY = "runemail_auto_process_briefing_audio";

/** User preference: prefetch briefing TTS (no DB column required). */
export function getBriefingAudioAutoplay(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function persistBriefingAudioAutoplay(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* private mode */
  }
}
