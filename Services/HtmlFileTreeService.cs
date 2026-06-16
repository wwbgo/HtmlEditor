using HtmlEditor.Models;

namespace HtmlEditor.Services;

public sealed class HtmlFileTreeService
{
    private static readonly HashSet<string> HtmlExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".html",
        ".htm"
    };

    public List<FileTreeNode> Load(string rootPath)
    {
        if (!Directory.Exists(rootPath))
        {
            return [];
        }

        var root = BuildDirectory(rootPath, null, -1);
        return root.Children;
    }

    private static FileTreeNode BuildDirectory(string path, FileTreeNode? parent, int depth)
    {
        var node = new FileTreeNode
        {
            DisplayName = parent is null ? path : Path.GetFileName(path),
            FullPath = path,
            IsDirectory = true,
            IsExpanded = parent is null,
            Depth = depth,
            Parent = parent
        };

        foreach (var directory in EnumerateDirectories(path))
        {
            var child = BuildDirectory(directory, node, depth + 1);
            if (child.Children.Count > 0)
            {
                node.Children.Add(child);
            }
        }

        foreach (var file in EnumerateHtmlFiles(path))
        {
            node.Children.Add(new FileTreeNode
            {
                DisplayName = Path.GetFileName(file),
                FullPath = file,
                IsDirectory = false,
                Depth = depth + 1,
                Parent = node
            });
        }

        return node;
    }

    private static IEnumerable<string> EnumerateDirectories(string path)
    {
        try
        {
            return Directory.EnumerateDirectories(path)
                .Where(directory => !ShouldSkipDirectory(directory))
                .OrderBy(directory => Path.GetFileName(directory), StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch (UnauthorizedAccessException)
        {
            return [];
        }
        catch (IOException)
        {
            return [];
        }
    }

    private static IEnumerable<string> EnumerateHtmlFiles(string path)
    {
        try
        {
            return Directory.EnumerateFiles(path)
                .Where(file => HtmlExtensions.Contains(Path.GetExtension(file)))
                .OrderBy(file => Path.GetFileName(file), StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch (UnauthorizedAccessException)
        {
            return [];
        }
        catch (IOException)
        {
            return [];
        }
    }

    private static bool ShouldSkipDirectory(string path)
    {
        var name = Path.GetFileName(path);
        return name.Equals(".git", StringComparison.OrdinalIgnoreCase)
            || name.Equals("node_modules", StringComparison.OrdinalIgnoreCase)
            || name.Equals("bin", StringComparison.OrdinalIgnoreCase)
            || name.Equals("obj", StringComparison.OrdinalIgnoreCase);
    }
}
