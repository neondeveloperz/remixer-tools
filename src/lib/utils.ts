export { cn } from "cn";

/**
 * Extracts the clean stem name from separated audio filenames.
 * Handles audio-separator patterns like:
 * - "Song (Live)_(Bass)_htdemucs_6s.mp3" -> "Bass"
 * - "Song_(Vocals)_model.wav" -> "Vocals"
 * - "Song (Official Video)_(Drums).flac" -> "Drums"
 * - "vocals.mp3" -> "Vocals"
 */
export function extractStemName(filename: string): string {
  // 1. Look for _(StemName) which is audio-separator standard format:
  const matches = [...filename.matchAll(/_\(([^)]+)\)/g)];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    if (lastMatch && lastMatch[1]) {
      return lastMatch[1];
    }
  }

  // 2. Check for known stem keywords in the filename:
  const stemKeywords = [
    "vocals",
    "instrumental",
    "drums",
    "bass",
    "guitar",
    "piano",
    "other",
    "lead",
    "backing",
    "synth",
    "vocals_dry",
    "inst",
  ];
  const cleanName = filename.replace(/\.[^/.]+$/, "");
  for (const kw of stemKeywords) {
    const regex = new RegExp(`(?:^|[._\\s(])(${kw})(?:[._\\s)]|$)`, "i");
    const m = cleanName.match(regex);
    if (m && m[1]) {
      return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    }
  }

  // 3. Fallback to any trailing parenthesis if present:
  const allParens = [...filename.matchAll(/\(([^)]+)\)/g)];
  if (allParens.length > 0) {
    const last = allParens[allParens.length - 1];
    if (last && last[1]) return last[1];
  }

  return cleanName;
}
