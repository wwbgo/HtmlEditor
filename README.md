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
- Build a Windows installer with Inno Setup.
- GitHub Actions workflow for automatic installer packaging and publishing to GitHub Packages.

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
- Tags matching `v*`.
- Manual workflow dispatch.

It performs these steps:

- Restores npm assets.
- Installs the .NET MAUI workload.
- Installs Inno Setup.
- Builds the Windows installer.
- Uploads the installer as a GitHub Actions artifact.
- Publishes the installer to GitHub Packages through GHCR as an OCI artifact.

Package name:

```text
ghcr.io/<owner>/htmleditor-windows-installer:<version>
```

Pushes to `main` also publish:

```text
ghcr.io/<owner>/htmleditor-windows-installer:latest
```

CI versions are generated from the project or tag version plus the GitHub Actions run number. For example:

```text
1.0.0.27
```

## Editing Notes

`ContentEditable` is the default mode. It is intentionally conservative: it edits text leaf nodes and selected media/link attributes, then merges the changed content back into the original HTML. This avoids common editor serialization problems such as changing `img` into `div`, removing wrapper elements, or adding unwanted paragraph tags.

For static sites with root-relative local assets, the editor resolves assets for preview and rewrites them back to relative paths on save.
