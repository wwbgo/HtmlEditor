using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace HtmlEditor.Models;

public sealed class FileTreeNode : INotifyPropertyChanged
{
    private bool _isExpanded = true;

    public string DisplayName { get; init; } = string.Empty;
    public string FullPath { get; init; } = string.Empty;
    public bool IsDirectory { get; init; }
    public int Depth { get; init; }
    public List<FileTreeNode> Children { get; } = [];
    public FileTreeNode? Parent { get; init; }

    public bool IsExpanded
    {
        get => _isExpanded;
        set
        {
            if (_isExpanded == value)
            {
                return;
            }

            _isExpanded = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsOpenDirectory));
            OnPropertyChanged(nameof(IsClosedDirectory));
        }
    }

    public bool CanToggle => IsDirectory && Children.Count > 0;
    public bool IsFile => !IsDirectory;
    public bool IsOpenDirectory => IsDirectory && IsExpanded;
    public bool IsClosedDirectory => IsDirectory && !IsExpanded;
    public string Prefix => string.Empty;
    public double Indent => Depth * 18;
    public string TextColor => IsDirectory ? "#20242A" : "#344054";

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
