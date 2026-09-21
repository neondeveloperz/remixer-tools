import sys
import os
import io
import re
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

# High-Precision Key Profiles (Temperley CBMS + Sha'ath KeyFinder)
TEMP_MAJ = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0]
TEMP_MIN = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0]
SHA_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
SHA_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def estimate_key_from_midi(midi_data, min_correlation=0.50):
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

def merge_sustained_notes(midi_data, max_gap=0.075):
    """
    Merges fragmented consecutive notes of the same pitch that were split
    by frame threshold fluctuations during sustained chords/pedal phrases (ลากโน้ต).
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
                # If gap is small (<= 75ms) or slightly overlapping, and not a massive velocity jump
                if -0.04 <= gap <= max_gap and n.velocity <= curr.velocity * 1.35:
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
    Dedicated Acoustic Piano Noise Purge Pipeline:
    1. 88-Key Range Boundary: Limits notes to A0 (MIDI 21) to C8 (MIDI 108).
    2. Dynamic Noise Floor: Drops faint background noise (velocity < 38) or short clicks (velocity < 46 and dur < 80ms).
    3. Acoustic Harmonic Overtone Suppressor: Drops strictly simultaneous phantom harmonics (+12, +19, +24 semitones within 25ms, velocity < 52% of fundamental) without deleting real alternating notes or chord voicing.
    4. Per-Pitch Monophonic Clamp: Clamps previous note end if the same key is struck again.
    """
    for inst in midi_data.instruments:
        if inst.is_drum:
            continue

        # 1. 88-key Piano Range Guard
        in_range_notes = [n for n in inst.notes if 21 <= n.pitch <= 108]

        # 2. Dynamic Noise Floor
        gated_notes = []
        for n in in_range_notes:
            dur = n.end - n.start
            if n.velocity < 38 or (n.velocity < 46 and dur < 0.08):
                continue
            gated_notes.append(n)

        # 3. Acoustic Harmonic Overtone Suppressor (strictly simultaneous & weaker)
        gated_notes.sort(key=lambda x: (x.start, -x.pitch))
        clean_notes = []
        for i, n in enumerate(gated_notes):
            is_noise = False
            for other in gated_notes[max(0, i - 18):min(len(gated_notes), i + 18)]:
                if other is n:
                    continue
                time_diff = abs(n.start - other.start)
                if time_diff <= 0.025:
                    interval = n.pitch - other.pitch
                    # Deep bass/mid fundamental, overtone at +12, +19, +24
                    if other.pitch <= 65 and interval in (12, 19, 24):
                        if n.velocity < (other.velocity * 0.52):
                            is_noise = True
                            break
            if not is_noise:
                clean_notes.append(n)

        # 4. Per-Pitch Monophonic Clamp (Physical Piano Key constraint)
        clean_notes.sort(key=lambda x: (x.pitch, x.start))
        de_overlapped = []
        for n in clean_notes:
            if not de_overlapped:
                de_overlapped.append(n)
                continue
            prev = de_overlapped[-1]
            if prev.pitch == n.pitch and n.start < prev.end:
                prev.end = max(prev.start + 0.04, n.start - 0.01)
            de_overlapped.append(n)

        de_overlapped.sort(key=lambda x: x.start)
        inst.notes = de_overlapped

def extend_short_piano_notes(midi_data, min_natural_dur=0.22):
    """
    Extends unnaturally clipped short notes (< 220ms) to a natural acoustic singing duration,
    preventing staccato truncation while respecting subsequent strikes of the same key.
    """
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
                    max_end = next_same.start - 0.015
                else:
                    max_end = curr.start + min_natural_dur
                target_end = min(curr.start + min_natural_dur, max_end)
                if target_end > curr.end:
                    curr.end = target_end

def quantize_midi_to_key(midi_data, root, mode, is_monophonic=False):
    """
    Prunes out-of-scale transient ghost noise without altering the pitch of
    legitimate chords, passing tones, or modulations.
    """
    root_pitch = PITCH_CLASSES.get(root)
    if root_pitch is None or mode not in SCALE_INTERVALS:
        return 0, 0

    allowed = {(root_pitch + interval) % 12 for interval in SCALE_INTERVALS[mode]}
    # Include parallel modal degrees (common in J-Pop, anime, and modern pop modulations)
    if mode == "major":
        allowed.update({(root_pitch + 3) % 12, (root_pitch + 8) % 12})
    elif mode == "minor":
        allowed.add((root_pitch + 11) % 12)

    total_notes = 0
    pruned_count = 0

    for inst in midi_data.instruments:
        if inst.is_drum:
            continue

        cleaned_notes = []
        for n in inst.notes:
            total_notes += 1
            dur = n.end - n.start
            pc = n.pitch % 12

            if pc not in allowed:
                # Out-of-key note: If it's a weak transient (< 90ms or low velocity), prune as noise
                if dur < 0.090 or n.velocity < 46:
                    pruned_count += 1
                    continue
                # Melodic/chord notes outside naive scale are PRESERVED (no forced pitch shifting!)
            else:
                # In-key note: Filter out sub-40ms micro artifacts
                if dur < 0.04 and n.velocity < 35:
                    pruned_count += 1
                    continue

            cleaned_notes.append(n)

        # Monophonic post-filter if requested (for vocals/bass)
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
                        if curr.velocity > prev.velocity * 1.1:
                            prev.end = max(prev.start + 0.05, curr.start)
                            mono_notes.append(curr)
                            prev = curr
                    else:
                        mono_notes.append(curr)
                        prev = curr
            inst.notes = mono_notes
        else:
            inst.notes = cleaned_notes

    return total_notes, pruned_count

