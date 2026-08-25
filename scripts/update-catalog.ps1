param(
    [Parameter(Mandatory = $true)]
    [string]$Source,
    [int]$PreviewSize = 4096,
    [string]$PythonExecutable = "python",
    [string]$UiPublicPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $UiPublicPath) { $UiPublicPath = Join-Path $projectRoot "ui\public" }
$catalogPath = Join-Path $UiPublicPath "data\catalog.json"
$partialCatalogPath = Join-Path $UiPublicPath "data\catalog.partial.json"
$previewPath = Join-Path $UiPublicPath "previews"
$cachePath = Join-Path $projectRoot ".satcat\cache.json"

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Imagery source folder does not exist: $Source"
}

New-Item -ItemType Directory -Force (Split-Path -Parent $catalogPath) | Out-Null
New-Item -ItemType Directory -Force $previewPath | Out-Null

Push-Location $projectRoot
try {
    $startedAt = Get-Date
    Write-Host "[$($startedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))] Catalog update started."
    Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))] Source: $Source"
    Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))] Preview size: $PreviewSize px"
    Write-Host "Progress is based on completed raster-file count."
    Write-Host "A heartbeat with the current percentage will be printed every 3 minutes while a large file is processing."
    $previousPythonPath = $env:PYTHONPATH
    $env:PYTHONPATH = Join-Path $projectRoot "src"
    & $PythonExecutable -m satellite_catalog.cli $Source `
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

    $catalog = Get-Content -Raw -LiteralPath $catalogPath | ConvertFrom-Json
    $finishedAt = Get-Date
    $elapsed = $finishedAt - $startedAt
    Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))] UI catalog updated: $($catalog.summary.scene_count) scenes, $($catalog.summary.folder_count) folders."
    Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))] Total elapsed: $($elapsed.ToString('hh\:mm\:ss'))."
    Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))] Refresh the browser to load the new catalog."
}
finally {
    $env:PYTHONPATH = $previousPythonPath
    Pop-Location
}
