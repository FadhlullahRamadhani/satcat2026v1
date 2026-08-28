from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

RASTER_EXTENSIONS = {".tif", ".tiff", ".jp2", ".img", ".vrt", ".ecw"}
DATE_PATTERNS = [
    re.compile(r"(?<!\d)(20\d{6})[_T]?(\d{6})(?!\d)"),
    re.compile(r"(?<!\d)(20\d{2})[-_](\d{2})[-_](\d{2})(?!\d)"),
]


def progress(message: str) -> None:
    stamp = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
    print(f"[{stamp}] {message}", flush=True)


@contextmanager
def heartbeat(label: str, interval: int = 180):
    """Print periodic progress while a single large raster is being processed."""
    stopped = threading.Event()
    started = time.monotonic()

    def report() -> None:
        while not stopped.wait(interval):
            elapsed = int(time.monotonic() - started)
            progress(f"Still processing: {label} (elapsed {elapsed}s)")

    worker = threading.Thread(target=report, daemon=True)
    worker.start()
    completed = False
    try:
        yield
        completed = True
    finally:
        stopped.set()
        worker.join(timeout=1)
        elapsed = time.monotonic() - started
        state = "Finished" if completed else "Interrupted"
        progress(f"{state}: {label} ({elapsed:.1f}s)")