def convert_with_basic_pitch(audio_path, output_midi_path, preset="piano", key_arg=None):
    from basic_pitch.inference import predict
    
    preset_lower = (preset or "piano").lower()
    is_piano = preset_lower in ["piano", "keyboard"] or "piano" in audio_path.lower()

    bpm_match = re.search(r'(\d+)\s*BPM', audio_path, re.IGNORECASE)
    bpm = float(bpm_match.group(1)) if bpm_match else 120.0

    if is_piano:
        # Sensitive thresholds to capture soft vocal singing lines in the piano right hand
        onset_thresh = 0.48
        frame_thresh = 0.28
        min_note_len = 50
        min_freq = None
        max_freq = None
    elif preset_lower in ["vocal", "lead"]:
        onset_thresh = 0.62
        frame_thresh = 0.42
        min_note_len = 70
        min_freq = 90
        max_freq = 2200
    elif preset_lower in ["bass", "808"]:
        onset_thresh = 0.60
        frame_thresh = 0.38
        min_note_len = 75
        min_freq = 28
        max_freq = 450
    else:
        onset_thresh = 0.55
        frame_thresh = 0.35
        min_note_len = 65
        min_freq = None
        max_freq = None

    # Run Spotify's Basic Pitch Multi-Pitch Neural Net
    model_output, midi_data, note_events = predict(
        audio_path,
        onset_threshold=onset_thresh,
        frame_threshold=frame_thresh,
        minimum_note_length=min_note_len,
        minimum_frequency=min_freq,
        maximum_frequency=max_freq,
        midi_tempo=bpm,
    )

    # If piano, separate into Right Hand (Vocal Melody) & Left Hand (Accompaniment / Chords)
    if is_piano and len(midi_data.instruments) > 0:
        import pretty_midi
        raw_inst = midi_data.instruments[0]
        raw_notes = [n for n in raw_inst.notes if 21 <= n.pitch <= 108]
        raw_notes.sort(key=lambda x: (x.start, -x.pitch))

        pm_multi = pretty_midi.PrettyMIDI(initial_tempo=bpm)
        t_melody = pretty_midi.Instrument(program=0, name="Right Hand (Vocal Melody)")
        t_accomp = pretty_midi.Instrument(program=0, name="Left Hand (Chords & Bass)")

        for n in raw_notes:
            if n.pitch >= 60:
                # Vocal singing register: boost velocity so melody cuts through clearly
                n.velocity = min(120, int(n.velocity * 1.25) + 8)
                t_melody.notes.append(n)
            else:
                # Accompaniment & bass: soften velocity to prevent drowning the vocal melody
                n.velocity = max(35, int(n.velocity * 0.88))
                t_accomp.notes.append(n)

        pm_multi.instruments.append(t_melody)
        pm_multi.instruments.append(t_accomp)
        midi_data = pm_multi

        # Apply Smart Sustain Merger, dedicated Noise Purge, and Natural Duration Extension
        merge_sustained_notes(midi_data, max_gap=0.085)
        filter_piano_noise(midi_data)
        extend_short_piano_notes(midi_data, min_natural_dur=0.22)

    # Detect musical key (from explicit argument, filename, or note distribution)
    root, mode = extract_key_from_string(key_arg)
    if not root:
        root, mode = extract_key_from_string(audio_path)
    if not root:
        root, mode = estimate_key_from_midi(midi_data)

    key_applied = None
    if root and mode:
        is_mono = preset_lower in ["vocal", "lead", "bass"]
        quantize_midi_to_key(midi_data, root, mode, is_monophonic=is_mono)
        key_applied = f"{root} {mode.capitalize()}"

    midi_data.write(output_midi_path)

    note_count = sum(len(inst.notes) for inst in midi_data.instruments)
    duration = midi_data.get_end_time()

    return {
        "status": "success",
        "engine": "Spotify Basic Pitch",
        "midi_path": output_midi_path,
        "note_count": note_count,
        "duration": round(duration, 2),
        "detected_key": key_applied,
        "file_size": os.path.getsize(output_midi_path)
    }

def convert_with_onset_fallback(audio_path, output_midi_path, key_arg=None):
    import librosa
    import pretty_midi
    import numpy as np

    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    fmin = float(librosa.note_to_hz('C2'))
    fmax = float(librosa.note_to_hz('C7'))
    f0, voiced_flag, voiced_probs = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr)

    times = librosa.times_like(f0, sr=sr)
    pm = pretty_midi.PrettyMIDI()
    inst = pretty_midi.Instrument(program=0)

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
                    if t - start_time >= 0.06:
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
                if t - start_time >= 0.06:
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
        quantize_midi_to_key(pm, root, mode, is_monophonic=True)
        key_applied = f"{root} {mode.capitalize()}"

    pm.instruments.append(inst)
    pm.write(output_midi_path)

    return {
        "status": "success",
        "engine": "Onset-to-MIDI (Monophonic Lead)",
        "midi_path": output_midi_path,
        "note_count": len(inst.notes),
        "duration": round(pm.get_end_time(), 2),
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

    # Determine preset vs explicit key
    preset = "piano"
    key_arg = None
    if preset_or_key:
        if preset_or_key.lower() in ["general", "piano", "vocal", "bass", "fast"]:
            preset = preset_or_key.lower()
        else:
            key_arg = preset_or_key

    if engine_choice == "onset":
        try:
            result = convert_with_onset_fallback(audio_path, output_midi_path, key_arg=key_arg)
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
            result = convert_with_basic_pitch(audio_path, output_midi_path, preset=preset, key_arg=key_arg)
            print(json.dumps(result))
            return
        except Exception as bp_err:
            try:
                result = convert_with_onset_fallback(audio_path, output_midi_path, key_arg=key_arg)
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
