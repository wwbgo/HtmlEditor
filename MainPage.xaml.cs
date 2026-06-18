using System.Collections.ObjectModel;
using System.Text;
using System.Text.Json;
using HtmlEditor.Models;
using HtmlEditor.Services;
using Microsoft.Maui.Storage;

#if WINDOWS
using Microsoft.UI.Xaml.Input;
using Microsoft.Web.WebView2.Core;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Storage.Pickers;
using WinRT.Interop;
#endif

namespace HtmlEditor;

public partial class MainPage : ContentPage
{
    private const string PreferencesWorkspaceKey = "workspace.path";
    private const string EditorVirtualHostName = "appassets.example";
    private const string SiteVirtualHostName = "siteassets.example";
    private readonly HtmlFileTreeService _treeService = new();
    private readonly HtmlDocumentService _documentService = new();
    private readonly GitService _gitService = new();
    private readonly List<FileTreeNode> _treeRoots = [];
    private bool _editorReady;
    private bool _editorResourcesReady;
    private EditorMode _editorMode = EditorMode.ContentEditable;
    private bool _sidebarVisible = true;
    private bool _showFullDiff;
    private readonly List<FileDiffLine> _currentDiffLines = [];
    private string? _editorRoot;
    private string? _currentFilePath;
    private string? _workspacePath;
    private string? _pendingHtml;
    private string? _diffBackupLabel;
#if WINDOWS
    private bool _webMessageHooked;
    private bool _webResourceRequestHooked;
    private readonly Dictionary<string, string> _virtualHostFolders = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _virtualHostFilters = new(StringComparer.OrdinalIgnoreCase);
#endif

    public ObservableCollection<FileTreeNode> VisibleTreeItems { get; } = [];
    public ObservableCollection<FileDiffLine> DiffLines { get; } = [];

    public MainPage()
    {
        InitializeComponent();
        BindingContext = this;
        EditorModePicker.SelectedIndex = 2;
        UpdateModeChrome();
        UpdateSidebarChrome();
        EditorWebView.Source = new UrlWebViewSource { Url = "about:blank" };
        Loaded += OnLoaded;
    }

    protected override void OnHandlerChanged()
    {
        base.OnHandlerChanged();
        RegisterKeyboardShortcuts();
    }

    private async void OnLoaded(object? sender, EventArgs e)
    {
        await PrepareEditorAsync();

        var savedWorkspace = Preferences.Default.Get(PreferencesWorkspaceKey, string.Empty);
        if (!string.IsNullOrWhiteSpace(savedWorkspace) && Directory.Exists(savedWorkspace))
        {
            await LoadWorkspaceAsync(savedWorkspace);
        }
    }

    private async Task PrepareEditorAsync()
    {
        var editorRoot = Path.Combine(FileSystem.AppDataDirectory, "editor");
        _editorRoot = editorRoot;
        Directory.CreateDirectory(editorRoot);
        Directory.CreateDirectory(Path.Combine(editorRoot, "grapesjs"));
        Directory.CreateDirectory(Path.Combine(editorRoot, "contenttools"));
        Directory.CreateDirectory(Path.Combine(editorRoot, "contenttools", "images"));

        await CopyPackageFileAsync("editor/index.html", Path.Combine(editorRoot, "index.html"));
        await CopyPackageFileAsync("editor/editor.css", Path.Combine(editorRoot, "editor.css"));
        await CopyPackageFileAsync("editor/editor.js", Path.Combine(editorRoot, "editor.js"));
        await CopyPackageFileAsync("editor/grapesjs/grapes.min.js", Path.Combine(editorRoot, "grapesjs", "grapes.min.js"));
        await CopyPackageFileAsync("editor/grapesjs/grapes.min.css", Path.Combine(editorRoot, "grapesjs", "grapes.min.css"));
        await CopyPackageFileAsync("editor/contenttools-index.html", Path.Combine(editorRoot, "contenttools-index.html"));
        await CopyPackageFileAsync("editor/contenttools-editor.css", Path.Combine(editorRoot, "contenttools-editor.css"));
        await CopyPackageFileAsync("editor/contenttools-editor.js", Path.Combine(editorRoot, "contenttools-editor.js"));
        await CopyPackageFileAsync("editor/contenteditable-index.html", Path.Combine(editorRoot, "contenteditable-index.html"));
        await CopyPackageFileAsync("editor/contenteditable-editor.css", Path.Combine(editorRoot, "contenteditable-editor.css"));
        await CopyPackageFileAsync("editor/contenteditable-editor.js", Path.Combine(editorRoot, "contenteditable-editor.js"));
        await CopyPackageFileAsync("editor/contenttools/content-tools.min.js", Path.Combine(editorRoot, "contenttools", "content-tools.min.js"));
        await CopyPackageFileAsync("editor/contenttools/content-tools.min.css", Path.Combine(editorRoot, "contenttools", "content-tools.min.css"));
        await CopyPackageFileAsync("editor/contenttools/images/icons.woff", Path.Combine(editorRoot, "contenttools", "images", "icons.woff"));
        await CopyPackageFileAsync("editor/contenttools/images/drop-horz.svg", Path.Combine(editorRoot, "contenttools", "images", "drop-horz.svg"));
        await CopyPackageFileAsync("editor/contenttools/images/drop-vert-above.svg", Path.Combine(editorRoot, "contenttools", "images", "drop-vert-above.svg"));
        await CopyPackageFileAsync("editor/contenttools/images/drop-vert-below.svg", Path.Combine(editorRoot, "contenttools", "images", "drop-vert-below.svg"));
        await CopyPackageFileAsync("editor/contenttools/images/video.svg", Path.Combine(editorRoot, "contenttools", "images", "video.svg"));

        await LoadEditorShellAsync();
        _editorResourcesReady = true;
    }