def write_json_atomic(path: Path, value: object) -> None:
    """Replace a JSON file atomically so cancellation cannot corrupt the last checkpoint."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(json.dumps(value, indent=2), "utf-8")
    os.replace(temporary, path)


def catalog_document(root: Path, scenes: list[dict], signatures: dict[str, list[str]], status: str) -> dict:
    duplicate_groups = [ids for ids in signatures.values() if len(ids) > 1]
    return {
        "schema_version": "1.0.0",
        "build_status": status,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_root": root.name,
        "summary": {
            "scene_count": len(scenes),
            "folder_count": len({scene["folder"] for scene in scenes}),
            "duplicate_group_count": len(duplicate_groups),
        },
        "duplicate_groups": duplicate_groups,
        "scenes": scenes,
    }


def file_signature(path: Path) -> str:
    """Fast identity: size plus hashes of the first/last 1 MiB."""
    size = path.stat().st_size
    digest = hashlib.sha256()
    digest.update(str(size).encode())
    with path.open("rb") as stream:
        digest.update(stream.read(1024 * 1024))
        if size > 1024 * 1024:
            stream.seek(max(0, size - 1024 * 1024))
            digest.update(stream.read(1024 * 1024))
    return digest.hexdigest()


def parse_filename(name: str) -> dict:
    stem = Path(name).stem
    tokens = re.split(r"[_-]+", stem)
    upper = stem.upper()
    acquired = None
    for pattern in DATE_PATTERNS:
        match = pattern.search(stem)
        if not match:
            continue
        try:
            if len(match.groups()) == 2:
                acquired = datetime.strptime("".join(match.groups()), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).isoformat()
            else:
                acquired = datetime.strptime("".join(match.groups()), "%Y%m%d").replace(tzinfo=timezone.utc).date().isoformat()
        except ValueError:
            pass
        break
    sensor = next((t for t in tokens if re.fullmatch(r"(?:PMS|PAN|MUX|MS|SAR)\d*", t, re.I)), None)
    processing = next((t.upper() for t in tokens if re.fullmatch(r"L[0-4][A-Z]?", t, re.I)), None)
    platform = next((t.upper() for t in tokens if re.fullmatch(r"(?:BJ|GF|ZY|HJ|CBERS|LANDSAT|SENTINEL)[A-Z0-9]*", t, re.I)), tokens[0].upper() if tokens else None)
    return {
        "platform": platform,
        "sensor": sensor.upper() if sensor else None,
        "processing_level": processing,
        "acquired_at": acquired,
        "product": "FUS" if re.search(r"(?:^|[-_])FUS(?:$|[-_])", upper) else None,
    }


def iter_rasters(root: Path):
    """Walk large drives without failing on protected or unreadable folders."""
    def ignore_error(error: OSError) -> None:
        progress(f"Skipping unreadable path: {error}")

    for directory, _, filenames in os.walk(root, onerror=ignore_error):
        for filename in sorted(filenames):
            path = Path(directory, filename)
            if path.suffix.lower() in RASTER_EXTENSIONS:
                yield path


def raster_metadata(path: Path, preview_dir: Path, scene_id: str, preview_size: int) -> dict:
    try:
        import rasterio
        from rasterio.enums import Resampling
    except ImportError:
        if path.suffix.lower() == ".ecw":
            return {
                "metadata_status": "unsupported",
                "metadata_warning": (
                    "ECW file discovered. Install Rasterio with an ECW-enabled GDAL build "
                    "to extract CRS, footprints, and JPEG previews."
                ),
            }
        return {"metadata_status": "basic", "metadata_warning": "Install the geo extra for CRS, footprint, and preview generation."}

    result: dict = {"metadata_status": "geospatial"}
    try:
        with rasterio.open(path) as src:
            result.update({
                "crs": src.crs.to_string() if src.crs else None,
                "width": src.width,
                "height": src.height,
                "band_count": src.count,
                "dtype": src.dtypes[0] if src.count else None,
                "nodata": src.nodata,
                "bounds": [src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top],
                "footprint": {
                    "type": "Polygon",
                    "coordinates": [[
                        [src.bounds.left, src.bounds.bottom], [src.bounds.right, src.bounds.bottom],
                        [src.bounds.right, src.bounds.top], [src.bounds.left, src.bounds.top],
                        [src.bounds.left, src.bounds.bottom],
                    ]],
                },
            })
            preview_dir.mkdir(parents=True, exist_ok=True)
            preview = preview_dir / f"{scene_id}.jpg"
            scale = min(preview_size / max(src.width, src.height), 1.0)
            out_width = max(1, round(src.width * scale))
            out_height = max(1, round(src.height * scale))
            indexes = list(range(1, min(src.count, 3) + 1)) or [1]
            data = src.read(
                indexes,
                out_shape=(len(indexes), out_height, out_width),
                resampling=Resampling.bilinear,
                masked=True,
            )
            import numpy as np
            from PIL import Image
            channels = []
            for band in data:
                values = band.compressed()
                lo, hi = (np.percentile(values, [2, 98]) if values.size else (0, 1))
                channels.append(np.clip((band.filled(lo) - lo) * 255 / max(hi - lo, 1e-9), 0, 255).astype("uint8"))
            while len(channels) < 3:
                channels.append(channels[-1])
            preview_tmp = preview.with_name(f"{preview.name}.tmp")
            Image.fromarray(np.dstack(channels[:3])).save(preview_tmp, format="JPEG", quality=90, optimize=True)
            os.replace(preview_tmp, preview)
            result["preview"] = preview.as_posix()
            result["preview_width"] = out_width
            result["preview_height"] = out_height
    except Exception as exc:
        warning = str(exc)
        if path.suffix.lower() == ".ecw":
            warning = (
                "ECW file discovered, but this GDAL/Rasterio installation could not decode it. "
                f"Install an ECW-enabled GDAL build to extract metadata and create a preview. Details: {warning}"
            )
            result.update({"metadata_status": "unsupported", "metadata_warning": warning})
        else:
            result.update({"metadata_status": "error", "metadata_warning": warning})
    return result


def build(root: Path, output: Path, preview_dir: Path, cache_path: Path, preview_size: int = 4096) -> dict:
    root = root.resolve()
    old = json.loads(cache_path.read_text("utf-8")) if cache_path.exists() else {}
    cache, checkpoint_cache, scenes, signatures = {}, dict(old), [], {}
    partial_output = output.with_name(f"{output.stem}.partial{output.suffix}")
    progress("Counting supported raster files...")
    paths = []
    for path in iter_rasters(root):
        paths.append(path)
        if len(paths) % 100 == 0:
            progress(f"Discovered {len(paths)} raster files so far...")
    total = len(paths)
    progress(f"Found {total} raster file(s). Processing started.")
    for index, path in enumerate(paths, start=1):
        try:
            stat = path.stat()
        except OSError as exc:
            progress(f"Skipping unreadable file: {path} ({exc})")
            continue
        rel = path.relative_to(root).as_posix()
        completed_before = index - 1
        percent_before = (completed_before / total * 100) if total else 100
        progress(f"Starting [{index}/{total}]: {rel} (overall {percent_before:.1f}%)")
        with heartbeat(f"{rel} | overall {completed_before}/{total} ({percent_before:.1f}%)"):
            cache_key = f"{stat.st_size}:{stat.st_mtime_ns}:preview-{preview_size}"
            if old.get(rel, {}).get("cache_key") == cache_key:
                scene = dict(old[rel]["scene"])
                progress(f"Cache hit: {rel}")
                if scene.get("metadata_status") != "geospatial":
                    progress(f"Retrying metadata/preview extraction: {rel}")
                    scene.update(raster_metadata(path, preview_dir, scene["id"], preview_size))
            else:
                signature = file_signature(path)
                scene_id = hashlib.sha1(rel.encode("utf-8")).hexdigest()[:16]
                scene = {
                    "id": scene_id, "name": path.stem, "path": rel,
                    "folder": path.parent.relative_to(root).as_posix(),
                    "extension": path.suffix.lower(), "size_bytes": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    "signature": signature, **parse_filename(path.name),
                }
                scene.update(raster_metadata(path, preview_dir, scene_id, preview_size))
        signatures.setdefault(scene["signature"], []).append(scene["id"])
        scenes.append(scene)
        cache[rel] = {"cache_key": cache_key, "scene": scene}
        checkpoint_cache[rel] = cache[rel]
        write_json_atomic(cache_path, checkpoint_cache)
        write_json_atomic(partial_output, catalog_document(root, scenes, signatures, "partial"))
        percent_complete = (index / total * 100) if total else 100
        progress(f"Progress: {index}/{total} files complete ({percent_complete:.1f}%)")
        progress(f"Checkpoint saved: {len(scenes)} scene(s)")
    catalog = catalog_document(root, scenes, signatures, "complete")
    write_json_atomic(output, catalog)
    write_json_atomic(cache_path, cache)
    partial_output.unlink(missing_ok=True)
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a static satellite imagery catalog")
    parser.add_argument("root", type=Path)
    parser.add_argument("--output", type=Path, default=Path("site/data/catalog.json"))
    parser.add_argument("--previews", type=Path, default=Path("site/previews"))
    parser.add_argument(
        "--preview-size",
        type=int,
        default=4096,
        help="Maximum preview width or height in pixels (default: 4096)",
    )
    parser.add_argument("--cache", type=Path, default=Path(".satcat/cache.json"))
    args = parser.parse_args()
    if args.preview_size < 3001:
        parser.error("--preview-size must be greater than 3000 pixels")
    try:
        catalog = build(args.root, args.output, args.previews, args.cache, args.preview_size)
    except KeyboardInterrupt:
        partial = args.output.with_name(f"{args.output.stem}.partial{args.output.suffix}")
        progress("Cancellation received. Completed files are safely checkpointed.")
        progress(f"Partial catalog: {partial}")
        progress(f"Resume cache: {args.cache}")
        raise SystemExit(130)
    progress(f"Cataloged {catalog['summary']['scene_count']} scenes in {catalog['summary']['folder_count']} folders")


if __name__ == "__main__":
    main()
