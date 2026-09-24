import sys
import os
import io
import re
import json
import warnings
import logging
import tempfile

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

# Pitch class maps & scale intervals
PITCH_CLASSES = {
    "C": 0, "B#": 0,
    "C#": 1, "DB": 1,
    "D": 2,
    "D#": 3, "EB": 3,
    "E": 4, "FB": 4,
    "F": 5, "E#": 5,
    "F#": 6, "GB": 6,
    "G": 7,
    "G#": 8, "AB": 8,
    "A": 9,
    "A#": 10, "BB": 10,
    "B": 11, "CB": 11,
}

SCALE_INTERVALS = {
    "major": {0, 2, 4, 5, 7, 9, 11},
    "minor": {0, 2, 3, 5, 7, 8, 10},
}

def extract_key_from_string(text):
    """
    Attempts to detect musical key from filename (e.g. '_128BPM_A#_Major' or 'F_Minor').
    """
    if not text:
        return None, None
    m = re.search(r'([A-G][#b]?)[_ ]?(Major|Minor|maj|min|m\b)', text, re.IGNORECASE)
    if m:
        root = m.group(1).upper()
        raw_mode = m.group(2).lower()
        mode = "minor" if ("min" in raw_mode or raw_mode == "m") else "major"
        if root in PITCH_CLASSES:
            return root, mode
    return None, None

def find_companion_beat_audio(audio_path):
    """
    Looks for companion stems in the same or parent folder that offer sharper transients
    (drums, percussion, or full mixture) to anchor the musical beat grid.
    """
    dirname = os.path.dirname(audio_path)
    if not dirname or not os.path.exists(dirname):
        return None

    candidate_names = [
        "drums.wav", "drums.mp3", "drums.flac", "drum.wav", "percussion.wav",
        "mixture.wav", "original.wav", "input.wav", "mix.wav", "audio.wav"
    ]

    # 1. Check same directory
    for c in candidate_names:
        cp = os.path.join(dirname, c)
        if os.path.exists(cp) and os.path.abspath(cp) != os.path.abspath(audio_path):
            return cp

    # 2. Check parent directory
    parent = os.path.dirname(dirname)
    if parent and os.path.exists(parent):
        for c in candidate_names:
            cp = os.path.join(parent, c)
            if os.path.exists(cp) and os.path.abspath(cp) != os.path.abspath(audio_path):
                return cp

    return None