    private static async Task CopyPackageFileAsync(string packagePath, string destinationPath)
    {
        await using var input = await FileSystem.OpenAppPackageFileAsync(packagePath);
        await using var output = File.Create(destinationPath);
        await input.CopyToAsync(output);
    }

    private async void OnOpenFolderClicked(object? sender, EventArgs e)
    {
        var folder = await PickFolderAsync();
        if (string.IsNullOrWhiteSpace(folder))
        {
            return;
        }

        await LoadWorkspaceAsync(folder);
    }

    private async void OnRefreshTreeClicked(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_workspacePath))
        {
            SetStatus("尚未打开文件夹");
            return;
        }

        await LoadWorkspaceAsync(_workspacePath);
    }

    private async void OnEditorModeChanged(object? sender, EventArgs e)
    {
        if (!_editorResourcesReady)
        {
            return;
        }

        if (EditorModePicker.SelectedIndex < 0)
        {
            return;
        }

        var selectedMode = EditorModePicker.SelectedIndex switch
        {
            1 => EditorMode.ContentTools,
            2 => EditorMode.ContentEditable,
            _ => EditorMode.GrapesJs
        };

        if (selectedMode == _editorMode && _editorReady)
        {
            return;
        }

        _editorMode = selectedMode;
        UpdateModeChrome();
        _editorReady = false;
#if WINDOWS
        _webMessageHooked = false;
#endif

        if (!string.IsNullOrWhiteSpace(_currentFilePath) && File.Exists(_currentFilePath))
        {
            _pendingHtml = await _documentService.ReadAsync(_currentFilePath);
        }

        await LoadEditorShellAsync();
        SetStatus($"已切换到 {GetEditorModeName(_editorMode)}");
    }

    private async void OnNewFileClicked(object? sender, EventArgs e)
    {
        var targetDirectory = _workspacePath;
        if (string.IsNullOrWhiteSpace(targetDirectory))
        {
            targetDirectory = await PickFolderAsync();
            if (string.IsNullOrWhiteSpace(targetDirectory))
            {
                return;
            }
        }

        try
        {
            var filePath = await _documentService.CreateNewHtmlAsync(targetDirectory);
            await LoadWorkspaceAsync(targetDirectory);
            await LoadFileAsync(filePath);
            SetStatus($"已创建 {Path.GetFileName(filePath)}");
        }
        catch (Exception ex)
        {
            await ShowErrorAsync("新建 HTML 失败", ex.Message);
        }
    }

    private async void OnInitGitClicked(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_workspacePath))
        {
            SetStatus("请先打开文件夹");
            return;
        }

        if (!await _gitService.IsGitAvailableAsync())
        {
            await ShowErrorAsync("Git 不可用", "未找到 git 命令，请先安装 Git 并确保它在 PATH 中。");
            return;
        }

        var result = await _gitService.InitRepositoryAsync(_workspacePath);
        SetStatus(result.Success ? "Git 仓库已初始化" : result.Message);
    }

    private async void OnFileTreeSelectionChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is not FileTreeNode node)
        {
            return;
        }

        if (node.IsDirectory)
        {
            FileTreeView.SelectedItem = null;
            node.IsExpanded = !node.IsExpanded;
            RefreshVisibleTree();
            return;
        }

        await LoadFileAsync(node.FullPath);
    }

    private void OnToggleNodeClicked(object? sender, EventArgs e)
    {
        var node = e is TappedEventArgs { Parameter: FileTreeNode tappedNode }
            ? tappedNode
            : (sender as BindableObject)?.BindingContext as FileTreeNode;

        if (node is null || !node.CanToggle)
        {
            return;
        }

        node.IsExpanded = !node.IsExpanded;
        RefreshVisibleTree();
    }

    private async void OnUndoClicked(object? sender, EventArgs e)
    {
        await ExecuteEditorCommandAsync("window.editorHost.undo()");
    }

    private async void OnRedoClicked(object? sender, EventArgs e)
    {
        await ExecuteEditorCommandAsync("window.editorHost.redo()");
    }

    private async void OnSaveClicked(object? sender, EventArgs e)
    {
        await SaveCurrentFileAsync();
    }

    private async void OnSaveAsClicked(object? sender, EventArgs e)
    {
        await SaveAsAsync();
    }

    private async void OnRestoreBackupClicked(object? sender, EventArgs e)
    {
        await RestoreBackupAsync();
    }

    private async void OnShowDiffClicked(object? sender, EventArgs e)
    {
        await ShowBackupDiffAsync();
    }

    private void OnShowFullDiffChanged(object? sender, CheckedChangedEventArgs e)
    {
        _showFullDiff = e.Value;
        RenderDiffLines();
    }

    private void OnCloseDiffClicked(object? sender, EventArgs e)
    {
        CloseDiffPanel();
    }

    private async void OnReloadClicked(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath))
        {
            await ExecuteEditorCommandAsync("window.editorHost.reload()");
            return;
        }

        await LoadFileAsync(_currentFilePath);
    }

    private async void OnPreviewChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (!_editorReady)
        {
            UpdateModeChrome();
            return;
        }

        UpdateModeChrome();

        var html = await GetEditorHtmlAsync();
        await LoadHtmlIntoEditorAsync(html);
        SetStatus(e.Value ? "已进入预览模式" : "已返回编辑模式");
    }

    private void OnToggleSidebarClicked(object? sender, EventArgs e)
    {
        _sidebarVisible = !_sidebarVisible;
        UpdateSidebarChrome();
    }

    private async void OnContentToolClicked(object? sender, EventArgs e)
    {
        if (_editorMode != EditorMode.ContentTools)
        {
            return;
        }

        if ((sender as Button)?.CommandParameter is not string toolName || string.IsNullOrWhiteSpace(toolName))
        {
            return;
        }

        await ExecuteEditorCommandAsync($"window.editorHost.applyTool('{EscapeJavaScriptString(toolName)}')");
    }

    private async void OnEditorNavigated(object? sender, WebNavigatedEventArgs e)
    {
        _editorReady = e.Result == WebNavigationResult.Success;
        if (!_editorReady)
        {
            SetStatus($"编辑器加载失败: {e.Result}");
            return;
        }

        RegisterWebViewMessages();
        SetStatus("编辑器已加载");

        if (!string.IsNullOrEmpty(_pendingHtml))
        {
            await LoadHtmlIntoEditorAsync(_pendingHtml);
            _pendingHtml = null;
        }
    }

    private async Task LoadWorkspaceAsync(string folder)
    {
        _workspacePath = folder;
        Preferences.Default.Set(PreferencesWorkspaceKey, folder);
        WorkspaceLabel.Text = folder;
        _treeRoots.Clear();
        _treeRoots.AddRange(_treeService.Load(folder));
        RefreshVisibleTree();
        SetStatus($"已打开文件夹: {folder}");
    }

    private async Task LoadEditorShellAsync()
    {
        if (string.IsNullOrWhiteSpace(_editorRoot))
        {
            return;
        }

        var fileName = _editorMode switch
        {
            EditorMode.ContentTools => "contenttools-index.html",
            EditorMode.ContentEditable => "contenteditable-index.html",
            _ => "index.html"
        };

        var shellUrl = await GetEditorShellUrlAsync(fileName);
        EditorWebView.Source = new UrlWebViewSource
        {
            Url = shellUrl
        };
    }

    private static string GetEditorModeName(EditorMode mode)
    {
        return mode switch
        {
            EditorMode.ContentTools => "ContentTools",
            EditorMode.ContentEditable => "ContentEditable",
            _ => "GrapesJS"
        };
    }

    private void RefreshVisibleTree()
    {
        VisibleTreeItems.Clear();
        foreach (var root in _treeRoots)
        {
            AddVisibleNode(root);
        }
    }

    private void AddVisibleNode(FileTreeNode node)
    {
        VisibleTreeItems.Add(node);

        if (!node.IsDirectory || !node.IsExpanded)
        {
            return;
        }

        foreach (var child in node.Children)
        {
            AddVisibleNode(child);
        }
    }

    private async Task LoadFileAsync(string path)
    {
        try
        {
            CloseDiffPanel();
            var html = await _documentService.ReadAsync(path);
            _currentFilePath = path;

            if (_editorReady)
            {
                await LoadHtmlIntoEditorAsync(html);
            }
            else
            {
                _pendingHtml = html;
            }

            SetStatus($"已加载 {Path.GetFileName(path)}");
        }
        catch (Exception ex)
        {
            await ShowErrorAsync("打开文件失败", ex.Message);
        }
    }

    private async Task ShowBackupDiffAsync()
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath))
        {
            SetStatus("请先打开要对比的文件");
            return;
        }

        var backups = _documentService.GetBackups(_currentFilePath);
        if (backups.Count == 0)
        {
            await ShowInfoAsync("没有可对比的备份", "当前文件还没有保存过的备份。");
            return;
        }

        var choices = backups
            .Select((backup, index) => FormatBackupChoice(backup, index))
            .ToArray();

        var selected = await DisplayActionSheetAsync("选择要对比的备份", "取消", null, choices);
        if (string.IsNullOrWhiteSpace(selected) || selected == "取消")
        {
            return;
        }

        var selectedIndex = Array.IndexOf(choices, selected);
        if (selectedIndex < 0)
        {
            return;
        }

        try
        {
            var backup = backups[selectedIndex];
            var backupHtml = await File.ReadAllTextAsync(backup.FullPath, Encoding.UTF8);
            var currentHtml = await GetEditorHtmlAsync();

            _currentDiffLines.Clear();
            _currentDiffLines.AddRange(BuildDiffLines(backupHtml, currentHtml));
            _diffBackupLabel = FormatBackupChoice(backup, selectedIndex);
            _showFullDiff = false;
            ShowFullDiffCheckBox.IsChecked = false;
            DiffPanel.IsVisible = true;
            RenderDiffLines();
        }
        catch (Exception ex)
        {
            await ShowErrorAsync("生成对比失败", ex.Message);
        }
    }

    private void RenderDiffLines()
    {
        DiffLines.Clear();

        foreach (var line in _currentDiffLines.Where(line => _showFullDiff || line.Kind != "same"))
        {
            DiffLines.Add(line);
        }

        var changedLineCount = _currentDiffLines.Count(line => line.Kind != "same");
        var visibleMode = _showFullDiff ? "全部" : "仅差异";
        DiffSummaryLabel.Text = string.IsNullOrWhiteSpace(_diffBackupLabel)
            ? $"修改对比：{visibleMode}，差异 {changedLineCount} 行"
            : $"修改对比：{_diffBackupLabel} -> 当前编辑内容；{visibleMode}，差异 {changedLineCount} 行";
    }

    private void CloseDiffPanel()
    {
        DiffPanel.IsVisible = false;
        DiffLines.Clear();
        _currentDiffLines.Clear();
        _diffBackupLabel = null;
        _showFullDiff = false;
        ShowFullDiffCheckBox.IsChecked = false;
    }

    private async Task LoadHtmlIntoEditorAsync(string html)
    {
        var siteRootDirectory = GetSiteRootDirectoryForCurrentFile();
        var baseHref = await GetDocumentBaseHrefAsync(siteRootDirectory);
        var siteRootHref = await GetSiteRootHrefAsync(siteRootDirectory);
        var localBaseHref = GetLocalDocumentBaseHref();
        var localSiteRootHref = GetLocalSiteRootHref(siteRootDirectory);
        var previewMode = PreviewCheckBox.IsChecked ? "true" : "false";
        var script = $"window.editorHost.loadHtmlBase64('{ToBase64(html)}','{ToBase64(baseHref)}','{ToBase64(siteRootHref)}','{ToBase64(localBaseHref)}','{ToBase64(localSiteRootHref)}',{previewMode})";
        await EditorWebView.EvaluateJavaScriptAsync(script);
    }

    private async Task<string> GetEditorShellUrlAsync(string fileName)
    {
#if WINDOWS
        if (await TryConfigureVirtualHostFolderMappingAsync(EditorVirtualHostName, _editorRoot!))
        {
            return $"https://{EditorVirtualHostName}/{Uri.EscapeDataString(fileName)}";
        }
#endif
        await Task.CompletedTask;
        return new Uri(Path.Combine(_editorRoot!, fileName)).AbsoluteUri;
    }

    private async Task<string> GetDocumentBaseHrefAsync(string? siteRootDirectory)
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath))
        {
            return string.Empty;
        }

        var directory = Path.GetDirectoryName(_currentFilePath);
        if (string.IsNullOrWhiteSpace(directory))
        {
            return string.Empty;
        }

        await Task.CompletedTask;
