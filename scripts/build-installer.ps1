param(
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [string]$Version = "",
    [string]$IsccPath = "",
    [switch]$SkipPublish
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$projectPath = Join-Path $repoRoot "HtmlEditor.csproj"
$installerScript = Join-Path $repoRoot "installer\HtmlEditor.iss"
$targetFramework = "net10.0-windows10.0.19041.0"
$publishDir = Join-Path $repoRoot "bin\$Configuration\$targetFramework\$Runtime\publish"
$outputDir = Join-Path $repoRoot "artifacts\installer"

if ([string]::IsNullOrWhiteSpace($Version)) {
    [xml]$project = Get-Content -LiteralPath $projectPath
    $versionNode = $project.Project.PropertyGroup |
        Where-Object { $_.ApplicationDisplayVersion } |
        Select-Object -First 1

    $Version = if ($versionNode) { [string]$versionNode.ApplicationDisplayVersion } else { "1.0.0" }
}

if ($Version -match '^\d+\.\d+$') {
    $Version = "$Version.0"
}

if (-not $SkipPublish) {
    dotnet publish $projectPath `
        -f $targetFramework `
        -c $Configuration `
        -r $Runtime `
        --self-contained true `
        /p:WindowsPackageType=None `
        /p:PublishSingleFile=false `
        /p:ApplicationDisplayVersion=$Version
}

if (-not (Test-Path -LiteralPath (Join-Path $publishDir "HtmlEditor.exe"))) {
    throw "Publish output does not contain HtmlEditor.exe: $publishDir"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

if ([string]::IsNullOrWhiteSpace($IsccPath)) {
    $isccCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($isccCommand) {
        $IsccPath = $isccCommand.Source
    }
}

if ([string]::IsNullOrWhiteSpace($IsccPath)) {
    $registryRoots = @(
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    $innoSetup = Get-ItemProperty $registryRoots -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like "*Inno Setup*" -and $_.InstallLocation } |
        Select-Object -First 1

    if ($innoSetup) {
        $candidate = Join-Path $innoSetup.InstallLocation "ISCC.exe"
        if (Test-Path -LiteralPath $candidate) {
            $IsccPath = $candidate
        }
    }
}

if ([string]::IsNullOrWhiteSpace($IsccPath)) {
    $defaultPaths = @(
        "D:\Programs\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )

    foreach ($path in $defaultPaths) {
        if ($path -and (Test-Path -LiteralPath $path)) {
            $IsccPath = $path
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($IsccPath) -or -not (Test-Path -LiteralPath $IsccPath)) {
    throw "ISCC.exe was not found. Install Inno Setup 6 or pass -IsccPath."
}

& $IsccPath `
    "/DSourceDir=$publishDir" `
    "/DOutputDir=$outputDir" `
    "/DMyAppVersion=$Version" `
    $installerScript

if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup compiler failed with exit code $LASTEXITCODE."
}

Write-Host "Installer output: $outputDir"
