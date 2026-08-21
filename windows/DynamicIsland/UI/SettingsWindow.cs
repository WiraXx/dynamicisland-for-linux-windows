using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using DynamicIsland.Services;

namespace DynamicIsland.UI
{
    /// <summary>
    /// Fenetre de reglages. Chaque controle ecrit directement dans les
    /// reglages et previent l'ile, qui se replace aussitot : on peut laisser
    /// cette fenetre ouverte et regarder la pilule bouger.
    /// </summary>
    public class SettingsWindow : Window
    {
        private static readonly string[] PositionKeys =
        {
            "top-left", "top-center", "top-right",
            "bottom-left", "bottom-center", "bottom-right",
        };

        private static readonly string[] PositionLabels =
        {
            "Haut gauche", "Haut centre", "Haut droite",
            "Bas gauche", "Bas centre", "Bas droite",
        };

        private readonly AppSettings _settings;
        private StackPanel _shortcutList;

        public SettingsWindow(AppSettings settings)
        {
            _settings = settings;

            Title = "Dynamic Island - Reglages";
            Width = 520;
            Height = 720;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            Background = new SolidColorBrush(Color.FromRgb(32, 32, 32));
            Foreground = Brushes.White;

            var stack = new StackPanel { Margin = new Thickness(18) };

            stack.Children.Add(SectionTitle("Position"));
            stack.Children.Add(PositionRow());
            stack.Children.Add(NumberRow("Decalage horizontal", -4000, 4000,
                _settings.OffsetX, value => _settings.OffsetX = (int)value));
            stack.Children.Add(NumberRow("Decalage vertical", -4000, 4000,
                _settings.OffsetY, value => _settings.OffsetY = (int)value));
            stack.Children.Add(NumberRow("Ecran (-1 = principal)", -1, 8,
                _settings.Monitor, value => _settings.Monitor = (int)value));

            stack.Children.Add(SectionTitle("Taille"));
            stack.Children.Add(NumberRow("Largeur de la pilule", 40, 1200,
                _settings.PillWidth, value => _settings.PillWidth = (int)value));
            stack.Children.Add(NumberRow("Hauteur de la pilule", 12, 200,
                _settings.PillHeight, value => _settings.PillHeight = (int)value));
            stack.Children.Add(NumberRow("Arrondi des coins", 0, 100,
                _settings.CornerRadius, value => _settings.CornerRadius = (int)value));
            stack.Children.Add(NumberRow("Largeur du panneau", 200, 1600,
                _settings.ExpandedWidth, value => _settings.ExpandedWidth = (int)value));
            stack.Children.Add(NumberRow("Hauteur maximale du panneau", 120, 2000,
                _settings.ExpandedMaxHeight, value => _settings.ExpandedMaxHeight = (int)value));

            stack.Children.Add(SectionTitle("Apparence"));
            stack.Children.Add(TextRow("Couleur de fond", _settings.BackgroundColor,
                value => _settings.BackgroundColor = value));
            stack.Children.Add(NumberRow("Opacite du fond (%)", 10, 100,
                (int)Math.Round(_settings.BackgroundOpacity * 100),
                value => _settings.BackgroundOpacity = value / 100.0));
            stack.Children.Add(TextRow("Couleur du texte", _settings.TextColor,
                value => _settings.TextColor = value));
            stack.Children.Add(NumberRow("Epaisseur de bordure", 0, 10,
                _settings.BorderWidth, value => _settings.BorderWidth = (int)value));
            stack.Children.Add(TextRow("Couleur de bordure", _settings.BorderColor,
                value => _settings.BorderColor = value));
            stack.Children.Add(NumberRow("Vitesse des animations (%)", 20, 300,
                (int)Math.Round(_settings.AnimationSpeed * 100),
                value => _settings.AnimationSpeed = value / 100.0));

            stack.Children.Add(SectionTitle("Comportement"));
            stack.Children.Add(CheckRow("Afficher les notifications",
                _settings.ShowNotifications, value => _settings.ShowNotifications = value));
            stack.Children.Add(NumberRow("Duree d'affichage (s)", 1, 60,
                _settings.NotificationTimeout, value => _settings.NotificationTimeout = (int)value));
            stack.Children.Add(CheckRow("Afficher le lecteur multimedia",
                _settings.ShowMedia, value => _settings.ShowMedia = value));
            stack.Children.Add(NumberRow("Titre du morceau dans la pilule (s, 0 = jamais)", 0, 30,
                _settings.CompactTitleDuration, value => _settings.CompactTitleDuration = (int)value));
            stack.Children.Add(CheckRow("Afficher la luminosite",
                _settings.ShowBrightness, value => _settings.ShowBrightness = value));
            stack.Children.Add(CheckRow("Afficher le volume dans l'ile",
                _settings.ShowOsd, value => _settings.ShowOsd = value));
            stack.Children.Add(CheckRow("Molette sur la pilule = volume",
                _settings.ScrollVolume, value => _settings.ScrollVolume = value));
            stack.Children.Add(CheckRow("Afficher l'etagere a fichiers",
                _settings.ShowShelf, value => _settings.ShowShelf = value));
            stack.Children.Add(CheckRow("Masquer la pilule au repos",
                _settings.AutoHide, value => _settings.AutoHide = value));
            stack.Children.Add(CheckRow("Demarrer avec Windows",
                ShortcutService.IsStartupEnabled(), value =>
                {
                    ShortcutService.SetStartupEnabled(value);
                    _settings.StartWithWindows = value;
                }));

            stack.Children.Add(SectionTitle("Applications epinglees"));
            stack.Children.Add(new TextBlock
            {
                Text = "Leurs icones apparaissent dans le panneau. Si des fichiers sont " +
                       "selectionnes dans l'etagere, ils sont passes a l'application lancee.",
                TextWrapping = TextWrapping.Wrap,
                Foreground = new SolidColorBrush(Color.FromRgb(170, 170, 170)),
                FontSize = 11,
                Margin = new Thickness(0, 0, 0, 8),
            });

            _shortcutList = new StackPanel();
            stack.Children.Add(_shortcutList);

            var addButton = new Button
            {
                Content = "Ajouter une application...",
                Margin = new Thickness(0, 6, 0, 0),
                Padding = new Thickness(10, 4, 10, 4),
                HorizontalAlignment = HorizontalAlignment.Left,
            };
            addButton.Click += (s, e) => AddShortcut();
            stack.Children.Add(addButton);

            var resetButton = new Button
            {
                Content = "Reinitialiser tous les reglages",
                Margin = new Thickness(0, 20, 0, 0),
                Padding = new Thickness(10, 4, 10, 4),
                HorizontalAlignment = HorizontalAlignment.Left,
            };
            resetButton.Click += (s, e) =>
            {
                _settings.ResetToDefaults();
                Close();
            };
            stack.Children.Add(resetButton);

            Content = new ScrollViewer
            {
                Content = stack,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            };

            RefreshShortcuts();
        }