#if WINDOWS
        if (!string.IsNullOrWhiteSpace(siteRootDirectory)
            && await TryConfigureVirtualHostFolderMappingAsync(SiteVirtualHostName, siteRootDirectory))
        {
            return BuildVirtualDirectoryHref(SiteVirtualHostName, siteRootDirectory, directory);
        }
#endif
        return GetLocalDocumentBaseHref();
    }

    private async Task<string> GetSiteRootHrefAsync(string? siteRootDirectory)
    {
        if (string.IsNullOrWhiteSpace(siteRootDirectory))
        {
            return string.Empty;
        }

        await Task.CompletedTask;
#if WINDOWS
        if (await TryConfigureVirtualHostFolderMappingAsync(SiteVirtualHostName, siteRootDirectory))
        {
            return $"https://{SiteVirtualHostName}/";
        }
#endif
        return GetLocalSiteRootHref(siteRootDirectory);
    }

    private string GetLocalDocumentBaseHref()
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath))
        {
            return string.Empty;
        }

        var directory = Path.GetDirectoryName(_currentFilePath);
        return string.IsNullOrWhiteSpace(directory)
            ? string.Empty
            : new Uri(directory + Path.DirectorySeparatorChar).AbsoluteUri;
    }

    private static string GetLocalSiteRootHref(string? siteRootDirectory)
    {
        return string.IsNullOrWhiteSpace(siteRootDirectory)
            ? string.Empty
            : new Uri(siteRootDirectory + Path.DirectorySeparatorChar).AbsoluteUri;
    }

    private string? GetSiteRootDirectoryForCurrentFile()
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath))
        {
            return null;
        }

        var currentDirectory = GetCurrentFileDirectory();
        var workspaceDirectory = GetWorkspaceDirectoryForCurrentFile();

        return FindNearestStaticSiteRoot(currentDirectory, workspaceDirectory)
            ?? workspaceDirectory
            ?? currentDirectory;
    }

    private string? GetWorkspaceDirectoryForCurrentFile()
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath) || string.IsNullOrWhiteSpace(_workspacePath))
        {
            return null;
        }

        var workspaceDirectory = Path.GetFullPath(_workspacePath);
        var workspacePrefix = workspaceDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var currentFile = Path.GetFullPath(_currentFilePath);

        return currentFile.StartsWith(workspacePrefix, StringComparison.OrdinalIgnoreCase)
            ? workspaceDirectory
            : null;
    }

    private static string? FindNearestStaticSiteRoot(string startDirectory, string? stopDirectory)
    {
        if (string.IsNullOrWhiteSpace(startDirectory))
        {
            return null;
        }

        var current = new DirectoryInfo(Path.GetFullPath(startDirectory));
        var stop = string.IsNullOrWhiteSpace(stopDirectory)
            ? null
            : Path.GetFullPath(stopDirectory);

        while (current is not null)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "assets")))
            {
                return current.FullName;
            }

            if (stop is not null && string.Equals(current.FullName, stop, StringComparison.OrdinalIgnoreCase))
            {
                break;
            }

            current = current.Parent;
        }

        return null;
    }

    private string GetCurrentFileDirectory()
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath))
        {
            return string.Empty;
        }

        return Path.GetDirectoryName(_currentFilePath) ?? string.Empty;
    }

    private static string BuildVirtualDirectoryHref(string hostName, string rootDirectory, string directory)
    {
        var fullRoot = Path.GetFullPath(rootDirectory);
        var fullDirectory = Path.GetFullPath(directory);
        if (!IsSameOrChildPath(fullDirectory, fullRoot))
        {
            return $"https://{hostName}/";
        }

        var relativePath = Path.GetRelativePath(fullRoot, fullDirectory);
        if (relativePath == ".")
        {
            return $"https://{hostName}/";
        }

        var segments = relativePath
            .Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries)
            .Where(segment => segment != ".")
            .Select(Uri.EscapeDataString);
        var virtualPath = string.Join("/", segments);

        return string.IsNullOrWhiteSpace(virtualPath)
            ? $"https://{hostName}/"
            : $"https://{hostName}/{virtualPath}/";
    }

    private static bool IsSameOrChildPath(string path, string directory)
    {
        var fullPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var fullDirectory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

        return string.Equals(fullPath, fullDirectory, StringComparison.OrdinalIgnoreCase)
            || fullPath.StartsWith(fullDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private async Task SaveCurrentFileAsync()
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath))
        {
            await SaveAsAsync();
            return;
        }

        try
        {
            var html = await GetEditorHtmlAsync();
            await _documentService.SaveAsync(_currentFilePath, html, BackupCheckBox.IsChecked);
            var gitMessage = await TryCommitAsync(_currentFilePath);
            var message = JoinStatus($"已保存 {Path.GetFileName(_currentFilePath)}", gitMessage);
            await ShowInfoAsync("保存成功", message);
        }
        catch (Exception ex)
        {
            await ShowErrorAsync("保存失败", ex.Message);
        }
    }

    private async Task SaveAsAsync()
    {
        var path = await PickSaveFileAsync();
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        try
        {
            var html = await GetEditorHtmlAsync();
            await _documentService.SaveAsync(path, html, BackupCheckBox.IsChecked);
            _currentFilePath = path;

            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                if (string.IsNullOrWhiteSpace(_workspacePath) || !path.StartsWith(_workspacePath, StringComparison.OrdinalIgnoreCase))
                {
                    await LoadWorkspaceAsync(directory);
                }
                else
                {
                    await LoadWorkspaceAsync(_workspacePath);
                }
            }

            var gitMessage = await TryCommitAsync(path);
            var message = JoinStatus($"已另存为 {Path.GetFileName(path)}", gitMessage);
            await ShowInfoAsync("保存成功", message);
        }
        catch (Exception ex)
        {
            await ShowErrorAsync("另存为失败", ex.Message);
        }
    }

    private async Task RestoreBackupAsync()
    {
        if (string.IsNullOrWhiteSpace(_currentFilePath))
        {
            SetStatus("请先打开要还原的文件");
            return;
        }

        var backups = _documentService.GetBackups(_currentFilePath);
        if (backups.Count == 0)
        {
            await ShowInfoAsync("没有可还原的备份", "当前文件还没有保存过的备份。");
            return;
        }

        var choices = backups
            .Select((backup, index) => FormatBackupChoice(backup, index))
            .ToArray();

        var selected = await DisplayActionSheetAsync("选择要还原的备份", "取消", null, choices);
        if (string.IsNullOrWhiteSpace(selected) || selected == "取消")
        {
            return;
        }

        var selectedIndex = Array.IndexOf(choices, selected);
        if (selectedIndex < 0)
        {
            return;
        }

        var selectedBackup = backups[selectedIndex];
        var confirmed = await DisplayAlertAsync(
            "确认还原",
            $"将使用所选备份覆盖当前文件：{Path.GetFileName(_currentFilePath)}",
            "还原",
            "取消");
        if (!confirmed)
        {
            return;
        }

        try
        {
            await _documentService.RestoreBackupAsync(_currentFilePath, selectedBackup.FullPath);
            await LoadFileAsync(_currentFilePath);
            var gitMessage = await TryCommitAsync(_currentFilePath);
            var message = JoinStatus($"已还原 {Path.GetFileName(_currentFilePath)}", gitMessage);
            await ShowInfoAsync("还原成功", message);
        }
        catch (Exception ex)
        {
            await ShowErrorAsync("还原失败", ex.Message);
        }
    }

    private async Task<string> GetEditorHtmlAsync()
    {
        if (!_editorReady)
        {
            throw new InvalidOperationException("编辑器尚未加载完成");
        }

        var base64Json = await EditorWebView.EvaluateJavaScriptAsync("window.editorHost.getHtmlBase64()");
        var base64 = DecodeJavaScriptString(base64Json);
        return FromBase64(base64);
    }

    private async Task ExecuteEditorCommandAsync(string script)
    {
        if (!_editorReady)
        {
            SetStatus("编辑器尚未加载完成");
            return;
        }

        await EditorWebView.EvaluateJavaScriptAsync(script);
    }

    private async Task<string?> TryCommitAsync(string filePath)
    {
        if (string.IsNullOrWhiteSpace(_workspacePath))
        {
            return null;
        }

        if (!Directory.Exists(Path.Combine(_workspacePath, ".git")) || !await _gitService.IsGitAvailableAsync())
        {
            return null;
        }

        var result = await _gitService.CommitFileAsync(_workspacePath, filePath);
        if (!result.Success)
        {
            return $"Git 提交失败: {result.Message}";
        }

        return result.Message;
    }

    private static string JoinStatus(string primary, string? secondary)
    {
        return string.IsNullOrWhiteSpace(secondary)
            ? primary
            : $"{primary}；{secondary}";
    }

    private static string FormatBackupChoice(HtmlBackupInfo backup, int index)
    {
        return $"{index + 1}. {backup.CreatedAt:yyyy-MM-dd HH:mm:ss}  {FormatFileSize(backup.Size)}";
    }

    private static string FormatFileSize(long size)
    {
        if (size < 1024)
        {
            return $"{size} B";
        }

        var kilobytes = size / 1024d;
        if (kilobytes < 1024)
        {
            return $"{kilobytes:0.#} KB";
        }

        var megabytes = kilobytes / 1024d;
        return $"{megabytes:0.#} MB";
    }

    private static IReadOnlyList<FileDiffLine> BuildDiffLines(string oldText, string newText)
    {
        var oldLines = SplitLines(oldText);
        var newLines = SplitLines(newText);
        var diff = new List<FileDiffLine>();

        if ((long)oldLines.Length * newLines.Length > 4_000_000)
        {
            return BuildSimpleDiffLines(oldLines, newLines);
        }

        var lengths = new int[oldLines.Length + 1, newLines.Length + 1];
        for (var oldIndex = oldLines.Length - 1; oldIndex >= 0; oldIndex--)
        {
            for (var newIndex = newLines.Length - 1; newIndex >= 0; newIndex--)
            {
                lengths[oldIndex, newIndex] = oldLines[oldIndex] == newLines[newIndex]
                    ? lengths[oldIndex + 1, newIndex + 1] + 1
                    : Math.Max(lengths[oldIndex + 1, newIndex], lengths[oldIndex, newIndex + 1]);
            }
        }

        var i = 0;
        var j = 0;
        while (i < oldLines.Length || j < newLines.Length)
        {
            if (i < oldLines.Length && j < newLines.Length && oldLines[i] == newLines[j])
            {
                diff.Add(CreateDiffLine("same", " ", i + 1, j + 1, oldLines[i], newLines[j]));
                i++;
                j++;
            }
            else if (j < newLines.Length && (i == oldLines.Length || lengths[i, j + 1] >= lengths[i + 1, j]))
            {
                diff.Add(CreateDiffLine("added", "+", null, j + 1, "", newLines[j]));
                j++;
            }
            else if (i < oldLines.Length)
            {
                diff.Add(CreateDiffLine("removed", "-", i + 1, null, oldLines[i], ""));
                i++;
            }
        }

        return diff;
    }

    private static IReadOnlyList<FileDiffLine> BuildSimpleDiffLines(string[] oldLines, string[] newLines)
    {
        var diff = new List<FileDiffLine>();
        var count = Math.Max(oldLines.Length, newLines.Length);
        for (var index = 0; index < count; index++)
        {
            var hasOld = index < oldLines.Length;
            var hasNew = index < newLines.Length;
            if (hasOld && hasNew && oldLines[index] == newLines[index])
            {
                diff.Add(CreateDiffLine("same", " ", index + 1, index + 1, oldLines[index], newLines[index]));
            }
            else
            {
                if (hasOld)
                {
                    diff.Add(CreateDiffLine("removed", "-", index + 1, null, oldLines[index], ""));
                }

                if (hasNew)
                {
                    diff.Add(CreateDiffLine("added", "+", null, index + 1, "", newLines[index]));
                }
            }
        }

        return diff;
    }

    private static FileDiffLine CreateDiffLine(
        string kind,
        string symbol,
        int? oldLineNumber,
        int? newLineNumber,
        string oldText,
        string newText)
    {
        var background = kind switch
        {
            "added" => Color.FromArgb("#EAF8EF"),
            "removed" => Color.FromArgb("#FDECEC"),
            _ => Colors.White
        };
        var textColor = kind switch
        {
            "added" => Color.FromArgb("#116329"),
            "removed" => Color.FromArgb("#9E1C1C"),
            _ => Color.FromArgb("#263238")
        };

        return new FileDiffLine
        {
            Kind = kind,
            Symbol = symbol,
            OldLineNumber = oldLineNumber?.ToString() ?? "",
            NewLineNumber = newLineNumber?.ToString() ?? "",
            OldText = oldText,
            NewText = newText,
            BackgroundColor = background,
            TextColor = textColor
        };
    }

    private static string[] SplitLines(string value)
    {
        return value.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
    }

    private static string DecodeJavaScriptString(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        try
        {
            return JsonSerializer.Deserialize<string>(value) ?? string.Empty;
        }
        catch (JsonException)
        {
            return value.Trim('"');
        }
    }

    private static string ToBase64(string value)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value));
    }

    private static string FromBase64(string value)
    {
        return Encoding.UTF8.GetString(Convert.FromBase64String(value));
    }

    private static string EscapeJavaScriptString(string value)
    {
        return value
            .Replace("\\", "\\\\")
            .Replace("'", "\\'");
    }

    private void UpdateModeChrome()
    {
        var isPreview = PreviewCheckBox.IsChecked;
        var isContentTools = _editorMode == EditorMode.ContentTools;
        ContentToolsToolbar.IsVisible = isContentTools && !isPreview;
        DeleteButton.IsVisible = isContentTools && !isPreview;
        UndoButton.IsEnabled = !isPreview;
        RedoButton.IsEnabled = !isPreview;
    }

    private void UpdateSidebarChrome()
    {
        SidebarColumn.Width = _sidebarVisible ? new GridLength(320) : new GridLength(0);
        SidebarSeparatorColumn.Width = _sidebarVisible ? new GridLength(1) : new GridLength(0);
        SidebarPanel.IsVisible = _sidebarVisible;
        SidebarSeparator.IsVisible = _sidebarVisible;
        ToggleSidebarButton.Text = _sidebarVisible ? "隐藏左侧" : "显示左侧";
    }

    private void SetStatus(string message)
    {
        StatusLabel.Text = message;
    }

    private Task ShowErrorAsync(string title, string message)
    {
        SetStatus(message);
        return DisplayAlertAsync(title, message, "确定");
    }

    private Task ShowInfoAsync(string title, string message)
    {
        SetStatus(message);
        return DisplayAlertAsync(title, message, "确定");
    }

    private async Task<string?> PickFolderAsync()
    {
#if WINDOWS
        var picker = new FolderPicker();
        picker.FileTypeFilter.Add("*");
        InitializePicker(picker);
        var folder = await picker.PickSingleFolderAsync();
        return folder?.Path;
#else
        await Task.CompletedTask;
        return null;
#endif
    }

    private async Task<string?> PickSaveFileAsync()
    {
#if WINDOWS
        var picker = new FileSavePicker
        {
            SuggestedFileName = string.IsNullOrWhiteSpace(_currentFilePath)
                ? "untitled.html"
                : Path.GetFileNameWithoutExtension(_currentFilePath)
        };
        picker.FileTypeChoices.Add("HTML 文件", [".html", ".htm"]);
        InitializePicker(picker);
        var file = await picker.PickSaveFileAsync();
        return file?.Path;
#else
        await Task.CompletedTask;
        return null;
#endif
    }

