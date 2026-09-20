import sys
import os
import json
import warnings
import logging

# Suppress standard non-critical warnings and root logs
warnings.filterwarnings("ignore")
logging.getLogger().setLevel(logging.ERROR)

# Ensure ffmpeg in PATH for audio decoding
app_data = os.environ.get("LOCALAPPDATA", "")
if app_data:
    ffmpeg_dir = os.path.join(app_data, "com.armzi.remixer-tools")
    if os.path.exists(ffmpeg_dir):
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

def convert_with_basic_pitch(audio_path, output_midi_path):
    from basic_pitch.inference import predict
    
    # Run Spotify's Basic Pitch
    model_output, midi_data, note_events = predict(
        audio_path,
        onset_threshold=0.5,
        frame_threshold=0.3,
        minimum_note_length=58,
        minimum_frequency=None,
        maximum_frequency=None,
    )
    
    midi_data.write(output_midi_path)
    
    note_count = sum(len(inst.notes) for inst in midi_data.instruments)
    duration = midi_data.get_end_time()
    
    return {
        "status": "success",
        "engine": "Spotify Basic Pitch",
        "midi_path": output_midi_path,
        "note_count": note_count,
        "duration": round(duration, 2),
        "file_size": os.path.getsize(output_midi_path)
    }

def convert_with_onset_fallback(audio_path, output_midi_path):
    import librosa
    import pretty_midi
    import numpy as np

    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    fmin = librosa.note_to_hz('C2')
    fmax = librosa.note_to_hz('C7')
    f0, voiced_flag, voiced_probs = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr)

    times = librosa.times_like(f0, sr=sr)
    pm = pretty_midi.PrettyMIDI()
    inst = pretty_midi.Instrument(program=0) # Acoustic Grand Piano

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
                    if t - start_time >= 0.05:
                        note = pretty_midi.Note(
                            velocity=100,
                            pitch=current_note,
                            start=start_time,
                            end=t
                        )
                        inst.notes.append(note)
                    current_note = midi_num
                    start_time = t
        else:
            if current_note is not None:
                if t - start_time >= 0.05:
                    note = pretty_midi.Note(
                        velocity=100,
                        pitch=current_note,
                        start=start_time,
                        end=t
                    )
                    inst.notes.append(note)
                current_note = None

    if current_note is not None and len(times) > 0:
        inst.notes.append(
            pretty_midi.Note(
                velocity=100,
                pitch=current_note,
                start=start_time,
                end=times[-1]
            )
        )

    pm.instruments.append(inst)
    pm.write(output_midi_path)

    note_count = len(inst.notes)
    duration = pm.get_end_time()

    return {
        "status": "success",
        "engine": "Onset-to-MIDI (Fallback)",
        "midi_path": output_midi_path,
        "note_count": note_count,
        "duration": round(duration, 2),
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

    # 1. Try Spotify's Basic Pitch
    try:
        result = convert_with_basic_pitch(audio_path, output_midi_path)
        print(json.dumps(result))
        return
    except Exception as bp_err:
        # 2. Fallback to Onset-to-MIDI
        try:
            result = convert_with_onset_fallback(audio_path, output_midi_path)
            result["fallback_reason"] = str(bp_err)
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