        private TextBlock SectionTitle(string text)
        {
            return new TextBlock
            {
                Text = text,
                FontSize = 15,
                FontWeight = FontWeights.SemiBold,
                Foreground = Brushes.White,
                Margin = new Thickness(0, 16, 0, 8),
            };
        }

        private Grid TwoColumns(string label, UIElement control)
        {
            var grid = new Grid { Margin = new Thickness(0, 0, 0, 6) };
            grid.ColumnDefinitions.Add(new ColumnDefinition
            {
                Width = new GridLength(1, GridUnitType.Star),
            });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            grid.Children.Add(new TextBlock
            {
                Text = label,
                Foreground = Brushes.White,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 10, 0),
            });

            Grid.SetColumn((FrameworkElement)control, 1);
            grid.Children.Add(control);
            return grid;
        }

        private Grid NumberRow(string label, int minimum, int maximum, int value,
            Action<double> apply)
        {
            var box = new TextBox
            {
                Text = value.ToString(),
                Width = 90,
                VerticalAlignment = VerticalAlignment.Center,
            };

            box.LostFocus += (s, e) => Commit();
            box.KeyDown += (s, e) =>
            {
                if (e.Key == System.Windows.Input.Key.Enter)
                    Commit();
            };

            void Commit()
            {
                if (!int.TryParse(box.Text, out int parsed))
                {
                    box.Text = value.ToString();
                    return;
                }

                parsed = Math.Max(minimum, Math.Min(maximum, parsed));
                box.Text = parsed.ToString();
                apply(parsed);
                _settings.NotifyChanged();
            }

            return TwoColumns(label, box);
        }