def detect_audio_bpm_and_phase(audio_path, explicit_bpm=None):
    """
    High-precision BPM & downbeat phase detection:
    1. Direct explicit user BPM if specified.
    2. Filename BPM tag extraction (e.g. '_128BPM_').
    3. Transient-aware beat tracking using HPSS (Harmonic-Percussive Separation)
       on either companion drum stem (if present) or source audio.
    4. Median IBI (Inter-Beat Interval) calculation + Integer BPM snapping.
    5. Downbeat / first-beat timestamp offset.
    Returns: (bpm: float, first_beat_offset: float)
    """
    # 1. Explicit BPM (User requested override)
    target_bpm = None
    if explicit_bpm:
        try:
            val = float(explicit_bpm)
            if 30.0 <= val <= 300.0:
                target_bpm = round(val, 1)
        except (ValueError, TypeError):
            pass

    # 2. Filename pattern (e.g. '_128BPM_' or '95 BPM')
    m = re.search(r'(\d+(?:\.\d+)?)\s*BPM', audio_path, re.IGNORECASE)
    filename_bpm = None
    if m:
        try:
            val = float(m.group(1))
            if 30.0 <= val <= 300.0:
                filename_bpm = round(val, 1)
        except ValueError:
            pass

    # 3. Dynamic Signal Analysis via HPSS & Beat Tracking
    first_beat = 0.0

    try:
        import librosa
        import numpy as np

        # Check for companion drum stem with sharper transients
        target_path = audio_path
        companion_stem = find_companion_beat_audio(audio_path)
        if companion_stem:
            target_path = companion_stem

        # Load up to 75 seconds for fast & accurate tempo mapping
        y, sr = librosa.load(target_path, sr=22050, mono=True, duration=75.0)

        # Isolate percussive transients via HPSS
        try:
            _, y_perc = librosa.effects.hpss(y)
            perc_energy = float(np.mean(y_perc ** 2))
            analysis_y = y_perc if perc_energy > 1e-5 else y
        except Exception:
            analysis_y = y

        # High-resolution onset envelope (hop_length=256 for sub-12ms precision)
        hop_length = 256
        onset_env = librosa.onset.onset_strength(y=analysis_y, sr=sr, hop_length=hop_length)

        start_bpm_hint = target_bpm if target_bpm else (filename_bpm if filename_bpm else 120.0)
        tempo_est, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=hop_length,
            start_bpm=start_bpm_hint,
            tightness=100
        )

        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop_length)
        if len(beat_times) > 0:
            first_beat = float(beat_times[0])

        if target_bpm:
            # User gave explicit BPM; return it locked with the real audio downbeat phase!
            return target_bpm, first_beat

        bpm_candidate = float(np.asarray(tempo_est).flat[0])

        # If we have at least 6 beats, compute median Inter-Beat-Interval
        if len(beat_times) >= 6:
            ibis = np.diff(beat_times)
            med_ibi = float(np.median(ibis))
            if med_ibi > 0.15:
                ibi_bpm = 60.0 / med_ibi
                if 35.0 <= ibi_bpm <= 260.0:
                    bpm_candidate = ibi_bpm

        # If filename had a clear BPM and candidate is close (e.g. harmonic multiple/half), trust filename
        if filename_bpm:
            ratio = bpm_candidate / filename_bpm
            if 0.95 <= ratio <= 1.05 or 1.95 <= ratio <= 2.05 or 0.48 <= ratio <= 0.52:
                return filename_bpm, first_beat

        # Integer snapping: in 95%+ of modern music, DAW projects use integer tempos (120, 128, 140...)
        nearest_int = round(bpm_candidate)
        if abs(bpm_candidate - nearest_int) <= 0.35:
            final_bpm = float(nearest_int)
        else:
            # Check half-integer (e.g. 128.5)
            nearest_half = round(bpm_candidate * 2.0) / 2.0
            if abs(bpm_candidate - nearest_half) <= 0.15:
                final_bpm = float(nearest_half)
            else:
                final_bpm = round(bpm_candidate, 1)

        if 35.0 <= final_bpm <= 260.0:
            return final_bpm, first_beat

    except Exception as e:
        logging.warning(f"Audio BPM detection error: {e}")

    if target_bpm:
        return target_bpm, first_beat
    if filename_bpm:
        return filename_bpm, first_beat
    return 120.0, first_beat

def detect_audio_bpm(audio_path, explicit_bpm=None):
    bpm, _ = detect_audio_bpm_and_phase(audio_path, explicit_bpm=explicit_bpm)
    return bpm

def prepare_normalized_audio(audio_path):
    """
    Checks audio peak amplitude. If quiet (< 0.75 peak), exports a temporary peak-normalized
    copy at 0.95 peak so the neural net activation detects subtle and soft passages with full precision.
    """
    try:
        import soundfile as sf
        import librosa
        import numpy as np

        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        max_val = float(np.max(np.abs(y))) if len(y) > 0 else 0.0

        if 0.001 < max_val < 0.75:
            gain = 0.95 / max_val
            y_norm = np.clip(y * gain, -1.0, 1.0)
            temp_wav = tempfile.NamedTemporaryFile(suffix="_norm.wav", delete=False)
            temp_path = temp_wav.name
            temp_wav.close()
            sf.write(temp_path, y_norm, sr, subtype='PCM_16')
            return temp_path, True
    except Exception as e:
        logging.warning(f"Audio normalization bypass: {e}")

    return audio_path, False

