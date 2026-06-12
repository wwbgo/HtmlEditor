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
            OnPropertyChanged(nameof(ToggleGlyph));
            OnPropertyChanged(nameof(IconGlyph));
        }
    }

    public bool CanToggle => IsDirectory && Children.Count > 0;
    public string ToggleGlyph => !CanToggle ? string.Empty : IsExpanded ? "\uE70D" : "\uE76C";
    public string IconGlyph => IsDirectory ? IsExpanded ? "\uED25" : "\uE8B7" : "\uE7C3";
    public string IconColor => IsDirectory ? "#B7791F" : "#64748B";
    public string Prefix => string.Empty;
    public double Indent => Depth * 18;
    public string TextColor => IsDirectory ? "#20242A" : "#344054";

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
