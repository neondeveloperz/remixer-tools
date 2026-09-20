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

def analyze(file_path):
    try:
        y, sr = librosa.load(file_path, sr=None, mono=True)
        # BPM
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        
        # Key
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_vals = np.sum(chroma, axis=1)
        
        # Krumhansl-Schmuckler profiles
        maj_profile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
        min_profile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
        
        keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        
        best_corr = -1
        best_key = ""
        for i in range(12):
            # Major
            corr_maj = np.corrcoef(chroma_vals, np.roll(maj_profile, i))[0, 1]
            if corr_maj > best_corr:
                best_corr = corr_maj
                best_key = keys[i] + " Major"
                
            # Minor
            corr_min = np.corrcoef(chroma_vals, np.roll(min_profile, i))[0, 1]
            if corr_min > best_corr:
                best_corr = corr_min
                best_key = keys[i] + " Minor"
                
        if hasattr(tempo, '__len__') and len(tempo) > 0:
            tempo_val = float(tempo[0])
        elif hasattr(tempo, 'item'):
            tempo_val = float(tempo.item())
        else:
            tempo_val = float(tempo)
            
        print(json.dumps({
            "status": "success",
            "bpm": round(tempo_val),
            "key": best_key
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