# High-Precision Key Profiles (Temperley CBMS + Sha'ath KeyFinder)
TEMP_MAJ = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0]
TEMP_MIN = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0]
SHA_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
SHA_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def estimate_key_from_midi(midi_data, min_correlation=0.48):
    """
    Estimates the musical key from MIDI note distribution using:
    1. Weighted duration & velocity histogram.
    2. Bass root weighting (notes in octave <= 3).
    3. Temperley + Sha'ath ensemble profiles.
    4. 3rd-degree verification (Major 3rd vs Minor 3rd energy) to prevent mode confusion.
    """
    try:
        import numpy as np
    except ImportError:
        return None, None

    histogram = np.zeros(12)
    bass_hist = np.zeros(12)

    for inst in midi_data.instruments:
        if inst.is_drum:
            continue
        for n in inst.notes:
            dur = n.end - n.start
            weight = dur * (n.velocity / 127.0)
            histogram[n.pitch % 12] += weight
            if n.pitch < 60:
                bass_hist[n.pitch % 12] += weight

    total = np.sum(histogram)
    if total <= 0:
        return None, None
    hist_norm = histogram / (np.linalg.norm(histogram) + 1e-8)
    bass_total = np.sum(bass_hist)
    bass_norm = (bass_hist / (np.linalg.norm(bass_hist) + 1e-8)) if bass_total > 0 else np.zeros(12)

    best_score = -999.0
    best_key = (None, None)

    for i in range(12):
        c_temp_maj = np.corrcoef(hist_norm, np.roll(TEMP_MAJ, i))[0, 1]
        c_sha_maj = np.corrcoef(hist_norm, np.roll(SHA_MAJ, i))[0, 1]
        score_maj = 0.55 * c_temp_maj + 0.45 * c_sha_maj

        c_temp_min = np.corrcoef(hist_norm, np.roll(TEMP_MIN, i))[0, 1]
        c_sha_min = np.corrcoef(hist_norm, np.roll(SHA_MIN, i))[0, 1]
        score_min = 0.55 * c_temp_min + 0.45 * c_sha_min

        # Bass root bonus
        score_maj += 0.20 * bass_norm[i]
        score_min += 0.20 * bass_norm[i]

        # 3rd-degree disambiguation
        maj_3rd = (i + 4) % 12
        min_3rd = (i + 3) % 12
        third_diff = hist_norm[maj_3rd] - hist_norm[min_3rd]
        score_maj += 0.15 * third_diff
        score_min -= 0.15 * third_diff

        if score_maj > best_score:
            best_score = score_maj
            best_key = (PITCH_NAMES[i], 'major')

        if score_min > best_score:
            best_score = score_min
            best_key = (PITCH_NAMES[i], 'minor')

    if best_score >= min_correlation:
        return best_key[0], best_key[1]
    return None, None

def merge_sustained_notes(midi_data, max_gap=0.035):
    """
    Merges only micro-gaps (<= 35ms) caused by threshold fluctuation,
    preserving rapid repeated notes and staccatos without swallowing onsets.
    """
    merged_count = 0
    for inst in midi_data.instruments:
        if inst.is_drum:
            continue
        notes_by_pitch = {}
        for n in inst.notes:
            notes_by_pitch.setdefault(n.pitch, []).append(n)

        merged = []
        for p, p_notes in notes_by_pitch.items():
            p_notes.sort(key=lambda x: x.start)
            curr = None
            for n in p_notes:
                if curr is None:
                    curr = n
                    continue
                gap = n.start - curr.end
                # Merge only if gap is microscopic (<= 35ms) and velocities are closely matched
                if -0.02 <= gap <= max_gap and n.velocity <= curr.velocity * 1.25:
                    curr.end = max(curr.end, n.end)
                    curr.velocity = max(curr.velocity, n.velocity)
                    merged_count += 1
                else:
                    merged.append(curr)
                    curr = n
            if curr is not None:
                merged.append(curr)

        merged.sort(key=lambda x: x.start)
        inst.notes = merged
    return merged_count

