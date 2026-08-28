# Satellite Imagery Catalog

A static-first catalog architecture for recursively indexing satellite imagery, publishing JSON and previews on GitHub Pages, and exporting browser-generated PDF reports.

## Reference document findings

The supplied Word example contains a title (`DATA CRST KALTENG 2026`), a provider/group heading (`BEIJING`), and two repeated records. Each record is a complete Windows path followed by a large preview. Both paths are under `D:\\BEIJING\\L2`, and the filenames resemble:

`BJ3A1_PMS1_20250729031315_L2_106049_SC_003_..._001-FUS.tif`

This implies the useful hierarchy `catalog / provider / processing level / product folder / scene`, while the file name contributes platform (`BJ3A1`), sensor (`PMS1` or `PAN1`), UTC-like acquisition timestamp, processing level (`L2`), scene identifiers, and product (`FUS`). The new design preserves the example's path-plus-preview pairing, but turns it into searchable scene cards and a report layout.

## Recommended architecture

```text
imagery folders -> Python builder -> catalog.json + thumbnails + footprints
                                      |
                                      v
                         static browser app on GitHub Pages
                                      |
                         selected IDs -> printable report -> PDF
```

The builder runs locally or in CI where the imagery is accessible. GitHub Pages hosts only the generated catalog, lightweight previews, optional simplified GeoJSON, and frontend assets—not multi-gigabyte TIFFs. Scene links may point to a file share, object store, STAC endpoint, or relative downloadable asset.

## UI recommendation

Use a responsive application shell with four coordinated areas:

1. A top bar with catalog name, global search, last-built timestamp, and **Export report**.
2. A collapsible left filter rail for provider/folder, platform, sensor, processing level, date range, CRS, metadata status, and duplicates.
3. A main results area supporting **Cards**, **Table**, and **Map** modes. Cards keep the reference document's large-preview emphasis; the table is for QA; the map renders simplified footprints.
4. A right scene drawer with preview, path copy button, filename-derived fields, raster metadata, footprint/bounds, duplicate warnings, and selection toggle.

Persist filters and selected IDs in the URL so a view is shareable. Load the JSON once, build a small in-memory search index, lazy-load thumbnails, virtualize large lists, and cluster/simplify footprints. For catalogs above roughly 25–50k scenes, emit partitioned JSON (`index.json` plus per-folder/year shards) instead of one large file.

## Catalog builder

Install the basic CLI with no geospatial dependencies:

```bash
python -m pip install -e .
satcat D:/BEIJING --output site/data/catalog.json
```

For GeoTIFF metadata, bounds, footprints, and thumbnails:

```bash
python -m pip install -e ".[geo]"
satcat D:/BEIJING --output site/data/catalog.json --previews site/previews --preview-size 4096
```

The scanner:

- recursively finds `.tif`, `.tiff`, `.jp2`, `.img`, `.vrt`, and `.ecw`;
- never reads a complete large TIFF into memory;
- creates a fast content signature from size plus the first/last 1 MiB;
- extracts common filename tokens conservatively and leaves uncertain values null;
- reads CRS, dimensions, bands, nodata, bounds, and a footprint when Rasterio is installed;
- creates a high-resolution JPEG with a 4096 px long edge by default (configurable, but always greater than 3000 px), using percentile stretching and overview-aware reads;
- catalogs ECW files even when the local GDAL build cannot decode them; an ECW-enabled GDAL/Rasterio build is required for CRS extraction, footprints, and JPEG previews;
- reuses cached scene records when size and nanosecond modification time are unchanged;
- reports duplicate signature groups without deleting or hiding anything.

## Updating the live UI catalog

The browser now reads `ui/public/data/catalog.json` at startup and falls back to demo data only when that file does not exist. From PowerShell, update the entire catalog with:

```powershell
& ".\scripts\update-catalog.ps1" -Source "D:\" -PreviewSize 4096
```

If `python` is not on PATH, provide its executable explicitly:

```powershell
& ".\scripts\update-catalog.ps1" `
  -Source "D:\" `
  -PreviewSize 4096 `
  -PythonExecutable "C:\path\to\python.exe"
```

The first run counts and then reads every supported raster, displaying completed files, total files, and a file-based percentage. While one large raster is processing, a heartbeat is printed every 3 minutes. The builder atomically checkpoints `.satcat/cache.json` and `ui/public/data/catalog.partial.json` after every completed file. If the process is cancelled or the computer loses power, run the same command again: completed rasters are restored from cache and only the file active at interruption may repeat. A successful run atomically writes `catalog.json` and removes the partial catalog. After it finishes, refresh the browser. For a production/GitHub Pages update, rebuild the UI and commit the changed `ui/public/data/`, `ui/public/previews/`, and `ui/dist/` files.

For production, add provider-specific parser plugins with ordered confidence scores. Sidecar metadata (`.xml`, `.json`, `.imd`, `.rpc`) should override filename guesses, and raster headers should override both for spatial fields. Reproject footprints to WGS84 before web mapping; the starter currently records native-CRS bounds and labels them with `crs`.

## PDF workflow

PDF export belongs in the browser so GitHub Pages remains serverless:

- Selection state contains scene IDs; “all” means the current filtered result, not necessarily the entire raw catalog.
- Build a dedicated `/report` route with title, generation time, active filters, summary counts, folder sections, and one scene block per entry.
- Each block shows thumbnail, filename, original path, platform/sensor/date/level, CRS, size, and bounds. Use CSS `break-inside: avoid` and repeat page headers.
- Trigger `window.print()` for the most reliable no-dependency PDF. Add `pdf-lib` or `jsPDF` only if a one-click binary download is essential.
- Cap embedded image resolution and warn before very large reports; for hundreds of scenes, split by folder or create a summary-only report.

## Repository layout

```text
satellite-catalog/
├─ pyproject.toml
├─ src/satellite_catalog/       # implemented builder CLI
├─ schema/catalog.schema.json   # stable frontend contract
├─ site/
│  ├─ data/catalog.json         # generated
│  ├─ previews/                 # generated, compressed
│  └─ src/                      # future static UI
├─ .satcat/cache.json           # local incremental cache, ignored
└─ .github/workflows/           # optional build/deploy jobs
```

Recommended frontend: Vite + TypeScript, React or Preact, MapLibre GL JS, and native CSS. Keep the catalog adapter separate from components so the same UI can later consume STAC ItemCollections. GitHub Actions should build the frontend and deploy `dist/` to Pages; only run imagery scanning in CI if the source data is actually available to that runner.

## Data and operational rules

- Use forward-slash relative paths in JSON; never publish private absolute drive paths.
- Keep `id` stable from the relative path, and `signature` content-based for duplicate detection.
- Treat moved files as the same content but a new catalog ID; an optional reconciliation pass can preserve aliases.
- Mark records with `basic`, `geospatial`, or `error` metadata status so incomplete scenes remain visible.
- Store preview dimensions and checksums in a later schema revision to support CDN caching and stale-preview checks.
- Never commit source TIFFs by default. Use Git LFS only for deliberately small samples; object storage or releases are better for downloads.

## Visual direction checkpoint

Before implementing the browser UI, choose one visual direction: **operations console** (dense QA-first table/map), **visual archive** (large imagery cards like the Word reference), or **balanced explorer** (recommended: cards by default, strong filters, optional table/map). The data model and CLI support all three without change.
