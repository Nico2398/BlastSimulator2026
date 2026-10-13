#!/usr/bin/env python3
"""Rebuild public/audio/sfx/*.mp3 from assets/audio/recipe.json.

    python3 assets/audio/build.py --sources <dir> [--out public/audio/sfx] [--only name ...] [--report]
    python3 assets/audio/build.py --credits
    python3 assets/audio/build.py --sources <dir> --verify-upstream <official-dir>
    python3 assets/audio/build.py --selftest

<dir> holds the upstream packs laid out as recipe.json "packs[*].dir" expects.
--verify-upstream closes the licensing gap of the mirror packs: see its --help text.
Pipeline per sound: decode layers to float mono 44.1 kHz -> optional ffmpeg
filter -> slice -> mix -> DC removal -> trim silence -> length cap -> bass body
(only sounds whose energy is stranded below small-speaker cutoff, see
recipe.json "body") -> fades -> loudness normalisation with soft-knee limiter
-> libmp3lame VBR.
Looped beds (an entry with "loop") skip trimming, body and fades: the take is
cross-faded into one seamless period, normalised, then written as that period
with a short continuation on each side (see loop_bed), so any window of one
period inside the file loops without a seam whatever the decoder's MP3 delay.
Kinds may override the loudness target and the MP3 settings.
Only numpy and ffmpeg are needed. Output is deterministic for a given input.
"""
import argparse
import hashlib
import json
import math
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from urllib.parse import urlparse

import numpy as np

SR = 44100
HERE = Path(__file__).resolve().parent


