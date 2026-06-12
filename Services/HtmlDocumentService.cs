using System.Text;

namespace HtmlEditor.Services;

public sealed class HtmlDocumentService
{
    public async Task<string> ReadAsync(string path)
    {
        return await File.ReadAllTextAsync(path, Encoding.UTF8);
    }

    public async Task SaveAsync(string path, string content, bool createBackup)
    {
        if (createBackup && File.Exists(path))
        {
            var backupDirectory = Path.Combine(Path.GetDirectoryName(path)!, ".html-editor-backups");
            Directory.CreateDirectory(backupDirectory);
            var backupName = $"{Path.GetFileName(path)}.{DateTime.Now:yyyyMMddHHmmss}.bak";
            File.Copy(path, Path.Combine(backupDirectory, backupName), overwrite: true);
        }

        await File.WriteAllTextAsync(path, content, Encoding.UTF8);
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
}