def filter_piano_noise(midi_data):
    """
    Acoustic Piano Noise & Harmonic Suppressor:
    1. 88-Key Range Boundary: Limits notes to A0 (MIDI 21) to C8 (MIDI 108).
    2. Low-Noise Floor: Drops faint background artifacts (velocity < 18 or sub-25ms clicks).
    3. Gentle Harmonic Suppressor: Drops phantom harmonics only when extremely weak (< 24% of fundamental).
    4. Per-Pitch Monophonic Clamp: Clamps previous note end if the same key is struck again.
    """
    for inst in midi_data.instruments:
        if inst.is_drum:
            continue

        # 1. 88-key Piano Range Guard
        in_range_notes = [n for n in inst.notes if 21 <= n.pitch <= 108]

        # 2. Gentle Noise Floor (preserves delicate pianissimo notes down to velocity 12)
        gated_notes = []
        for n in in_range_notes:
            dur = n.end - n.start
            if n.velocity < 12 or (n.velocity < 18 and dur < 0.020):
                continue
            gated_notes.append(n)

        # 3. Smart Acoustic Piano Harmonic Overtone Suppression
        # Drops ghost physical overtones caused by string resonance
        # (e.g. 5th harmonic = Major 3rd + 2 octaves, 3rd harmonic = 5th + 1 octave)
        # ONLY drops them if they start simultaneously with a stronger fundamental note (within 35ms)
        # AND are significantly weaker (low velocity), preserving genuine polyphonic chords!
        gated_notes.sort(key=lambda x: (x.start, x.pitch))
        pruned_overtones = set()

        for i in range(len(gated_notes)):
            if i in pruned_overtones:
                continue
            fund = gated_notes[i]
            for j in range(i + 1, min(i + 40, len(gated_notes))):
                cand = gated_notes[j]
                if cand.start - fund.start > 0.035:
                    break
                interval = cand.pitch - fund.pitch

                # 5th harmonic (Major 3rd + 2 octaves = 28 semitones, e.g. D4 on A#1)
                # Physical string resonance: if weaker than fundamental, it is an acoustic ghost overtone
                if interval == 28 and cand.velocity < fund.velocity * 0.85:
                    pruned_overtones.add(j)
                # 3rd harmonic (Octave + 5th = 19 semitones, e.g. F3 on A#1)
                elif interval == 19 and cand.velocity < fund.velocity * 0.65:
                    pruned_overtones.add(j)
                # 6th harmonic (2 octaves + 5th = 31 semitones)
                elif interval == 31 and cand.velocity < fund.velocity * 0.70:
                    pruned_overtones.add(j)
                # 7th harmonic (34 semitones)
                elif interval == 34 and cand.velocity < fund.velocity * 0.75:
                    pruned_overtones.add(j)
                # Micro duplicate notes on the same pitch starting within 15ms
                elif interval == 0 and cand.start - fund.start < 0.015:
                    pruned_overtones.add(j)

        clean_notes = [gated_notes[i] for i in range(len(gated_notes)) if i not in pruned_overtones]

        # 4. Per-Pitch Monophonic Clamp
        clean_notes.sort(key=lambda x: (x.pitch, x.start))
        de_overlapped = []
        for n in clean_notes:
            if not de_overlapped:
                de_overlapped.append(n)
                continue
            prev = de_overlapped[-1]
            if prev.pitch == n.pitch and n.start < prev.end:
                prev.end = max(prev.start + 0.025, n.start - 0.005)
            de_overlapped.append(n)

        de_overlapped.sort(key=lambda x: x.start)
        inst.notes = de_overlapped

def remap_musical_velocities(midi_data, min_target=52, max_target=118):
    """
    Expands the dynamic range so piano notes ring out with rich presence and acoustic warmth
    instead of sounding quiet, weak, and muffled in standard Web Audio or DAW synthesizers.
    """
    for inst in midi_data.instruments:
        if inst.is_drum or not inst.notes:
            continue
        vels = [n.velocity for n in inst.notes]
        v_min = min(vels)
        v_max = max(vels)
        if v_max <= v_min:
            continue
        for n in inst.notes:
            norm = (n.velocity - v_min) / (v_max - v_min)
            expanded = norm ** 0.82
            n.velocity = int(round(min_target + expanded * (max_target - min_target)))
            n.velocity = max(1, min(127, n.velocity))

def extend_short_notes(midi_data, bpm=120.0, min_dur_ms=60):
    """
    Gently rounds off unnatural micro-ticks (under 60ms) while respecting
    the tempo grid so rapid 16th/32nd notes or staccatos don't get smeared or collide.
    """
    beat_dur = 60.0 / max(40.0, bpm)
    # Maximum natural duration threshold based on tempo (at most 16th-note or min_dur_ms)
    min_natural_dur = min(min_dur_ms / 1000.0, beat_dur * 0.25)

    for inst in midi_data.instruments:
        if inst.is_drum:
            continue
        notes = inst.notes
        notes.sort(key=lambda x: (x.start, x.pitch))
        for i in range(len(notes)):
            curr = notes[i]
            dur = curr.end - curr.start
            if dur < min_natural_dur:
                # Prevent collision with next note on the same key
                next_same = next((n for n in notes[i+1:min(i+35, len(notes))] if n.pitch == curr.pitch), None)
                if next_same:
                    max_end = next_same.start - 0.008
                else:
                    max_end = curr.start + min_natural_dur
                target_end = min(curr.start + min_natural_dur, max_end)
                if target_end > curr.end:
                    curr.end = target_end

