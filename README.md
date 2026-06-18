# HtmlEditor

[中文说明](README.zh-CN.md)

HtmlEditor is a Windows desktop HTML editor built with .NET MAUI. It is designed for editing existing static HTML sites while preserving the original document structure as much as possible.

## Features

- Open a folder and browse HTML files from a file tree.
- Edit HTML with three editor modes:
  - `ContentEditable` default, conservative text editing that preserves existing elements.
  - `ContentTools`.
  - `GrapesJS`.
- Save and save as HTML files.
- Optional backup before saving.
- Restore previous backups.
- Compare a selected backup with the current editor content.
- Hide or show the left file tree panel.
- Initialize a Git repository and auto-commit changed files after save when the workspace is a Git repo.
- Check GitHub Releases for updates and download the latest Windows installer from the app.
- Build a Windows installer with Inno Setup.
- GitHub Actions workflow for automatic installer packaging and publishing to GitHub Packages.
- Publish installer downloads to GitHub Releases.

## Requirements

- Windows 10 or later.
- .NET 10 SDK.
- .NET MAUI workload.
- Node.js 22 or later.
- Inno Setup 6, only required for installer packaging.
- Git, optional but required for Git integration.

## Restore Dependencies

```powershell
npm ci
dotnet workload install maui
dotnet restore HtmlEditor.sln
```

## Build

```powershell
dotnet build HtmlEditor.sln
```

## Run

```powershell
dotnet run --project HtmlEditor.csproj
```

## Build Installer

The installer script publishes a self-contained Windows build and then compiles the Inno Setup installer.

```powershell
.\scripts\build-installer.ps1
```

The output is written to:

```text
artifacts\installer
```

To specify a version:

```powershell
.\scripts\build-installer.ps1 -Version 1.0.0.42 -BuildNumber 42
```

## GitHub CI

The workflow at `.github/workflows/package.yml` runs on:

- Pushes to `main`.
- Manual workflow dispatch.

It performs these steps:

- Restores npm assets.
- Installs the .NET MAUI workload.
- Installs Inno Setup.
- Builds the Windows installer.
- Uploads the installer as a GitHub Actions artifact for the workflow run.
- Publishes installer downloads to GitHub Releases.
- Publishes the installer to GitHub Packages through GHCR as an OCI artifact.

On every `main` push, CI finds the highest existing `1.0.x` tag, increments `x`, builds the installer, creates the new tag, and publishes the installer to that tag's GitHub Release. For example:

```text
1.0.0
1.0.1
1.0.2
```

Installer downloads should use the Release assets:

```text
https://github.com/wwbgo/HtmlEditor/releases/tag/1.0.0
```

Package name:

```text
ghcr.io/<owner>/htmleditor-windows-installer:<version>
```

Pushes to `main` also publish:

```text
ghcr.io/<owner>/htmleditor-windows-installer:latest
```

CI uses the auto-generated tag as the display version and the GitHub Actions run number as the Windows application build number.

Actions artifact URLs are not intended as stable public download links and may require GitHub access. Use the release assets for installer downloads.

## Editing Notes

`ContentEditable` is the default mode. It is intentionally conservative: it edits text leaf nodes and selected media/link attributes, then merges the changed content back into the original HTML. This avoids common editor serialization problems such as changing `img` into `div`, removing wrapper elements, or adding unwanted paragraph tags.

On Windows, WebView2 maps the opened static site folder to a virtual HTTPS host for preview. Root-relative and relative assets load through that mapped site root, so the editor does not need to rewrite original HTML paths for preview. If an editor serializes virtual or legacy `file://` asset URLs, save normalization rewrites those URLs back to relative paths.
