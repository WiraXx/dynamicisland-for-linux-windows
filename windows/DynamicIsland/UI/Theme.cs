using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace DynamicIsland.UI
{
    /// <summary>
    /// Fabrique des éléments d'interface.
    ///
    /// Tout est construit en C# : les boutons sont de simples bordures dont on
    /// gère le survol à la main, ce qui évite d'avoir à redéfinir les gabarits
    /// WPF pour obtenir un rendu sombre.
    /// </summary>
    internal static class Theme
    {
        public const string TextFont = "Segoe UI";
        public const string GlyphFont = "Segoe MDL2 Assets";

        // Glyphes Segoe MDL2, présents sur Windows 10 et 11.
        // Notés en échappement Unicode : ces caractères sont dans une zone
        // privée, illisible dans un éditeur de texte ordinaire.
        public const string GlyphPlay = "\uE768";
        public const string GlyphPause = "\uE769";
        public const string GlyphPrevious = "\uE892";
        public const string GlyphNext = "\uE893";
        public const string GlyphVolume = "\uE767";
        public const string GlyphMute = "\uE74F";
        public const string GlyphBrightness = "\uE706";
        public const string GlyphSettings = "\uE713";
        public const string GlyphCopy = "\uE8C8";
        public const string GlyphOpen = "\uE8E5";
        public const string GlyphClose = "\uE711";
        public const string GlyphFolder = "\uE8B7";
        public const string GlyphPaste = "\uE77F";
        public const string GlyphBell = "\uEA8F";
        public const string GlyphMusic = "\uE8D6";

        public static Color ParseColor(string value, Color fallback)
        {
            try
            {
                object parsed = ColorConverter.ConvertFromString(value);
                if (parsed is Color color)
                    return color;
            }
            catch (Exception)
            {
                // Chaîne invalide : on garde la couleur d'origine.
            }
            return fallback;
        }

        public static SolidColorBrush Brush(string value, Color fallback, double opacity = 1.0)
        {
            var brush = new SolidColorBrush(ParseColor(value, fallback))
            {
                Opacity = Math.Max(0, Math.Min(1, opacity)),
            };
            brush.Freeze();
            return brush;
        }

        public static SolidColorBrush White(double opacity)
        {
            var brush = new SolidColorBrush(Color.FromArgb((byte)(255 * opacity), 255, 255, 255));
            brush.Freeze();
            return brush;
        }

        public static TextBlock Text(string content, double size, Brush foreground,
            FontWeight? weight = null)
        {
            return new TextBlock
            {
                Text = content ?? string.Empty,
                FontFamily = new FontFamily(TextFont),
                FontSize = size,
                Foreground = foreground,
                FontWeight = weight ?? FontWeights.Normal,
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        public static TextBlock Glyph(string glyph, double size, Brush foreground)
        {
            return new TextBlock
            {
                Text = glyph,
                FontFamily = new FontFamily(GlyphFont),
                FontSize = size,
                Foreground = foreground,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        /// <summary>Bouton rond ne portant qu'un glyphe.</summary>
        public static Border GlyphButton(string glyph, double size, Brush foreground,
            Action onClick, string tooltip = null)
        {
            var button = new Border
            {
                Child = Glyph(glyph, size, foreground),
                Padding = new Thickness(6),
                CornerRadius = new CornerRadius(14),
                Background = Brushes.Transparent,
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Center,
            };

            if (!string.IsNullOrEmpty(tooltip))
                button.ToolTip = tooltip;

            MakeClickable(button, onClick);
            return button;
        }

        /// <summary>Bouton portant un libellé, pour les actions secondaires.</summary>
        public static Border TextButton(string label, Brush foreground, Action onClick)
        {
            var button = new Border
            {
                Child = Text(label, 10, foreground),
                Padding = new Thickness(9, 3, 9, 3),
                CornerRadius = new CornerRadius(9),
                Background = White(0.12),
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Center,
            };

            MakeClickable(button, onClick, White(0.12), White(0.24));
            return button;
        }

        /// <summary>Ajoute le clic et la réaction au survol à une bordure.</summary>
        public static void MakeClickable(Border border, Action onClick,
            Brush normal = null, Brush hover = null)
        {
            Brush restingBrush = normal ?? Brushes.Transparent;
            Brush hoverBrush = hover ?? White(0.14);

            border.Background = restingBrush;
            border.MouseEnter += (s, e) => border.Background = hoverBrush;
            border.MouseLeave += (s, e) => border.Background = restingBrush;
            border.MouseLeftButtonUp += (s, e) =>
            {
                e.Handled = true;
                onClick?.Invoke();
            };
            // Sans quoi le clic remonterait à la pilule, qui le prendrait pour
            // un clic sur le fond et refermerait le panneau.
            border.MouseLeftButtonDown += (s, e) => e.Handled = true;
        }

        public static StackPanel Row(double spacing = 0)
        {
            return new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        public static StackPanel Column()
        {
            return new StackPanel { Orientation = Orientation.Vertical };
        }

        /// <summary>Espace horizontal entre deux éléments d'une rangée.</summary>
        public static FrameworkElement Spacer(double width)
        {
            return new Border { Width = width };
        }

        public static string FormatClock(TimeSpan value)
        {
            if (value < TimeSpan.Zero)
                value = TimeSpan.Zero;
            return ((int)value.TotalMinutes) + ":" + value.Seconds.ToString("00");
        }

        public static string FormatAge(DateTime timestamp)
        {
            var elapsed = DateTime.Now - timestamp;
            if (elapsed.TotalMinutes < 1)
                return "à l'instant";
            if (elapsed.TotalMinutes < 60)
                return "il y a " + (int)elapsed.TotalMinutes + " min";
            if (elapsed.TotalHours < 24)
                return "il y a " + (int)elapsed.TotalHours + " h";
            return "il y a " + (int)elapsed.TotalDays + " j";
        }
    }

    /// <summary>
    /// Jauge horizontale, cliquable et glissable.
    ///
    /// Écrite à la main plutôt qu'avec un Slider WPF : le gabarit par défaut
    /// est clair et lourd à redéfinir, alors que le comportement tient en
    /// quelques lignes.
    /// </summary>
    internal class LevelBar : Border
    {
        private readonly Border _fill;
        private bool _dragging;

        public event EventHandler<double> ValueChanged;
        public event EventHandler DragCompleted;

        public bool ReadOnly { get; set; }

        private double _value;

        public double Value
        {
            get => _value;
            set
            {
                _value = Math.Max(0, Math.Min(1, value));
                UpdateFill();
            }
        }

        public LevelBar(double height = 4)
        {
            Height = height;
            CornerRadius = new CornerRadius(height / 2);
            Background = Theme.White(0.22);
            VerticalAlignment = VerticalAlignment.Center;
            HorizontalAlignment = HorizontalAlignment.Stretch;
            Cursor = Cursors.Hand;
            SnapsToDevicePixels = true;

            _fill = new Border
            {
                Background = Theme.White(0.95),
                CornerRadius = new CornerRadius(height / 2),
                HorizontalAlignment = HorizontalAlignment.Left,
                Width = 0,
            };
            Child = _fill;

            SizeChanged += (s, e) => UpdateFill();
            MouseLeftButtonDown += OnPressed;
            MouseMove += OnMoved;
            MouseLeftButtonUp += OnReleased;
        }

        private void OnPressed(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            if (ReadOnly)
                return;
            _dragging = true;
            CaptureMouse();
            Apply(e.GetPosition(this).X);
        }

        private void OnMoved(object sender, MouseEventArgs e)
        {
            if (!_dragging)
                return;
            Apply(e.GetPosition(this).X);
        }

        private void OnReleased(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            if (!_dragging)
                return;
            _dragging = false;
            ReleaseMouseCapture();
            DragCompleted?.Invoke(this, EventArgs.Empty);
        }

        private void Apply(double x)
        {
            if (ActualWidth <= 0)
                return;
            Value = x / ActualWidth;
            ValueChanged?.Invoke(this, Value);
        }

        private void UpdateFill()
        {
            if (ActualWidth > 0)
                _fill.Width = Math.Max(0, Math.Min(ActualWidth, ActualWidth * _value));
        }
    }
}
