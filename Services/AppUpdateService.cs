using System.Net.Http.Headers;
using System.Text.Json;

namespace HtmlEditor.Services;

public sealed class AppUpdateService
{
    private const string LatestReleaseApiUrl = "https://api.github.com/repos/wwbgo/HtmlEditor/releases/latest";
    private const string FallbackReleaseUrl = "https://github.com/wwbgo/HtmlEditor/releases/latest";
    private readonly HttpClient _httpClient;

    public AppUpdateService()
    {
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("HtmlEditor-Updater");
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
    }

    public async Task<AppUpdateInfo?> CheckForUpdateAsync(string currentVersion, CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.GetAsync(LatestReleaseApiUrl, cancellationToken);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var release = document.RootElement;
        var tagName = GetString(release, "tag_name");
        var latestVersion = NormalizeVersion(tagName);

        if (string.IsNullOrWhiteSpace(latestVersion) || !IsNewerVersion(latestVersion, currentVersion))
        {
            return null;
        }

        var asset = FindInstallerAsset(release);
        return new AppUpdateInfo(
            latestVersion,
            GetString(release, "name") ?? $"HtmlEditor {latestVersion}",
            GetString(release, "html_url") ?? FallbackReleaseUrl,
            asset?.Name,
            asset?.DownloadUrl);
    }

    public async Task<string> DownloadInstallerAsync(
        AppUpdateInfo update,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(update.InstallerDownloadUrl))
        {
            throw new InvalidOperationException("最新版本没有可下载的安装包。");
        }

        var updatesDirectory = Path.Combine(Path.GetTempPath(), "HtmlEditor", "Updates");
        Directory.CreateDirectory(updatesDirectory);
        var installerName = SanitizeFileName(update.InstallerName ?? $"HtmlEditor-Setup-{update.Version}-win-x64.exe");
        var installerPath = Path.Combine(updatesDirectory, installerName);

        using var response = await _httpClient.GetAsync(
            update.InstallerDownloadUrl,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        response.EnsureSuccessStatusCode();

        var totalBytes = response.Content.Headers.ContentLength;
        await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = File.Create(installerPath);

        var buffer = new byte[81920];
        long downloadedBytes = 0;
        while (true)
        {
            var read = await input.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                break;
            }

            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            downloadedBytes += read;

            if (totalBytes is > 0)
            {
                progress?.Report((double)downloadedBytes / totalBytes.Value);
            }
        }

        progress?.Report(1);
        return installerPath;
    }

    private static (string Name, string DownloadUrl)? FindInstallerAsset(JsonElement release)
    {
        if (!release.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        (string Name, string DownloadUrl)? fallback = null;
        foreach (var asset in assets.EnumerateArray())
        {
            var name = GetString(asset, "name");
            var downloadUrl = GetString(asset, "browser_download_url");
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(downloadUrl))
            {
                continue;
            }

            if (!name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            fallback ??= (name, downloadUrl);
            if (name.StartsWith("HtmlEditor-Setup-", StringComparison.OrdinalIgnoreCase)
                && name.Contains("win-x64", StringComparison.OrdinalIgnoreCase))
            {
                return (name, downloadUrl);
            }
        }

        return fallback;
    }

    private static string? GetString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static bool IsNewerVersion(string latestVersion, string currentVersion)
    {
        return ToVersion(latestVersion).CompareTo(ToVersion(currentVersion)) > 0;
    }

    private static Version ToVersion(string value)
    {
        var numbers = NormalizeVersion(value)
            .Split('.', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => int.TryParse(part, out var number) ? number : 0)
            .Take(4)
            .ToList();

        while (numbers.Count < 4)
        {
            numbers.Add(0);
        }

        return new Version(numbers[0], numbers[1], numbers[2], numbers[3]);
    }

    private static string NormalizeVersion(string? value)
    {
        var source = (value ?? string.Empty).Trim().TrimStart('v', 'V');
        var parts = source
            .Split(['.', '-', '+'], StringSplitOptions.RemoveEmptyEntries)
            .Where(part => part.All(char.IsDigit))
            .Take(4)
            .ToArray();

        return parts.Length == 0 ? string.Empty : string.Join(".", parts);
    }

    private static string SanitizeFileName(string fileName)
    {
        var invalidChars = Path.GetInvalidFileNameChars();
        return string.Concat(fileName.Select(ch => invalidChars.Contains(ch) ? '_' : ch));
    }
}

public sealed record AppUpdateInfo(
    string Version,
    string ReleaseName,
    string ReleaseUrl,
    string? InstallerName,
    string? InstallerDownloadUrl)
{
    public bool HasInstaller => !string.IsNullOrWhiteSpace(InstallerDownloadUrl);
}
