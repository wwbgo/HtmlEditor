using Microsoft.Maui.Graphics;

namespace HtmlEditor.Models;

public sealed class FileDiffLine
{
    public string Kind { get; init; } = "same";
    public string Symbol { get; init; } = "";
    public string OldLineNumber { get; init; } = "";
    public string NewLineNumber { get; init; } = "";
    public string OldText { get; init; } = "";
    public string NewText { get; init; } = "";
    public Color BackgroundColor { get; init; } = Colors.White;
    public Color TextColor { get; init; } = Color.FromArgb("#263238");
}
