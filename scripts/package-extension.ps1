param(
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ExtensionDir = Join-Path $Root "extension"
if (!$OutputDir) {
    $OutputDir = Join-Path $Root "dist"
}

$Manifest = Get-Content (Join-Path $ExtensionDir "manifest.json") -Raw | ConvertFrom-Json
$VersionName = if ($Manifest.version_name) { $Manifest.version_name } else { $Manifest.version }
$PackageName = "bondie-dock-browser-extension-$VersionName.zip"
$PackagePath = Join-Path $OutputDir $PackageName

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
if (Test-Path $PackagePath) {
    Remove-Item $PackagePath
}

$Items = Get-ChildItem -Path $ExtensionDir -Force
Compress-Archive -Path $Items.FullName -DestinationPath $PackagePath -Force
Write-Output $PackagePath