def quantize_midi_to_key(midi_data, root, mode, is_monophonic=False):
    """
    Prunes micro-noise while safely preserving musical passing tones,
    chromatic notes, modulations, and chord extensions.
    CRITICAL: NEVER drops musical notes during monophonic voice leading!
    """
    root_pitch = PITCH_CLASSES.get(root)
    if root_pitch is None or mode not in SCALE_INTERVALS:
        return 0, 0

    total_notes = 0
    pruned_count = 0

    for inst in midi_data.instruments:
        if inst.is_drum:
            continue

        cleaned_notes = []
        for n in inst.notes:
            total_notes += 1
            dur = n.end - n.start

            # Only prune microscopic zero-energy noise clicks (under 25ms with velocity < 20)
            if dur < 0.025 and n.velocity < 20:
                pruned_count += 1
                continue

            cleaned_notes.append(n)

        # Monophonic post-filter if requested (for solo vocal/bass lead)
        if is_monophonic and len(cleaned_notes) > 1:
            cleaned_notes.sort(key=lambda x: x.start)
            mono_notes = []
            prev = None
            for curr in cleaned_notes:
                if prev is None:
                    mono_notes.append(curr)
                    prev = curr
                else:
                    if curr.start < prev.end:
                        # Smoothly clamp previous note tail, NEVER drop the incoming note!
                        prev.end = max(prev.start + 0.02, curr.start - 0.004)
                    mono_notes.append(curr)
                    prev = curr
            inst.notes = mono_notes
        else:
            inst.notes = cleaned_notes

    return total_notes, pruned_count

def quantize_notes_to_grid(midi_data, bpm, first_beat=0.0, grid="adaptive", strength=0.85):
    """
    Rhythmically aligns note onsets and lengths to a musical beat grid:
    - Adaptive: intelligently chooses between straight 16th and triplet (1/12) per note.
    - Preserves musical groove while eliminating floating-point neural net jitter.
    - Prevents note collisions on the same pitch key.
    """
    if not grid or grid.lower() == "off" or strength <= 0.001 or bpm <= 0:
        return

    strength = max(0.0, min(1.0, float(strength)))
    beat_sec = 60.0 / bpm
    grid_mode = grid.lower()

    if grid_mode == "1/8":
        step_sec = beat_sec / 2.0
    elif grid_mode == "1/4":
        step_sec = beat_sec
    elif grid_mode == "1/12":
        step_sec = beat_sec / 3.0  # 8th note triplet
    elif grid_mode == "1/32":
        step_sec = beat_sec / 8.0
    else:  # "1/16" or "adaptive"
        step_sec = beat_sec / 4.0

    step_16th = beat_sec / 4.0
    step_triplet = beat_sec / 3.0

    for inst in midi_data.instruments:
        if inst.is_drum:
            continue

        notes = inst.notes
        if not notes:
            continue

        for n in notes:
            dur = n.end - n.start

            # Calculate target onset
            if grid_mode == "adaptive":
                idx_16 = round((n.start - first_beat) / step_16th)
                t_16 = first_beat + idx_16 * step_16th
                dist_16 = abs(n.start - t_16)

                idx_trip = round((n.start - first_beat) / step_triplet)
                t_trip = first_beat + idx_trip * step_triplet
                dist_trip = abs(n.start - t_trip)

                target_start = t_trip if dist_trip < dist_16 * 0.72 else t_16
            else:
                idx = round((n.start - first_beat) / step_sec)
                target_start = first_beat + idx * step_sec

            # Interpolate based on strength
            new_start = n.start + strength * (target_start - n.start)
            new_start = max(0.0, new_start)

            # Quantize duration to clean musical increments
            min_dur = max(0.045, step_sec * 0.45)
            target_dur = max(min_dur, round(dur / step_sec) * step_sec)
            new_dur = dur + (strength * 0.75) * (target_dur - dur)
            new_dur = max(0.04, new_dur)

            n.start = new_start
            n.end = new_start + new_dur

        # Ensure sorted and resolve any overlaps on the same pitch
        notes.sort(key=lambda x: (x.start, x.pitch))
        for i in range(len(notes) - 1):
            curr = notes[i]
            for j in range(i + 1, min(i + 20, len(notes))):
                nxt = notes[j]
                if nxt.pitch == curr.pitch:
                    if curr.end > nxt.start - 0.005:
                        curr.end = max(curr.start + 0.03, nxt.start - 0.008)
                    break

