import sys
import os
import io
import json
import warnings
import logging

# Ensure UTF-8 output encoding on Windows (handles filenames with emojis, unicode, etc.)
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        else:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass

# Suppress standard non-critical warnings and root logs
warnings.filterwarnings("ignore")
logging.getLogger().setLevel(logging.ERROR)

# Ensure ffmpeg in PATH for audio decoding
app_data = os.environ.get("LOCALAPPDATA", "")
if app_data:
    ffmpeg_dir = os.path.join(app_data, "com.armzi.remixer-tools")
    if os.path.exists(ffmpeg_dir):
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

import librosa
import numpy as np

PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# 1. David Temperley CBMS Profiles (Cognitive Basis for Musical Structure)
# Specifically penalizes out-of-scale tones and eliminates major/minor 3rd ambiguity
TEMP_MAJ = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0])
TEMP_MIN = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0])

# 2. Sha'ath / KeyFinder Profiles (Empirically tuned across thousands of modern commercial tracks)
SHA_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
SHA_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

def estimate_key_advanced(y, sr):
    """
    High-precision multi-band key detection:
    1. HPSS (Harmonic-Percussive Separation) to eliminate drum noise.
    2. Concert pitch tuning calibration.
    3. RMS energy gating to ignore quiet pauses and background bleed.
    4. Dual-band Chroma: Bass Chroma (root tonic isolation) + Full Chroma.
    5. Modern Ensemble correlation (Temperley + Sha'ath).
    6. Parallel Major vs Minor disambiguation via 3rd degree harmonic ratio.
    """
    # 1. Harmonic extraction to isolate tonal pitches from drums/percussion
    try:
        y_harm = librosa.effects.harmonic(y, margin=2.5)
    except Exception:
        y_harm = y

    # 2. Tuning estimation (compensates for 442Hz or microtonal pitch drift)
    try:
        tuning = float(librosa.estimate_tuning(y=y_harm, sr=sr))
    except Exception:
        tuning = 0.0

    # 3. Full-spectrum Chroma CQT with tuning offset
    chroma_cqt = librosa.feature.chroma_cqt(
        y=y_harm, sr=sr, tuning=tuning, n_chroma=12, n_octaves=7, hop_length=512
    )

    # 4. Energy-Weighted Frame Gating
    rms = librosa.feature.rms(y=y_harm, hop_length=512)[0]
    thresh = float(np.percentile(rms, 35))
    active = rms > thresh
    if np.sum(active) > 10:
        chroma_active = chroma_cqt[:, active]
    else:
        chroma_active = chroma_cqt

    chroma_vals = np.mean(chroma_active, axis=1)
    chroma_norm = chroma_vals / (np.linalg.norm(chroma_vals) + 1e-8)

    # 5. Bass Chroma (C1 to C3: ~32Hz to ~260Hz) to lock in the true chord root/tonic
    try:
        fmin_bass = float(librosa.note_to_hz('C1'))
        bass_cqt = librosa.feature.chroma_cqt(
            y=y_harm, sr=sr, tuning=tuning, fmin=fmin_bass, n_octaves=3, hop_length=512
        )
        if np.sum(active) > 10:
            bass_active = bass_cqt[:, active]
        else:
            bass_active = bass_cqt
        bass_vals = np.mean(bass_active, axis=1)
        bass_norm = bass_vals / (np.linalg.norm(bass_vals) + 1e-8)
    except Exception:
        bass_norm = np.zeros(12)

    # 6. Ensemble Profile Scoring
    best_score = -999.0
    best_key = "C Major"

    for i in range(12):
        # Major correlation
        c_temp_maj = np.corrcoef(chroma_norm, np.roll(TEMP_MAJ, i))[0, 1]
        c_sha_maj = np.corrcoef(chroma_norm, np.roll(SHA_MAJ, i))[0, 1]
        score_maj = 0.55 * c_temp_maj + 0.45 * c_sha_maj

        # Minor correlation
        c_temp_min = np.corrcoef(chroma_norm, np.roll(TEMP_MIN, i))[0, 1]
        c_sha_min = np.corrcoef(chroma_norm, np.roll(SHA_MIN, i))[0, 1]
        score_min = 0.55 * c_temp_min + 0.45 * c_sha_min

        # Bass tonic reinforcement: if root matches strong bass frequency
        score_maj += 0.20 * bass_norm[i]
        score_min += 0.20 * bass_norm[i]

        # Parallel Major vs Minor disambiguation (The 3rd degree test)
        maj_3rd = (i + 4) % 12
        min_3rd = (i + 3) % 12
        third_diff = chroma_norm[maj_3rd] - chroma_norm[min_3rd]
        score_maj += 0.15 * third_diff
        score_min -= 0.15 * third_diff

        if score_maj > best_score:
            best_score = score_maj
            best_key = f"{PITCH_NAMES[i]} Major"

        if score_min > best_score:
            best_score = score_min
            best_key = f"{PITCH_NAMES[i]} Minor"

    return best_key

def analyze(file_path):
    try:
        # Load audio at 22050Hz (optimal balance of full pitch range and processing speed)
        # Cap analysis duration at 180 seconds to ensure sub-5s analysis
        y, sr = librosa.load(file_path, sr=22050, mono=True, duration=180.0)

        # Robust BPM estimation with prior around typical musical tempo (60-180 BPM)
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        try:
            tempo_est = librosa.feature.tempo(onset_envelope=onset_env, sr=sr, start_bpm=120.0)
            tempo_arr = np.asarray(tempo_est)
            tempo_val = float(tempo_arr.flat[0])
        except Exception:
            tempo_raw, _ = librosa.beat.beat_track(y=y, sr=sr)
            tempo_arr = np.asarray(tempo_raw)
            tempo_val = float(tempo_arr.flat[0])

        # High-precision Key Detection
        detected_key = estimate_key_advanced(y, sr)

        print(json.dumps({
            "status": "success",
            "bpm": round(tempo_val),
            "key": detected_key
        }))
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "message": str(e)
        }))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No file path provided"}))
        sys.exit(1)
    analyze(sys.argv[1])