        private Grid TextRow(string label, string value, Action<string> apply)
        {
            var box = new TextBox
            {
                Text = value,
                Width = 90,
                VerticalAlignment = VerticalAlignment.Center,
            };

            box.LostFocus += (s, e) =>
            {
                apply(box.Text);
                _settings.NotifyChanged();
            };

            return TwoColumns(label, box);
        }

        private Grid CheckRow(string label, bool value, Action<bool> apply)
        {
            var check = new CheckBox
            {
                IsChecked = value,
                VerticalAlignment = VerticalAlignment.Center,
            };

            check.Checked += (s, e) =>
            {
                apply(true);
                _settings.NotifyChanged();
            };
            check.Unchecked += (s, e) =>
            {
                apply(false);
                _settings.NotifyChanged();
            };

            return TwoColumns(label, check);
        }

        private Grid PositionRow()
        {
            var combo = new ComboBox { Width = 160, VerticalAlignment = VerticalAlignment.Center };
            foreach (string label in PositionLabels)
                combo.Items.Add(label);

            int index = Array.IndexOf(PositionKeys, _settings.Position ?? "top-center");
            combo.SelectedIndex = index >= 0 ? index : 1;

            combo.SelectionChanged += (s, e) =>
            {
                if (combo.SelectedIndex >= 0 && combo.SelectedIndex < PositionKeys.Length)
                {
                    _settings.Position = PositionKeys[combo.SelectedIndex];
                    _settings.NotifyChanged();
                }
            };

            return TwoColumns("Ancrage", combo);
        }

        private void AddShortcut()
        {
            var dialog = new Microsoft.Win32.OpenFileDialog
            {
                Title = "Choisir une application",
                Filter = "Applications et raccourcis (*.exe;*.lnk)|*.exe;*.lnk|Tous les fichiers (*.*)|*.*",
                InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            };

            if (dialog.ShowDialog() != true)
                return;

            if (!_settings.AppShortcuts.Contains(dialog.FileName, StringComparer.OrdinalIgnoreCase))
            {
                _settings.AppShortcuts.Add(dialog.FileName);
                _settings.NotifyChanged();
                RefreshShortcuts();
            }
        }

        private void RefreshShortcuts()
        {
            _shortcutList.Children.Clear();

            if (_settings.AppShortcuts.Count == 0)
            {
                _shortcutList.Children.Add(new TextBlock
                {
                    Text = "Aucune application epinglee",
                    Foreground = new SolidColorBrush(Color.FromRgb(150, 150, 150)),
                    FontSize = 12,
                });
                return;
            }

            foreach (string path in _settings.AppShortcuts.ToList())
            {
                string target = path;

                var grid = new Grid { Margin = new Thickness(0, 0, 0, 4) };
                grid.ColumnDefinitions.Add(new ColumnDefinition
                {
                    Width = new GridLength(1, GridUnitType.Star),
                });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                grid.Children.Add(new TextBlock
                {
                    Text = ShortcutService.DisplayName(target),
                    ToolTip = target,
                    Foreground = Brushes.White,
                    FontSize = 12,
                    VerticalAlignment = VerticalAlignment.Center,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });

                var remove = new Button
                {
                    Content = "Retirer",
                    Padding = new Thickness(8, 2, 8, 2),
                };
                remove.Click += (s, e) =>
                {
                    _settings.AppShortcuts.RemoveAll(entry =>
                        string.Equals(entry, target, StringComparison.OrdinalIgnoreCase));
                    _settings.NotifyChanged();
                    RefreshShortcuts();
                };
                Grid.SetColumn(remove, 1);
                grid.Children.Add(remove);

                _shortcutList.Children.Add(grid);
            }
        }
    }
}
