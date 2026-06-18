# HtmlEditor

[English](README.md)

HtmlEditor 是一个基于 .NET MAUI 的 Windows 桌面 HTML 编辑器。它主要用于编辑已有的静态 HTML 站点，并尽量保留原始 HTML 结构。

## 功能

- 打开文件夹，并通过左侧文件树浏览 HTML 文件。
- 支持三种编辑模式：
  - `ContentEditable`：默认模式，保守编辑文本内容，尽量保留原始元素结构。
  - `ContentTools`。
  - `GrapesJS`。
- 保存和另存为 HTML 文件。
- 保存前可选自动备份。
- 还原历史备份。
- 选择一个历史备份，与当前编辑器内容进行对比。
- 隐藏或显示左侧文件树。
- 初始化 Git 仓库；当工作目录是 Git 仓库时，保存后自动提交当前文件。
- 使用 Inno Setup 构建 Windows 安装包。
- 通过 GitHub Actions 自动打包并发布到 GitHub Packages。
- 将安装包发布到 GitHub Releases 供下载。

## 环境要求

- Windows 10 或更高版本。
- .NET 10 SDK。
- .NET MAUI workload。
- Node.js 22 或更高版本。
- Inno Setup 6，仅打包安装程序时需要。
- Git，可选；使用 Git 集成功能时需要。

## 恢复依赖

```powershell
npm ci
dotnet workload install maui
dotnet restore HtmlEditor.sln
```

## 构建

```powershell
dotnet build HtmlEditor.sln
```

## 运行

```powershell
dotnet run --project HtmlEditor.csproj
```

## 构建安装包

安装包脚本会先发布一个自包含 Windows 构建，然后调用 Inno Setup 编译安装包。

```powershell
.\scripts\build-installer.ps1
```

输出目录：

```text
artifacts\installer
```

指定版本号：

```powershell
.\scripts\build-installer.ps1 -Version 1.0.0.42 -BuildNumber 42
```

## GitHub CI

工作流文件位于 `.github/workflows/package.yml`，触发条件：

- 推送到 `main` 分支。
- 推送匹配 `v*` 的 tag。
- 手动触发 workflow。

CI 会执行：

- 恢复 npm 前端资源。
- 安装 .NET MAUI workload。
- 安装 Inno Setup。
- 构建 Windows 安装包。
- 将安装包上传为 GitHub Actions artifact，供当前 workflow run 使用。
- 将安装包发布到 GitHub Releases。
- 通过 GHCR 以 OCI artifact 形式发布到 GitHub Packages。

Actions artifact 链接不是稳定的公开下载链接，通常需要 GitHub 访问权限。安装包下载建议使用 Releases 的 Assets：

- `main` 分支构建会更新 `latest-build` 预发布版本：

```text
https://github.com/wwbgo/HtmlEditor/releases/tag/latest-build
```

最新安装包固定下载地址：

```text
https://github.com/wwbgo/HtmlEditor/releases/download/latest-build/HtmlEditor-Setup-latest-win-x64.exe
```

- `v*` tag 会创建或更新对应正式版本，例如：

```text
https://github.com/wwbgo/HtmlEditor/releases/tag/v1.0.0
```

Package 名称：

```text
ghcr.io/<owner>/htmleditor-windows-installer:<version>
```

推送到 `main` 分支时还会发布：

```text
ghcr.io/<owner>/htmleditor-windows-installer:latest
```

CI 版本号由项目版本或 tag 版本加 GitHub Actions run number 组成。例如：

```text
1.0.0.27
```

## 编辑说明

`ContentEditable` 是默认编辑模式。它的策略比较保守：只编辑纯文本叶子节点和选中的媒体/链接属性，然后把修改内容合并回原始 HTML。这样可以避免常见的编辑器序列化问题，例如把 `img` 改成 `div`、删除外层元素、或者额外添加 `p` 标签。

在 Windows 上，WebView2 会把打开的静态站点目录映射到一个虚拟 HTTPS 域名用于预览。根相对路径和相对路径资源会通过这个站点根目录加载，所以预览时不需要改写原始 HTML 路径。如果编辑器内部把虚拟地址或历史遗留的 `file://` 资源地址序列化出来，保存时会再归一化回相对路径。
