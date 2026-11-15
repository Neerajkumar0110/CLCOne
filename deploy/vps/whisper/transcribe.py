#!/usr/bin/env python3
"""Class recording -> timed transcript (LMS, phase 1: recorded videos).

Called by backend/src/services/lms/transcriber.js, one file at a time, at
low priority (nice 19) in the night window. Reads any media file ffmpeg/PyAV
can decode (BBB webcams.webm, our uploaded .mp4), so times are seconds of
THAT file — the same timeline the player shows. That is what makes the
transcript line up point-to-point with the video.

Install (VPS):  python3 -m venv /opt/whisper/venv
                /opt/whisper/venv/bin/pip install faster-whisper
Usage:  transcribe.py <media> <out.json> [--model small] [--threads 3]
                      [--language en] [--prompt "..."]

stdout: one JSON line per progress tick {"progress": <sec>, "duration": <sec>}
out.json: {"model","language","duration","segments":[{"s":ms,"e":ms,"t":text}]}
Exit code 0 = ok; anything else = failed (stderr has the reason).
"""
import argparse
import json
import os
import sys
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("media")
    ap.add_argument("out")
    ap.add_argument("--model", default="small")
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--language", default=None)
    ap.add_argument("--prompt", default=None)
    ap.add_argument("--beam", type=int, default=1)
    ap.add_argument("--models-dir", default="/opt/whisper/models")
    a = ap.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=a.threads, download_root=a.models_dir)
    segments, info = model.transcribe(
        a.media,
        language=a.language or None,
        beam_size=a.beam,
        vad_filter=True,  # skip silence — faster, and no made-up text in long pauses
        vad_parameters={"min_silence_duration_ms": 700},
        condition_on_previous_text=False,  # stops the "same line repeated" loop on long audio
        initial_prompt=a.prompt or None,
    )

    out = []
    last_tick = 0.0
    for s in segments:
        text = (s.text or "").strip()
        if text:
            out.append({"s": int(round(s.start * 1000)), "e": int(round(s.end * 1000)), "t": text})
        now = time.time()
        if now - last_tick > 5:
            print(json.dumps({"progress": round(s.end, 1), "duration": round(info.duration, 1)}), flush=True)
            last_tick = now

    tmp = a.out + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(
            {"model": a.model, "language": info.language, "languageProbability": round(info.language_probability, 3),
             "duration": round(info.duration, 1), "segments": out},
            f, ensure_ascii=False,
        )
    os.replace(tmp, a.out)
    print(json.dumps({"progress": round(info.duration, 1), "duration": round(info.duration, 1), "done": True}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"transcribe failed: {e}", file=sys.stderr)
        sys.exit(2)
