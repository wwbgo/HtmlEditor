using System.Diagnostics;
using System.ComponentModel;

namespace HtmlEditor.Services;

public sealed class GitService
{
    public async Task<bool> IsGitAvailableAsync()
    {
        var result = await RunGitAsync("--version", null);
        return result.ExitCode == 0;
    }

    public async Task<GitResult> InitRepositoryAsync(string rootPath)
    {
        var result = await RunGitAsync("init", rootPath);
        return result.ExitCode == 0
            ? new GitResult(true, result.Output)
            : new GitResult(false, result.Output);
    }

    public async Task<GitResult> CommitFileAsync(string rootPath, string filePath)
    {
        if (!Directory.Exists(Path.Combine(rootPath, ".git")))
        {
            return new GitResult(false, "当前文件夹不是 Git 仓库");
        }

        var relativePath = Path.GetRelativePath(rootPath, filePath).Replace('\\', '/');
        var add = await RunGitAsync($"add -- \"{relativePath}\"", rootPath);
        if (add.ExitCode != 0)
        {
            return new GitResult(false, add.Output);
        }

        var message = $"Save {relativePath} {DateTime.Now:yyyy-MM-dd HH:mm:ss}";
        var commit = await RunGitAsync($"commit -m \"{message}\" -- \"{relativePath}\"", rootPath);
        if (commit.ExitCode == 0)
        {
            return new GitResult(true, "Git 已提交更改");
        }

        if (commit.Output.Contains("nothing to commit", StringComparison.OrdinalIgnoreCase)
            || commit.Output.Contains("no changes added", StringComparison.OrdinalIgnoreCase))
        {
            return new GitResult(true, "文件无 Git 变更");
        }

        return new GitResult(false, commit.Output);
    }

    private static async Task<ProcessResult> RunGitAsync(string arguments, string? workingDirectory)
    {
        try
        {
            var info = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = arguments,
                WorkingDirectory = workingDirectory ?? Environment.CurrentDirectory,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(info);
            if (process is null)
            {
                return new ProcessResult(-1, "无法启动 git");
            }

            var output = await process.StandardOutput.ReadToEndAsync();
            var error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            return new ProcessResult(process.ExitCode, string.Join(Environment.NewLine, output, error).Trim());
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            return new ProcessResult(-1, ex.Message);
        }
    }

    private sealed record ProcessResult(int ExitCode, string Output);
}

public sealed record GitResult(bool Success, string Message);