def convert_with_basic_pitch(audio_path, output_midi_path, preset="general", key_arg=None, explicit_bpm=None, sensitivity="balanced", quantize_grid="adaptive", quantize_strength=0.85):
    from basic_pitch.inference import predict
    import pretty_midi

    preset_lower = (preset or "general").lower()
    is_piano = preset_lower in ["piano", "keyboard"]
    is_vocal = preset_lower in ["vocal", "lead"]
    is_bass = preset_lower in ["bass", "808"]
    is_fast = preset_lower in ["fast", "arp", "staccato"]

    # 1. Dynamic Tempo & Beat Phase Detection (Direct from audio signal with companion transient support)
    bpm, first_beat = detect_audio_bpm_and_phase(audio_path, explicit_bpm=explicit_bpm)

    # 2. Detection Sensitivity calibration
    sensitivity_lower = (sensitivity or "balanced").lower()
    if sensitivity_lower in ["high", "sensitive", "detailed"]:
        # Maximum Recall: Catches faint verses, soft vocals, quiet chords & subtle notes
        onset_sens = 0.32
        frame_sens = 0.18
        min_len = 20
    elif sensitivity_lower in ["clean", "strict", "low"]:
        # Strict: Focuses on strong, prominent notes and ignores quiet artifacts
        onset_sens = 0.50
        frame_sens = 0.30
        min_len = 45
    else:  # "balanced" (Default)
        # Optimized for modern songs with verse/chorus dynamic contrast
        onset_sens = 0.38
        frame_sens = 0.22
        min_len = 30

    # 3. Full-Spectrum frequency coverage (C1 to B7 / C8)
    C1_A0_FREQ = 27.5    # Covers down to C1 (32.7 Hz) and sub-bass A0
    B7_C8_FREQ = 4186.0  # Covers up to B7 (3951 Hz) and C8

    if is_piano:
        # Acoustic piano has high dynamic resonance, hammer transients & damper sustain.
        # Calibrate onset & frame thresholds to capture deliberate key strikes while suppressing pedal noise.
        onset_thresh = max(0.35, onset_sens + 0.08)
        frame_thresh = max(0.22, frame_sens + 0.05)
        min_note_len = max(min_len, 35)
        min_freq = C1_A0_FREQ
        max_freq = B7_C8_FREQ
    elif is_vocal:
        onset_thresh = onset_sens
        frame_thresh = frame_sens
        min_note_len = min_len
        min_freq = C1_A0_FREQ
        max_freq = B7_C8_FREQ
    elif is_bass:
        onset_thresh = onset_sens
        frame_thresh = frame_sens
        min_note_len = max(min_len, 35)
        min_freq = C1_A0_FREQ
        max_freq = 1500.0   # Widen to 1.5kHz to preserve slap harmonics and mid-range bass notes
    elif is_fast:
        onset_thresh = max(0.24, onset_sens - 0.04)
        frame_thresh = max(0.15, frame_sens - 0.03)
        min_note_len = 20
        min_freq = C1_A0_FREQ
        max_freq = B7_C8_FREQ
    else:  # "general" / "polyphonic" (Full spectrum C1 to B7 / 88 keys, default)
        onset_thresh = onset_sens
        frame_thresh = frame_sens
        min_note_len = min_len
        min_freq = C1_A0_FREQ
        max_freq = B7_C8_FREQ

    # 4. Audio Pre-Normalization (Boosts quiet stems to full reference scale for maximum recall)
    active_audio_path, is_temp_norm = prepare_normalized_audio(audio_path)

    try:
        # Run Spotify's Basic Pitch Multi-Pitch Neural Net with true BPM
        model_output, midi_data, note_events = predict(
            active_audio_path,
            onset_threshold=onset_thresh,
            frame_threshold=frame_thresh,
            minimum_note_length=min_note_len,
            minimum_frequency=min_freq,
            maximum_frequency=max_freq,
            midi_tempo=bpm,
        )
    finally:
        if is_temp_norm and os.path.exists(active_audio_path):
            try:
                os.remove(active_audio_path)
            except Exception:
                pass

    # Post-processing:
    # Merge micro-gaps without eating staccato hits
    merge_sustained_notes(midi_data, max_gap=0.035)

    if is_piano:
        filter_piano_noise(midi_data)
        extend_short_notes(midi_data, bpm=bpm, min_dur_ms=70)
    elif not is_fast:
        extend_short_notes(midi_data, bpm=bpm, min_dur_ms=55)

    # Apply Musical Beat-Grid Quantization (Snaps floating point neural net onsets to musical time)
    quantize_notes_to_grid(midi_data, bpm=bpm, first_beat=first_beat, grid=quantize_grid, strength=quantize_strength)

    # Remap dynamic velocities for rich presence and acoustic warmth
    remap_musical_velocities(midi_data)

    # For piano, separate into Treble Clef (Right Hand Melody/Harmony) and Bass Clef (Left Hand Accompaniment)
    if is_piano and len(midi_data.instruments) == 1:
        orig_inst = midi_data.instruments[0]
        treble_notes = [n for n in orig_inst.notes if n.pitch >= 60]
        bass_notes = [n for n in orig_inst.notes if n.pitch < 60]
        if treble_notes and bass_notes:
            treble_inst = pretty_midi.Instrument(program=0, name="Piano (Right Hand / Treble)")
            bass_inst = pretty_midi.Instrument(program=0, name="Piano (Left Hand / Bass)")
            treble_inst.notes = treble_notes
            bass_inst.notes = bass_notes
            midi_data.instruments = [treble_inst, bass_inst]

    # Detect musical key (from explicit argument, filename, or note distribution)
    root, mode = extract_key_from_string(key_arg)
    if not root:
        root, mode = extract_key_from_string(audio_path)
    if not root:
        root, mode = estimate_key_from_midi(midi_data)

    key_applied = None
    if root and mode:
        # Keep polyphonic by default so harmonies and backing vocals are never discarded!
        quantize_midi_to_key(midi_data, root, mode, is_monophonic=False)
        key_applied = f"{root} {mode.capitalize()}"

    # Ensure initial tempo is written into MIDI file
    if len(midi_data.instruments) > 0:
        midi_data.initial_tempo = bpm

    midi_data.write(output_midi_path)

    note_count = sum(len(inst.notes) for inst in midi_data.instruments)
    duration = midi_data.get_end_time()

    return {
        "status": "success",
        "engine": "Spotify Basic Pitch",
        "midi_path": output_midi_path,
        "note_count": note_count,
        "duration": round(duration, 2),
        "bpm": round(bpm, 1),
        "first_beat": round(first_beat, 3),
        "quantize_grid": quantize_grid,
        "detected_key": key_applied,
        "file_size": os.path.getsize(output_midi_path)
    }