#if WINDOWS
    private void InitializePicker(object picker)
    {
        var window = GetParentWindow().Handler.PlatformView as Microsoft.UI.Xaml.Window;
        var hwnd = WindowNative.GetWindowHandle(window);
        InitializeWithWindow.Initialize(picker, hwnd);
    }

    private void RegisterKeyboardShortcuts()
    {
        var window = GetParentWindow().Handler?.PlatformView as Microsoft.UI.Xaml.Window;
        if (window?.Content is not Microsoft.UI.Xaml.UIElement root)
        {
            return;
        }

        root.KeyDown -= OnRootKeyDown;
        root.KeyDown += OnRootKeyDown;
    }

    private void RegisterWebViewMessages()
    {
        if (_webMessageHooked)
        {
            return;
        }

        if (EditorWebView.Handler?.PlatformView is not Microsoft.UI.Xaml.Controls.WebView2 webView2
            || webView2.CoreWebView2 is null)
        {
            return;
        }

        webView2.CoreWebView2.WebMessageReceived -= OnEditorWebMessageReceived;
        webView2.CoreWebView2.WebMessageReceived += OnEditorWebMessageReceived;
        _webMessageHooked = true;
    }

    private async Task<bool> TryConfigureVirtualHostFolderMappingAsync(string hostName, string folderPath)
    {
        if (EditorWebView.Handler?.PlatformView is not Microsoft.UI.Xaml.Controls.WebView2 webView2
            || string.IsNullOrWhiteSpace(folderPath)
            || !Directory.Exists(folderPath))
        {
            return false;
        }

        await webView2.EnsureCoreWebView2Async();
        var coreWebView = webView2.CoreWebView2;
        var fullFolderPath = Path.GetFullPath(folderPath);
        _virtualHostFolders[hostName] = fullFolderPath;

        if (_virtualHostFilters.Add(hostName))
        {
            coreWebView.AddWebResourceRequestedFilter(
                $"https://{hostName}/*",
                CoreWebView2WebResourceContext.All);
        }

        if (!_webResourceRequestHooked)
        {
            coreWebView.WebResourceRequested += OnVirtualHostWebResourceRequested;
            _webResourceRequestHooked = true;
        }

        coreWebView.SetVirtualHostNameToFolderMapping(
            hostName,
            fullFolderPath,
            CoreWebView2HostResourceAccessKind.Allow);

        return true;
    }

    private void OnVirtualHostWebResourceRequested(CoreWebView2 sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        try
        {
            var requestUri = new Uri(args.Request.Uri);
            if (!_virtualHostFolders.TryGetValue(requestUri.Host, out var rootPath))
            {
                return;
            }

            var filePath = ResolveVirtualHostFilePath(rootPath, requestUri);
            if (filePath is null)
            {
                args.Response = CreateTextResponse(sender, 404, "Not Found");
                return;
            }

            var content = new MemoryStream(File.ReadAllBytes(filePath), writable: false).AsRandomAccessStream();
            var headers = $"Content-Type: {GetContentType(filePath)}\r\nCache-Control: no-store";
            args.Response = sender.Environment.CreateWebResourceResponse(content, 200, "OK", headers);
        }
        catch
        {
            args.Response = CreateTextResponse(sender, 500, "Internal Server Error");
        }
    }

    private static string? ResolveVirtualHostFilePath(string rootPath, Uri requestUri)
    {
        var relativePath = Uri.UnescapeDataString(requestUri.AbsolutePath.TrimStart('/'))
            .Replace('/', Path.DirectorySeparatorChar);
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            relativePath = "index.html";
        }

        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));
        if (Directory.Exists(fullPath))
        {
            fullPath = Path.Combine(fullPath, "index.html");
        }

        return IsSameOrChildPath(fullPath, rootPath) && File.Exists(fullPath)
            ? fullPath
            : null;
    }

    private static CoreWebView2WebResourceResponse CreateTextResponse(
        CoreWebView2 sender,
        int statusCode,
        string reasonPhrase)
    {
        var content = new MemoryStream(Encoding.UTF8.GetBytes(reasonPhrase), writable: false).AsRandomAccessStream();
        return sender.Environment.CreateWebResourceResponse(
            content,
            statusCode,
            reasonPhrase,
            "Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-store");
    }

    private static string GetContentType(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".html" or ".htm" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "application/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".ico" => "image/x-icon",
            ".avif" => "image/avif",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            ".ttf" => "font/ttf",
            ".otf" => "font/otf",
            ".mp4" => "video/mp4",
            ".webm" => "video/webm",
            ".mp3" => "audio/mpeg",
            ".wav" => "audio/wav",
            _ => "application/octet-stream"
        };
    }

    private async void OnEditorWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        var command = args.TryGetWebMessageAsString();
        switch (command)
        {
            case "save":
                await SaveCurrentFileAsync();
                break;
            case "saveAs":
                await SaveAsAsync();
                break;
            case "openFolder":
                OnOpenFolderClicked(this, EventArgs.Empty);
                break;
            case "reload":
                OnReloadClicked(this, EventArgs.Empty);
                break;
        }
    }

    private async void OnRootKeyDown(object sender, KeyRoutedEventArgs e)
    {
        var ctrl = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Control)
            .HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
        var shift = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Shift)
            .HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);

        if (!ctrl)
        {
            return;
        }

        switch (e.Key)
        {
            case Windows.System.VirtualKey.S:
                e.Handled = true;
                if (shift)
                {
                    await SaveAsAsync();
                }
                else
                {
                    await SaveCurrentFileAsync();
                }
                break;
            case Windows.System.VirtualKey.O:
                e.Handled = true;
                OnOpenFolderClicked(this, EventArgs.Empty);
                break;
            case Windows.System.VirtualKey.R:
                e.Handled = true;
                OnReloadClicked(this, EventArgs.Empty);
                break;
            case Windows.System.VirtualKey.Z:
                e.Handled = true;
                await ExecuteEditorCommandAsync("window.editorHost.undo()");
                break;
            case Windows.System.VirtualKey.Y:
                e.Handled = true;
                await ExecuteEditorCommandAsync("window.editorHost.redo()");
                break;
        }
    }
#else
    private void RegisterKeyboardShortcuts()
    {
    }
#endif
}