def decode(path, af=None):
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-vn"]
    if af:
        cmd += ["-af", af]
    cmd += ["-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def apply_af(x, chain):
    """Run a float mono signal through an ffmpeg audio filter chain."""
    cmd = ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-af", chain, "-f", "f32le", "-"]
    raw = subprocess.run(cmd, input=x.astype("<f4").tobytes(), check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def apply_af_zero_phase(x, chain):
    """Forward then backward pass: magnitude response squared, no group delay."""
    return apply_af(apply_af(x, chain)[::-1].copy(), chain)[::-1].copy()


def db(x):
    return 20.0 * math.log10(max(x, 1e-12))


def frame_db(x, frame):
    n = len(x) // frame
    if n == 0:
        return np.array([db(float(np.sqrt(np.mean(x**2))) if len(x) else 0.0)])
    f = x[: n * frame].reshape(n, frame)
    return 20.0 * np.log10(np.maximum(np.sqrt(np.mean(f**2, axis=1)), 1e-12))


def gated_rms_db(x, gate_db, extra_gain_db=0.0, frame=882):
    """RMS over 20 ms frames whose level (after extra_gain_db) exceeds gate_db."""
    n = len(x) // frame
    if n == 0:
        return db(float(np.sqrt(np.mean(x**2)))) + extra_gain_db
    f = x[: n * frame].reshape(n, frame)
    ms = np.mean(f**2, axis=1)
    lvl = 10.0 * np.log10(np.maximum(ms, 1e-24)) + extra_gain_db
    keep = lvl > gate_db
    if not keep.any():
        keep = lvl >= lvl.max()
    return 10.0 * math.log10(float(np.mean(ms[keep]))) + extra_gain_db


def soft_limit(x, ceiling_db, knee_db):
    ceil = 10 ** (ceiling_db / 20)
    knee = 10 ** (knee_db / 20)
    a = np.abs(x)
    over = a > knee
    y = x.copy()
    span = ceil - knee
    y[over] = np.sign(x[over]) * (knee + span * np.tanh((a[over] - knee) / span))
    return y


def band_shares(x, rule):
    """Fraction of the 20 Hz - 20 kHz power inside the rule's low and mid bands."""
    n = 1 << (len(x) - 1).bit_length()
    power = np.abs(np.fft.rfft(x, n)) ** 2
    freqs = np.fft.rfftfreq(n, 1 / SR)
    total = power[(freqs >= 20) & (freqs <= 20000)].sum()

    def share(band):
        return float(power[(freqs >= band[0]) & (freqs < band[1])].sum() / max(total, 1e-24))

    return share(rule["low_band_hz"]), share(rule["mid_band_hz"])


def body_applies(x, body):
    """Rule: most energy sits below the small-speaker cutoff and little is left in the band they reproduce."""
    if len(x) < 2:
        return False, 0.0, 0.0
    rule = body["rule"]
    low, mid = band_shares(x, rule)
    return low >= rule["min_low_share"] and mid < rule["max_mid_share"], low, mid


def frame_power(x, n_frames, frame=882):
    return np.mean(x[: n_frames * frame].reshape(n_frames, frame) ** 2, axis=1)


def body_layer(x, body):
    """Psychoacoustic bass body: own low band -> hard saturation -> 180-900 Hz band, mixed at rel_db.

    rel_db is the layer's power against the mix over the 20 ms frames within window_db of the
    loudest one, so the level is independent of the source gain and of the saturation depth.
    """
    chain = body["chain"]
    low = apply_af_zero_phase(x, chain["low"])
    peak = float(np.max(np.abs(low)))
    n_frames = len(x) // 882
    if peak < 1e-9 or n_frames == 0:
        return x
    sat = apply_af(low / peak, f"asoftclip=type=tanh:threshold={chain['drive_threshold']}")
    layer = apply_af_zero_phase(sat, chain["band"])
    ms_mix, ms_layer = frame_power(x, n_frames), frame_power(layer, n_frames)
    keep = ms_mix > ms_mix.max() * 10 ** (-body["window_db"] / 10)
    if float(np.mean(ms_layer[keep])) < 1e-24:
        return x
    return x + layer * math.sqrt(np.mean(ms_mix[keep]) / np.mean(ms_layer[keep])) * 10 ** (body["rel_db"] / 20)


def trim_silence(x, thresh_db, lead_ms, tail_ms):
    thr = 10 ** (thresh_db / 20)
    idx = np.nonzero(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, int(idx[0]) - int(SR * lead_ms / 1000))
    b = min(len(x), int(idx[-1]) + 1 + int(SR * tail_ms / 1000))
    return x[a:b]


def fade(x, in_ms, out_ms):
    x = x.copy()
    ni = min(len(x), int(SR * in_ms / 1000))
    no = min(len(x), int(SR * out_ms / 1000))
    if ni > 1:
        x[:ni] *= np.sin(np.linspace(0, np.pi / 2, ni)) ** 2
    if no > 1:
        x[-no:] *= np.cos(np.linspace(0, np.pi / 2, no)) ** 2
    return x


def normalise(x, spec, ceiling, target=None):
    target = spec["target_rms_db"] if target is None else target
    gate = spec["gate_db"]
    knee = spec["limiter_knee_db"]
    max_over = spec["max_overshoot_db"]
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    if peak < 1e-9:
        return x, {"gain_db": 0.0, "limited_db": 0.0}
    g = target - gated_rms_db(x, -200)
    for _ in range(12):
        g = target - gated_rms_db(x, gate, g)
    g_cap = ceiling + max_over - db(peak)
    lo, hi = -60.0, min(g, g_cap)
    # Post-limiter RMS is monotone in gain: bisect to land on the target.
    def out_rms(gdb):
        y = soft_limit(x * 10 ** (gdb / 20), ceiling, knee)
        return gated_rms_db(y, gate)
    if out_rms(hi) <= target:
        g = hi
    else:
        for _ in range(30):
            mid = (lo + hi) / 2
            if out_rms(mid) > target:
                hi = mid
            else:
                lo = mid
        g = (lo + hi) / 2
    y = soft_limit(x * 10 ** (g / 20), ceiling, knee)
    return y, {"gain_db": g, "limited_db": db(peak) + g - db(float(np.max(np.abs(y))))}


def encode_mp3(x, dest, mp3):
    pcm = (np.clip(x, -1, 1) * 32767.0).round().astype("<i2").tobytes()
    cmd = [
        "ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
    ]
    if "sample_rate" in mp3:
        cmd += ["-ar", str(mp3["sample_rate"])]
    cmd += ["-c:a", "libmp3lame", "-q:a", str(mp3["vbr_quality"]), "-write_id3v2", "0", str(dest)]
    subprocess.run(cmd, input=pcm, check=True)


def loop_period(x, period_s, crossfade_s):
    """One seamless period: the take's head is cross-faded (equal power) with what follows the period's end."""
    n, c = int(round(period_s * SR)), int(round(crossfade_s * SR))
    if len(x) < n + c:
        raise ValueError(f"loop needs {period_s + crossfade_s:g} s of audio, the layers give {len(x) / SR:.2f} s")
    theta = np.linspace(0, np.pi / 2, c)
    p = x[:n].copy()
    p[:c] = x[:c] * np.sin(theta) + x[n : n + c] * np.cos(theta)
    return p


def loop_bed(p, pad_s):
    """The period with `pad_s` of its own end before it and of its own start after it: periodic over the whole file."""
    pad = int(round(pad_s * SR))
    return np.concatenate([p[len(p) - pad :], p, p[:pad]])


def encode_checked(x_in, spec, kind, dest, wrap=lambda y: y):
    """Normalise, encode, and tighten the ceiling until the decoded file honours it (MP3 coding overshoots sample peaks)."""
    mp3 = {**spec["mp3"], **kind.get("mp3", {})}
    target = kind.get("target_rms_db", spec["target_rms_db"])
    ceiling_db = spec["peak_ceiling_db"]
    for _ in range(4):
        x, info = normalise(x_in, spec, ceiling_db, target)
        encode_mp3(wrap(x), dest, mp3)
        decoded_peak = db(float(np.max(np.abs(decode(dest)))))
        excess = decoded_peak - spec["peak_ceiling_db"]
        if excess <= 0.05:
            break
        ceiling_db -= excess + 0.1
    info["decoded_peak_db"] = decoded_peak
    return info


def build_loop(name, entry, recipe, src, out_dir):
    """A looped bed: no trim, body or fades; normalised as one period, so the file is periodic end to end."""
    spec = recipe["spec"]
    kind = recipe["kinds"][entry["kind"]]
    loop = entry["loop"]
    if loop["period_s"] > kind["max_s"]:
        raise ValueError(f"{name}: loop period {loop['period_s']} exceeds kind cap {kind['max_s']}")
    # A period of whole MP3 frames (1152 samples at the output rate) encodes to identical frames every cycle, so the
    # decoded file stays periodic to the bit; any other period leaves codec noise across the seam.
    out_rate = {**spec["mp3"], **kind.get("mp3", {})}.get("sample_rate", SR)
    frames = loop["period_s"] * out_rate / 1152
    if abs(frames - round(frames)) > 1e-6:
        raise ValueError(f"{name}: loop period {loop['period_s']} s is {frames:.3f} MP3 frames at {out_rate} Hz, not a whole number")
    x = render_layers(entry, src)
    x = x - float(np.mean(x))
    p = loop_period(x, loop["period_s"], loop["crossfade_s"])
    dest = out_dir / f"{name}.mp3"
    info = encode_checked(p, spec, kind, dest, lambda y: loop_bed(y, loop["pad_s"]))
    info["body"] = False
    info["low_share"], info["mid_share"] = band_shares(p, recipe["body"]["rule"])
    return dest, info


class Sources:
    def __init__(self, root, packs):
        self.root = Path(root)
        self.packs = packs
        self.cache = {}

    def load(self, pack, file, af):
        key = (pack, file, af)
        if key not in self.cache:
            p = self.root / self.packs[pack]["dir"] / file
            if not p.is_file():
                raise FileNotFoundError(p)
            self.cache[key] = decode(p, af)
        return self.cache[key]


def render_layers(entry, src):
    n_total = 0
    parts = []
    for ly in entry["layers"]:
        x = src.load(ly["pack"], ly["file"], ly.get("af"))
        a = int(round(ly.get("start", 0.0) * SR))
        b = a + int(round(ly["dur"] * SR)) if "dur" in ly else len(x)
        seg = x[a:b] * 10 ** (ly.get("gain_db", 0.0) / 20)
        if "align_db" in ly:  # start the layer at its first sample above align_db (dBFS, before layer gain)
            first = np.nonzero(np.abs(x[a:b]) > 10 ** (ly["align_db"] / 20))[0]
            seg = seg[max(0, int(first[0]) - int(0.002 * SR)) :] if len(first) else seg
        seg = fade(seg, ly.get("fade_in_ms", 0), ly.get("fade_out_ms", 0))
        at = int(round(ly.get("at", 0.0) * SR))
        parts.append((at, seg))
        n_total = max(n_total, at + len(seg))
    mix = np.zeros(n_total)
    for at, seg in parts:
        mix[at : at + len(seg)] += seg
    return mix


def build_one(name, entry, recipe, src, out_dir):
    if "loop" in entry:
        return build_loop(name, entry, recipe, src, out_dir)
    spec = recipe["spec"]
    kind = recipe["kinds"][entry["kind"]]
    x = render_layers(entry, src)
    x = x - float(np.mean(x))
    x = trim_silence(x, spec["trim_threshold_db"], spec["lead_ms"], spec["tail_ms"])
    max_s = entry.get("max_s", kind["max_s"])
    if max_s > kind["max_s"]:
        raise ValueError(f"{name}: max_s {max_s} exceeds kind cap {kind['max_s']}")
    cap = int(max_s * SR)
    truncated = len(x) > cap
    x = x[:cap]
    applies, low_share, mid_share = body_applies(x, recipe["body"])
    if applies:
        x = body_layer(x, recipe["body"])
    fade_out_ms = entry.get("fade_out_ms", kind["fade_out_ms"])
    x_in = fade(x, spec["fade_in_ms"], fade_out_ms * (2 if truncated and "fade_out_ms" not in entry else 1))
    dest = out_dir / f"{name}.mp3"
    info = encode_checked(x_in, spec, kind, dest)
    info["body"] = applies
    info["low_share"], info["mid_share"] = low_share, mid_share
    return dest, info


def analyse(path):
    x = decode(path)
    spec_ct = np.abs(np.fft.rfft(x * np.hanning(len(x)))) if len(x) else np.zeros(1)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    centroid = float((freqs * spec_ct).sum() / max(spec_ct.sum(), 1e-12))
    return {
        "dur": len(x) / SR,
        "rms": gated_rms_db(x, -50),
        "peak": db(float(np.max(np.abs(x)))) if len(x) else -120.0,
        "centroid": centroid,
        "bytes": Path(path).stat().st_size,
    }


def report(paths):
    print(f"{'name':<20}{'dur_s':>7}{'rms_dB':>8}{'peak_dB':>9}{'centroid_Hz':>13}{'bytes':>8}")
    tot = 0
    for p in paths:
        a = analyse(p)
        tot += a["bytes"]
        print(f"{Path(p).stem:<20}{a['dur']:>7.3f}{a['rms']:>8.1f}{a['peak']:>9.1f}{a['centroid']:>13.0f}{a['bytes']:>8}")
    print(f"total bytes {tot}")


def layer_meta(recipe, ly):
    pack = recipe["packs"][ly["pack"]]
    per = pack.get("files", {}).get(ly["file"], {})
    lic = per.get("license", pack["license"])
    if "psfo" in per:
        who = per["psfo"]
    elif "credit" in per:
        who = per["credit"]
    else:
        who = pack["author"]
    return pack, lic, who, per.get("url", pack["url"])


def describe_layer(ly):
    bits = []
    if "start" in ly or "dur" in ly:
        bits.append(f"slice {ly.get('start', 0):g} s + {ly['dur']:g} s" if "dur" in ly else f"from {ly['start']:g} s")
    if "af" in ly:
        bits.append(f"ffmpeg `{ly['af']}`")
    if ly.get("gain_db"):
        bits.append(f"{ly['gain_db']:+g} dB")
    if ly.get("at"):
        bits.append(f"offset {ly['at']:g} s")
    return ", ".join(bits)


def credits_text(recipe, template):
    rows = ["| File | Source pack | Original file | Author / credit | Licence | Changes |", "|---|---|---|---|---|---|"]
    ccby = {}
    for name, entry in sorted(recipe["sounds"].items()):
        for i, ly in enumerate(entry["layers"]):
            pack, lic, who, url = layer_meta(recipe, ly)
            if lic == "CC-BY-3.0":
                ccby[ly["file"]] = pack["files"][ly["file"]]["psfo"]
            changes = [describe_layer(ly) or "none"]
            if i == 0 and "max_s" in entry:
                changes.append(f"whole sound cut to {entry['max_s']:g} s")
            if i == 0 and "loop" in entry:
                changes.append(f"looped: {entry['loop']['period_s']:g} s period, {entry['loop']['crossfade_s']:g} s cross-fade")
            first = f"`{name}.mp3`" if i == 0 else ""
            src = f"[`{ly['file']}`]({url})" if url != pack["url"] else f"`{ly['file']}`"
            cells = [first, f"[{pack['title']}]({pack['url']})", src, who.replace("|", "/"), lic, ", ".join(changes)]
            rows.append("| " + " | ".join(cells) + " |")
    ccby_lines = "\n".join(f'- `"src/wav/{f}" {t}`' for f, t in sorted(ccby.items()))
    mirror = recipe["mirrors"]["open-game-sfx-index"]
    zips = "\n".join(f"   - {recipe['packs'][k]['title']}: {recipe['packs'][k]['official_zip']}" for k in used_mirror_packs(recipe))
    return (
        template.replace("{{CCBY}}", ccby_lines)
        .replace("{{FILES}}", "\n".join(rows))
        .replace("{{OPENSFX_COMMIT}}", recipe["packs"]["opensfx"]["commit"])
        .replace("{{MIRROR_COMMIT}}", mirror["commit"])
        .replace("{{OFFICIAL_ZIPS}}", zips)
        .replace("{{OPENOMSI_ZIP}}", recipe["packs"]["openomsi"]["release_zip"])
        .replace("{{OPENOMSI_SHA256}}", recipe["packs"]["openomsi"]["release_sha256"])
    )


# ---- upstream verification (closes the "mirror is not first-party" gap) ----

def used_mirror_packs(recipe):
    """Packs a sound uses whose files were taken from the community mirror, in recipe order."""
    used = {ly["pack"] for entry in recipe["sounds"].values() for ly in entry["layers"]}
    return [k for k, v in recipe["packs"].items() if "mirror" in v and k in used]


def used_mirror_layers(recipe):
    """Sorted unique (pack, file) pairs of the mirror packs that sounds actually use."""
    return sorted({(ly["pack"], ly["file"]) for entry in recipe["sounds"].values() for ly in entry["layers"] if "mirror" in recipe["packs"][ly["pack"]]})


def md5_file(path):
    return hashlib.md5(Path(path).read_bytes()).hexdigest()


def pcm_md5(path):
    return hashlib.md5(decode(path).astype("<f4").tobytes()).hexdigest()


def index_upstream(upstream):
    """Files under the unzipped official packs by file name and by stem, ignoring macOS archive junk."""
    by_name, by_stem = {}, {}
    for p in sorted(Path(upstream).rglob("*")):
        if not p.is_file() or "__MACOSX" in p.parts or p.name.startswith("._"):
            continue
        by_name.setdefault(p.name, []).append(p)
        by_stem.setdefault(p.stem, []).append(p)
    return by_name, by_stem


def pack_slug(pack):
    """Folder-name hint of a pack's official zip (kenney_impact-sounds.zip -> impact-sounds)."""
    stem = Path(urlparse(pack["official_zip"]).path).stem
    return stem[len("kenney_"):] if stem.startswith("kenney_") else stem


def prefer_pack(candidates, slug):
    """Files from a folder that names the pack, when there are any: Kenney packs share file names."""
    named = [c for c in candidates if slug.lower() in str(c).lower()]
    return named or candidates


def verify_layer(source, pack, file, index):
    """(status, detail) of one mirror file against the official packs: MATCH, DIFFERENT or NOT FOUND."""
    by_name, by_stem = index
    slug = pack_slug(pack)
    mine = md5_file(source)
    same_name = prefer_pack(by_name.get(file, []), slug)
    for candidate in same_name:
        if md5_file(candidate) == mine:
            return "MATCH", str(candidate)
    if same_name:
        return "DIFFERENT", f"{len(same_name)} file(s) of that name differ, e.g. {same_name[0]}"
    # The mirror converts AIFF to lossless WAV, so a changed container is expected: compare the decoded samples.
    converted = [c for c in prefer_pack(by_stem.get(Path(file).stem, []), slug) if c.suffix.lower() != Path(file).suffix.lower()]
    if converted:
        pcm = pcm_md5(source)
        for candidate in converted:
            if pcm_md5(candidate) == pcm:
                return "MATCH", f"{candidate} (decoded samples; container converted by the mirror)"
        return "DIFFERENT", f"{converted[0]} has other samples"
    return "NOT FOUND", ""


def verify_upstream(recipe, sources_root, upstream):
    """One (file, pack, status, detail) row per mirror file the sounds use."""
    index = index_upstream(upstream)
    rows = []
    for pack_name, file in used_mirror_layers(recipe):
        pack = recipe["packs"][pack_name]
        source = Path(sources_root) / pack["dir"] / file
        if not source.is_file():
            raise FileNotFoundError(source)
        status, detail = verify_layer(source, pack, file, index)
        rows.append((file, pack_name, status, detail))
    return rows


def verify_report(rows):
    """The table, a summary line and the process exit code (0 only when every file matched)."""
    width = max([len(r[0]) for r in rows] + [4])
    pack_width = max([len(r[1]) for r in rows] + [4])
    lines = [f"{'file':<{width}}  {'pack':<{pack_width}}  status     detail"]
    lines += [f"{f:<{width}}  {p:<{pack_width}}  {s:<9}  {d}" for f, p, s, d in rows]
    counts = {s: sum(1 for r in rows if r[2] == s) for s in ("MATCH", "DIFFERENT", "NOT FOUND")}
    lines.append(f"{len(rows)} file(s): {counts['MATCH']} MATCH, {counts['DIFFERENT']} DIFFERENT, {counts['NOT FOUND']} NOT FOUND")
    if counts["MATCH"] == len(rows) and rows:
        lines.append("Every mirror file matches the official pack. Still confirm the 'License: Creative Commons CC0'"
                     " line on each pack page, then record the check in assets/audio/credits.template.md.")
    return "\n".join(lines), 0 if rows and counts["MATCH"] == len(rows) else 1


def verify_epilog(recipe):
    zips = "\n".join(f"  {recipe['packs'][k]['official_zip']}" for k in used_mirror_packs(recipe))
    return (
        "--verify-upstream <dir>: <dir> holds the official packs, unzipped (any folder layout). For every mirror file a\n"
        "sound uses, the same-named file is looked up there and compared by md5 with the file in --sources; a changed\n"
        "container (the mirror converts AIFF to WAV) is compared by decoded samples. Prints MATCH / DIFFERENT /\n"
        "NOT FOUND per file and exits 1 unless every file matched. Official downloads (from the mirror's SOURCES.md):\n"
        f"{zips}\n"
        "Then confirm 'License: Creative Commons CC0' on each pack page (and on the OpenGameArt page)."
    )


def selftest():
    """Run verify_upstream on a tiny fake tree; raises AssertionError when a status is wrong."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        mirror, official = root / "mirror", root / "official"
        (mirror / "kenney").mkdir(parents=True)
        (mirror / "oga").mkdir()
        for name, data in {"same.ogg": b"same", "changed.ogg": b"mine", "gone.ogg": b"gone", "shared.ogg": b"mine"}.items():
            (mirror / "kenney" / name).write_bytes(data)
        t = np.arange(4410) / SR
        for name, freq in {"Same.wav": 440, "Other.wav": 880}.items():
            pcm = (np.sin(2 * math.pi * freq * t) * 12000).astype("<i2").tobytes()
            with wave.open(str(mirror / "oga" / name), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SR)
                w.writeframes(pcm)
        pack_dir = official / "kenney_fake-pack" / "Audio"
        other_dir = official / "kenney_other-pack" / "Audio"
        junk_dir = official / "__MACOSX" / "kenney_fake-pack" / "Audio"
        for d in (pack_dir, other_dir, junk_dir, official / "oga_zip"):
            d.mkdir(parents=True)
        (pack_dir / "same.ogg").write_bytes(b"same")
        (pack_dir / "changed.ogg").write_bytes(b"theirs")
        (junk_dir / "gone.ogg").write_bytes(b"gone")
        (pack_dir / "._same.ogg").write_bytes(b"junk")
        (other_dir / "shared.ogg").write_bytes(b"not mine")
        (pack_dir / "shared.ogg").write_bytes(b"mine")
        for name, wav in {"Same.aiff": "Same.wav", "Other.aiff": "Same.wav"}.items():
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mirror / "oga" / wav), "-c:a", "pcm_s16be", str(official / "oga_zip" / name)], check=True)
        pack = lambda d, slug: {"dir": d, "mirror": "m", "official_zip": f"https://example.invalid/kenney_{slug}.zip"}
        recipe = {
            "packs": {"fake": pack("kenney", "fake-pack"), "oga": {**pack("oga", "x"), "official_zip": "https://example.invalid/oga_zip.zip"}},
            "sounds": {"s": {"layers": [{"pack": "fake", "file": f} for f in ("same.ogg", "changed.ogg", "gone.ogg", "shared.ogg")]
                             + [{"pack": "oga", "file": "Same.wav"}, {"pack": "oga", "file": "Other.wav"}]}},
        }
        got = {r[0]: r[2] for r in verify_upstream(recipe, mirror, official)}
        want = {"same.ogg": "MATCH", "changed.ogg": "DIFFERENT", "gone.ogg": "NOT FOUND", "shared.ogg": "MATCH", "Same.wav": "MATCH", "Other.wav": "DIFFERENT"}
        assert got == want, f"selftest: got {got}, wanted {want}"
        assert verify_report([("a", "p", "MATCH", "")])[1] == 0
        assert verify_report([("a", "p", "MATCH", ""), ("b", "p", "DIFFERENT", "")])[1] == 1
        assert verify_report([("a", "p", "NOT FOUND", "")])[1] == 1
        assert verify_report([])[1] == 1
    bed = loop_bed(loop_period(np.random.default_rng(1).standard_normal(SR * 3), 2.0, 0.5), 0.25)
    n = 2 * SR
    assert len(bed) == n + 2 * int(0.25 * SR) and np.array_equal(bed[:-n], bed[n:]), "selftest: a bed is not periodic"
    print("selftest OK: MATCH, DIFFERENT, NOT FOUND, pack-folder preference, junk skipping and AIFF/WAV sample comparison"
          " behave; a looped bed is periodic over the whole file")


def main():
    try:
        epilog = verify_epilog(json.loads((HERE / "recipe.json").read_text()))
    except (OSError, ValueError, KeyError):
        epilog = None
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], epilog=epilog, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources")
    ap.add_argument("--recipe", default=str(HERE / "recipe.json"))
    ap.add_argument("--out", default=str(HERE.parent.parent / "public" / "audio" / "sfx"))
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--credits", action="store_true", help="write public/audio/CREDITS.md and exit")
    ap.add_argument("--verify-upstream", metavar="DIR", help="compare every mirror file a sound uses with the official pack unzipped in DIR (needs --sources); exit 1 unless all MATCH")
    ap.add_argument("--selftest", action="store_true", help="check --verify-upstream on a generated fake tree (needs ffmpeg, no network) and exit")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return
    recipe = json.loads(Path(args.recipe).read_text())
    if args.credits:
        template = (HERE / "credits.template.md").read_text()
        dest = HERE.parent.parent / "public" / "audio" / "CREDITS.md"
        dest.write_text(credits_text(recipe, template))
        print(f"wrote {dest}")
        return
    if args.verify_upstream:
        if not args.sources:
            ap.error("--verify-upstream needs --sources (the files the sounds were built from)")
        if not Path(args.verify_upstream).is_dir():
            ap.error(f"--verify-upstream: {args.verify_upstream} is not a directory")
        text, code = verify_report(verify_upstream(recipe, args.sources, args.verify_upstream))
        print(text)
        sys.exit(code)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not args.sources:
        ap.error("--sources is required unless --credits")
    src = Sources(args.sources, recipe["packs"])
    names = args.only or sorted(recipe["sounds"])
    built = []
    for name in names:
        dest, info = build_one(name, recipe["sounds"][name], recipe, src, out_dir)
        built.append(dest)
        print(f"{name:<20} gain {info['gain_db']:+6.1f} dB  limiter {info['limited_db']:4.1f} dB  decoded peak {info['decoded_peak_db']:5.1f}  low {info['low_share']:.2f} mid {info['mid_share']:.2f}{'  BODY' if info['body'] else ''}", file=sys.stderr)
    if args.report:
        report(built)


if __name__ == "__main__":
    main()