def convert_with_onset_fallback(audio_path, output_midi_path, key_arg=None, explicit_bpm=None, quantize_grid="adaptive", quantize_strength=0.85):
    import librosa
    import pretty_midi
    import numpy as np

    bpm, first_beat = detect_audio_bpm_and_phase(audio_path, explicit_bpm=explicit_bpm)

    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    fmin = float(librosa.note_to_hz('C1'))  # 32.7 Hz (C1)
    fmax = float(librosa.note_to_hz('C8'))  # 4186.0 Hz (covers B7 at 3951 Hz)
    f0, voiced_flag, voiced_probs = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr)

    times = librosa.times_like(f0, sr=sr)
    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    inst = pretty_midi.Instrument(program=0, name="Transcribed Melody")

    current_note = None
    start_time = 0.0

    for i, (freq, voiced) in enumerate(zip(f0, voiced_flag)):
        t = times[i]
        if voiced and not np.isnan(freq) and freq > 0:
            midi_num = int(round(librosa.hz_to_midi(freq)))
            if 0 <= midi_num <= 127:
                if current_note is None:
                    current_note = midi_num
                    start_time = t
                elif current_note != midi_num:
                    if t - start_time >= 0.035:
                        inst.notes.append(pretty_midi.Note(
                            velocity=95,
                            pitch=current_note,
                            start=start_time,
                            end=t
                        ))
                    current_note = midi_num
                    start_time = t
        else:
            if current_note is not None:
                if t - start_time >= 0.035:
                    inst.notes.append(pretty_midi.Note(
                        velocity=95,
                        pitch=current_note,
                        start=start_time,
                        end=t
                    ))
                current_note = None

    if current_note is not None and len(times) > 0:
        inst.notes.append(pretty_midi.Note(
            velocity=95,
            pitch=current_note,
            start=start_time,
            end=times[-1]
        ))

    # Apply Key Quantization if key is present
    root, mode = extract_key_from_string(key_arg)
    if not root:
        root, mode = extract_key_from_string(audio_path)

    key_applied = None
    if root and mode:
        quantize_midi_to_key(pm, root, mode, is_monophonic=False)
        key_applied = f"{root} {mode.capitalize()}"

    pm.instruments.append(inst)

    # Apply Musical Beat-Grid Quantization
    quantize_notes_to_grid(pm, bpm=bpm, first_beat=first_beat, grid=quantize_grid, strength=quantize_strength)

    pm.write(output_midi_path)

    return {
        "status": "success",
        "engine": "Onset-to-MIDI (Monophonic Lead)",
        "midi_path": output_midi_path,
        "note_count": len(inst.notes),
        "duration": round(pm.get_end_time(), 2),
        "bpm": round(bpm, 1),
        "first_beat": round(first_beat, 3),
        "quantize_grid": quantize_grid,
        "detected_key": key_applied,
        "file_size": os.path.getsize(output_midi_path)
    }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No input audio file path provided."}))
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(json.dumps({"status": "error", "message": f"File does not exist: {audio_path}"}))
        sys.exit(1)

    if len(sys.argv) >= 3 and sys.argv[2]:
        output_midi_path = sys.argv[2]
    else:
        base_name, _ = os.path.splitext(audio_path)
        output_midi_path = f"{base_name}.mid"

    out_dir = os.path.dirname(output_midi_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    engine_choice = sys.argv[3].lower() if len(sys.argv) >= 4 and sys.argv[3] else "basic-pitch"
    preset_or_key = sys.argv[4] if len(sys.argv) >= 5 else None
    explicit_bpm = None
    if len(sys.argv) >= 6 and sys.argv[5]:
        try:
            explicit_bpm = float(sys.argv[5])
        except (ValueError, TypeError):
            pass

    sensitivity = sys.argv[6].lower() if len(sys.argv) >= 7 and sys.argv[6] else "balanced"
    quantize_grid = sys.argv[7].lower() if len(sys.argv) >= 8 and sys.argv[7] else "adaptive"
    quantize_strength = 0.85
    if len(sys.argv) >= 9 and sys.argv[8]:
        try:
            quantize_strength = float(sys.argv[8])
        except (ValueError, TypeError):
            pass

    # Determine preset vs explicit key
    preset = "general"
    key_arg = None
    if preset_or_key:
        if preset_or_key.lower() in ["general", "piano", "vocal", "lead", "bass", "808", "fast"]:
            preset = preset_or_key.lower()
        else:
            key_arg = preset_or_key

    if engine_choice == "onset":
        try:
            result = convert_with_onset_fallback(audio_path, output_midi_path, key_arg=key_arg, explicit_bpm=explicit_bpm, quantize_grid=quantize_grid, quantize_strength=quantize_strength)
            print(json.dumps(result))
            return
        except Exception as fb_err:
            print(json.dumps({
                "status": "error",
                "message": f"Onset-to-MIDI error: {str(fb_err)}"
            }))
            sys.exit(1)
    else:
        # Default: Try Spotify's Basic Pitch, fallback only with clear reason
        try:
            result = convert_with_basic_pitch(audio_path, output_midi_path, preset=preset, key_arg=key_arg, explicit_bpm=explicit_bpm, sensitivity=sensitivity, quantize_grid=quantize_grid, quantize_strength=quantize_strength)
            print(json.dumps(result))
            return
        except Exception as bp_err:
            try:
                result = convert_with_onset_fallback(audio_path, output_midi_path, key_arg=key_arg, explicit_bpm=explicit_bpm, quantize_grid=quantize_grid, quantize_strength=quantize_strength)
                result["fallback_reason"] = f"Basic Pitch error: {str(bp_err)}"
                print(json.dumps(result))
                return
            except Exception as fb_err:
                print(json.dumps({
                    "status": "error",
                    "message": f"Basic Pitch error: {str(bp_err)}; Fallback error: {str(fb_err)}"
                }))
                sys.exit(1)

if __name__ == "__main__":
    main()
