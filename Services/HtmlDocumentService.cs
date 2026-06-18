using System.Globalization;
using System.Text;

namespace HtmlEditor.Services;

public sealed class HtmlDocumentService
{
    private const string BackupDirectoryName = ".html-editor-backups";

    public async Task<string> ReadAsync(string path)
    {
        return await File.ReadAllTextAsync(path, Encoding.UTF8);
    }

    public async Task SaveAsync(string path, string content, bool createBackup)
    {
        var newline = File.Exists(path)
            ? await DetectNewLineAsync(path)
            : Environment.NewLine;

        if (createBackup && File.Exists(path))
        {
            await CreateBackupAsync(path);
        }

        await File.WriteAllTextAsync(path, NormalizeNewLines(content, newline), Encoding.UTF8);
    }

    public IReadOnlyList<HtmlBackupInfo> GetBackups(string path)
    {
        var backupDirectory = GetBackupDirectory(path);
        if (!Directory.Exists(backupDirectory))
        {
            return [];
        }

        var fileName = Path.GetFileName(path);
        var prefix = $"{fileName}.";

        try
        {
            return Directory.EnumerateFiles(backupDirectory, $"{fileName}.*.bak")
                .Where(file => IsBackupForFile(file, prefix))
                .Select(file => CreateBackupInfo(file, prefix))
                .Where(backup => backup is not null)
                .Select(backup => backup!)
                .OrderByDescending(backup => backup.CreatedAt)
                .ThenByDescending(backup => backup.FullPath, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch (IOException)
        {
            return [];
        }
        catch (UnauthorizedAccessException)
        {
            return [];
        }
    }

    public async Task RestoreBackupAsync(string path, string backupPath)
    {
        if (!File.Exists(backupPath))
        {
            throw new FileNotFoundException("备份文件不存在", backupPath);
        }

        EnsureBackupBelongsToFile(path, backupPath);

        var directory = Path.GetDirectoryName(path);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new InvalidOperationException("目标文件路径无效");
        }

        Directory.CreateDirectory(directory);

        await using var input = File.OpenRead(backupPath);
        await using var output = File.Create(path);
        await input.CopyToAsync(output);
    }

    public async Task<string> CreateNewHtmlAsync(string directory)
    {
        Directory.CreateDirectory(directory);

        var index = 1;
        string path;
        do
        {
            path = Path.Combine(directory, $"untitled-{index}.html");
            index++;
        }
        while (File.Exists(path));

        var content = """
            <!doctype html>
            <html lang="zh-CN">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>Untitled</title>
            </head>
            <body>
              <main>
                <h1>新建页面</h1>
                <p>开始编辑 HTML 内容。</p>
              </main>
            </body>
            </html>
            """;

        await File.WriteAllTextAsync(path, content, Encoding.UTF8);
        return path;
    }

    private async Task<HtmlBackupInfo> CreateBackupAsync(string path, string? content = null)
    {
        var backupDirectory = GetBackupDirectory(path);
        Directory.CreateDirectory(backupDirectory);

        var backupPath = GetUniqueBackupPath(path, backupDirectory);
        if (content is null)
        {
            File.Copy(path, backupPath);
        }
        else
        {
            await File.WriteAllTextAsync(backupPath, NormalizeNewLines(content, Environment.NewLine), Encoding.UTF8);
        }

        return CreateBackupInfo(backupPath, $"{Path.GetFileName(path)}.")!;
    }

    private static async Task<string> DetectNewLineAsync(string path)
    {
        var content = await File.ReadAllTextAsync(path, Encoding.UTF8);
        var crlfCount = CountOccurrences(content, "\r\n");
        var lfCount = CountLineFeedOnly(content);
        var crCount = CountCarriageReturnOnly(content);

        if (crlfCount == 0 && lfCount == 0 && crCount == 0)
        {
            return Environment.NewLine;
        }

        if (crlfCount >= lfCount && crlfCount >= crCount)
        {
            return "\r\n";
        }

        return lfCount >= crCount ? "\n" : "\r";
    }

    private static string NormalizeNewLines(string content, string newline)
    {
        return content
            .Replace("\r\n", "\n")
            .Replace('\r', '\n')
            .Replace("\n", newline);
    }

    private static int CountOccurrences(string content, string value)
    {
        var count = 0;
        var index = 0;
        while ((index = content.IndexOf(value, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += value.Length;
        }

        return count;
    }

    private static int CountLineFeedOnly(string content)
    {
        var count = 0;
        for (var index = 0; index < content.Length; index++)
        {
            if (content[index] == '\n' && (index == 0 || content[index - 1] != '\r'))
            {
                count++;
            }
        }

        return count;
    }

    private static int CountCarriageReturnOnly(string content)
    {
        var count = 0;
        for (var index = 0; index < content.Length; index++)
        {
            if (content[index] == '\r' && (index + 1 >= content.Length || content[index + 1] != '\n'))
            {
                count++;
            }
        }

        return count;
    }

    private static string GetBackupDirectory(string path)
    {
        var directory = Path.GetDirectoryName(path);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new InvalidOperationException("目标文件路径无效");
        }

        return Path.Combine(directory, BackupDirectoryName);
    }

    private static string GetUniqueBackupPath(string path, string backupDirectory)
    {
        var timestamp = DateTime.Now.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture);
        var fileName = Path.GetFileName(path);
        var backupPath = Path.Combine(backupDirectory, $"{fileName}.{timestamp}.bak");

        for (var index = 1; File.Exists(backupPath); index++)
        {
            backupPath = Path.Combine(backupDirectory, $"{fileName}.{timestamp}-{index}.bak");
        }

        return backupPath;
    }

    private static bool IsBackupForFile(string backupPath, string prefix)
    {
        var backupFileName = Path.GetFileName(backupPath);
        return backupFileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            && backupFileName.EndsWith(".bak", StringComparison.OrdinalIgnoreCase);
    }

    private static HtmlBackupInfo? CreateBackupInfo(string backupPath, string prefix)
    {
        try
        {
            var info = new FileInfo(backupPath);
            var createdAt = TryParseBackupTimestamp(Path.GetFileName(backupPath), prefix) ?? info.LastWriteTime;
            return new HtmlBackupInfo(backupPath, createdAt, info.Length);
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static DateTime? TryParseBackupTimestamp(string backupFileName, string prefix)
    {
        const string suffix = ".bak";
        if (!backupFileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            || !backupFileName.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var timestamp = backupFileName[prefix.Length..^suffix.Length].Split('-', 2)[0];
        if (DateTime.TryParseExact(timestamp, "yyyyMMddHHmmss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var createdAt))
        {
            return createdAt;
        }

        return null;
    }

    private static void EnsureBackupBelongsToFile(string path, string backupPath)
    {
        var backupDirectory = Path.GetFullPath(GetBackupDirectory(path)) + Path.DirectorySeparatorChar;
        var selectedBackup = Path.GetFullPath(backupPath);
        if (!selectedBackup.StartsWith(backupDirectory, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("备份文件不属于当前文件");
        }

        var prefix = $"{Path.GetFileName(path)}.";
        if (!IsBackupForFile(selectedBackup, prefix))
        {
            throw new InvalidOperationException("备份文件不属于当前文件");
        }
    }
}

public sealed record HtmlBackupInfo(string FullPath, DateTime CreatedAt, long Size);
