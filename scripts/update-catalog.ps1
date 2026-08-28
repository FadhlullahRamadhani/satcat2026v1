param(
    [Parameter(Mandatory = $true)]
    [string]$Source,
    [int]$PreviewSize = 4096,
    [string]$PythonExecutable = "python",
    [string]$UiPublicPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$cliPath = Join-Path $projectRoot "src\satellite_catalog\cli.py"
$mergeCliPath = Join-Path $projectRoot "src\satellite_catalog\merge_catalogs.py"
if (-not $UiPublicPath) { $UiPublicPath = Join-Path $projectRoot "ui\public" }
$catalogPath = Join-Path $UiPublicPath "data\catalog.json"
$partialCatalogPath = Join-Path $UiPublicPath "data\catalog.partial.json"
$previewPath = Join-Path $UiPublicPath "previews"
$cacheDirectory = Join-Path $projectRoot ".satcat"
$cachePath = Join-Path $cacheDirectory "cache.json"

if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    throw "Catalog CLI was not found: $cliPath"
}

# A bare drive letter such as D: is drive-relative in Windows. Catalog scans
# should start at the drive root, so normalize it to D:\.
if ($Source -match '^[A-Za-z]:$') {
    $Source = "$Source\"
}
$resolvedSource = (Resolve-Path -LiteralPath $Source).Path

if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
    throw "Imagery source folder does not exist: $Source"
}

New-Item -ItemType Directory -Force (Split-Path -Parent $catalogPath) | Out-Null
New-Item -ItemType Directory -Force $previewPath | Out-Null

Push-Location $projectRoot
try {
    $startedAt = Get-Date
    Write-Host "[$($startedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))] Catalog update started."
    Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))] Source: $resolvedSource"
    Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))] Preview size: $PreviewSize px"
    Write-Host "Progress is based on completed raster-file count."
    Write-Host "A heartbeat with the current percentage will be printed every 3 minutes while a large file is processing."
    & $PythonExecutable $cliPath $resolvedSource `
        --output $catalogPath `
        --previews $previewPath `
        --preview-size $PreviewSize `
        --cache $cachePath

    if ($LASTEXITCODE -ne 0) {
        Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))] Scan stopped before completion."
        Write-Host "Completed files remain saved in: $cachePath"
        Write-Host "Partial catalog: $partialCatalogPath"
        Write-Host "Run the same command again to resume from the checkpoints."
        throw "Catalog update failed with exit code $LASTEXITCODE"
    }

    $catalogSourcePath = Join-Path $projectRoot "ui\catalog-sources"
    $supplementalCatalogs = @(Get-ChildItem -LiteralPath $catalogSourcePath -Filter "*.json" -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    if ($supplementalCatalogs.Count -gt 0) {
        & $PythonExecutable $mergeCliPath --output $catalogPath $catalogPath @supplementalCatalogs
        if ($LASTEXITCODE -ne 0) {
            throw "Catalog merge failed with exit code $LASTEXITCODE"
        }
        Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))] Merged $($supplementalCatalogs.Count) supplemental catalog source(s)."
    }

    $catalog = Get-Content -Raw -LiteralPath $catalogPath | ConvertFrom-Json
    $distClientPath = Join-Path $projectRoot "ui\dist\client"
    if (Test-Path -LiteralPath $distClientPath -PathType Container) {
        $distDataPath = Join-Path $distClientPath "data"
        $distPreviewPath = Join-Path $distClientPath "previews"
        New-Item -ItemType Directory -Force $distDataPath, $distPreviewPath | Out-Null
        Copy-Item -LiteralPath $catalogPath -Destination (Join-Path $distDataPath "catalog.json") -Force
        Get-ChildItem -LiteralPath $previewPath -File -ErrorAction SilentlyContinue | Copy-Item -Destination $distPreviewPath -Force
        Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))] Production preview synchronized: $distClientPath"
    }
    $finishedAt = Get-Date
    $elapsed = $finishedAt - $startedAt
    Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))] UI catalog updated: $($catalog.summary.scene_count) scenes, $($catalog.summary.folder_count) folders."
    Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))] Total elapsed: $($elapsed.ToString('hh\:mm\:ss'))."
    Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))] Refresh the browser to load the new catalog."
}
finally {
    Pop-Location
}
