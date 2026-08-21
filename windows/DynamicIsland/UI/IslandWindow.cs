using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using DynamicIsland.Services;

namespace DynamicIsland.UI
{
    /// <summary>
    /// La fenetre-ile : une pilule flottante, sans bordure, toujours au-dessus,
    /// qui change de taille et de contenu selon ce qu'elle a a raconter.
    ///
    /// La fenetre fait exactement la taille de la pilule et se redimensionne
    /// avec elle : ainsi rien d'invisible ne traine a l'ecran pour intercepter
    /// les clics ou les glisser-deposer destines aux autres fenetres.
    /// </summary>
    public class IslandWindow : Window
    {
        private enum IslandState
        {
            Idle,
            Compact,
            Notification,
            Osd,
            Expanded,
        }

        private const int HistoryMax = 5;
        private const int OsdMilliseconds = 1500;

        private readonly AppSettings _settings;
        private readonly MediaService _media = new MediaService();
        private readonly AudioService _audio = new AudioService();
        private readonly BrightnessService _brightness = new BrightnessService();
        private readonly NotificationService _notifications = new NotificationService();
        private readonly ShelfService _shelf;
        private readonly List<NotificationItem> _history = new List<NotificationItem>();

        private IslandState _state = IslandState.Idle;
        private Border _pill;
        private Grid _viewHost;
        private System.Windows.Forms.NotifyIcon _tray;

        // Vue compacte
        private FrameworkElement _compactView;
        private Border _compactArt;
        private TextBlock _compactTitle;
        private StackPanel _compactControls;
        private TextBlock _compactPlayGlyph;
        private string _lastTrack = string.Empty;

        // Banniere de notification
        private FrameworkElement _bannerView;
        private TextBlock _bannerTitle;
        private TextBlock _bannerBody;

        // Pastille de volume et luminosite
        private FrameworkElement _osdView;
        private TextBlock _osdGlyph;
        private LevelBar _osdLevel;
        private TextBlock _osdValue;

        // Panneau
        private FrameworkElement _expandedView;
        private StackPanel _panelStack;
        private TextBlock _clockLabel;
        private TextBlock _dateLabel;
        private Border _mediaCard;
        private Border _mediaArt;
        private TextBlock _mediaTitle;
        private TextBlock _mediaArtist;
        private TextBlock _mediaPlayGlyph;
        private LevelBar _mediaProgress;
        private TextBlock _mediaElapsed;
        private TextBlock _mediaTotal;
        private StackPanel _volumeRow;
        private TextBlock _volumeGlyph;
        private LevelBar _volumeLevel;
        private StackPanel _brightnessRow;
        private LevelBar _brightnessLevel;
        private StackPanel _shortcutsRow;
        private StackPanel _shelfSection;
        private TextBlock _shelfTitle;
        private StackPanel _shelfList;
        private TextBlock _shelfEmpty;
        private StackPanel _notificationList;
        private TextBlock _notificationEmpty;
        private Border _clearButton;

        private DispatcherTimer _notificationTimer;
        private DispatcherTimer _osdTimer;
        private DispatcherTimer _compactTitleTimer;
        private DispatcherTimer _shelfTitleTimer;
        private DispatcherTimer _clockTimer;
        private bool _compactShowsTitle;
        private bool _dragOverPill;

        public IslandWindow(AppSettings settings)
        {
            _settings = settings;
            _shelf = new ShelfService(settings);

            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = null;
            Topmost = true;
            ShowInTaskbar = false;
            ResizeMode = ResizeMode.NoResize;
            SizeToContent = SizeToContent.Manual;
            AllowDrop = true;
            Title = "Dynamic Island";
            WindowStartupLocation = WindowStartupLocation.Manual;
            UseLayoutRounding = true;

            BuildInterface();
            BuildTrayIcon();

            SourceInitialized += OnSourceInitialized;
            Deactivated += (s, e) => Collapse();
            KeyDown += OnKeyDown;
            MouseLeftButtonDown += OnPillPressed;
            MouseRightButtonUp += (s, e) => ShowContextMenu();
            MouseWheel += OnWheel;
            MouseEnter += (s, e) => OnHoverChanged(true);
            MouseLeave += (s, e) => OnHoverChanged(false);
            DragEnter += OnDragEnter;
            DragOver += OnDragOver;
            DragLeave += OnDragLeave;
            Drop += OnDrop;
            Closed += OnClosed;

            _settings.Changed += (s, e) => ApplySettings();

            _media.Changed += (s, e) => OnMediaChanged();
            _audio.Changed += (s, e) => OnVolumeChanged();
            _notifications.Received += (s, item) => OnNotification(item);
            _shelf.Changed += (s, e) => OnShelfChanged();

            _media.Start();
            _notifications.Start();

            ApplySettings();
            SetState(IslandState.Idle, false);
        }

        // ------------------------------------------------------------ interface

        private void BuildInterface()
        {
            _viewHost = new Grid();

            _compactView = BuildCompactView();
            _bannerView = BuildBannerView();
            _osdView = BuildOsdView();
            _expandedView = BuildExpandedView();

            foreach (FrameworkElement view in new[]
                     { _compactView, _bannerView, _osdView, _expandedView })
            {
                view.Visibility = Visibility.Hidden;
                _viewHost.Children.Add(view);
            }

            _pill = new Border
            {
                Child = _viewHost,
                ClipToBounds = true,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
                AllowDrop = true,
            };

            Content = _pill;
        }

        private FrameworkElement BuildCompactView()
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(8, 0, 8, 0),
            };

            _compactArt = new Border
            {
                Width = 18,
                Height = 18,
                CornerRadius = new CornerRadius(9),
                Background = Theme.White(0.15),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 6, 0),
            };
            row.Children.Add(_compactArt);

            _compactTitle = Theme.Text(string.Empty, 11, Theme.White(0.95));
            _compactTitle.MaxWidth = 220;
            _compactTitle.Margin = new Thickness(0, 0, 6, 0);
            _compactTitle.Visibility = Visibility.Collapsed;
            row.Children.Add(_compactTitle);

            _compactControls = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
            };
            _compactControls.Children.Add(SmallGlyphButton(Theme.GlyphPrevious, () => _media.Previous()));

            var play = SmallGlyphButton(Theme.GlyphPlay, () => _media.PlayPause());
            _compactPlayGlyph = (TextBlock)play.Child;
            _compactControls.Children.Add(play);

            _compactControls.Children.Add(SmallGlyphButton(Theme.GlyphNext, () => _media.Next()));
            row.Children.Add(_compactControls);

            return row;
        }

        private Border SmallGlyphButton(string glyph, Action onClick)
        {
            var button = Theme.GlyphButton(glyph, 11, Theme.White(0.9), onClick);
            button.Padding = new Thickness(4);
            button.CornerRadius = new CornerRadius(10);
            return button;
        }

        private FrameworkElement BuildBannerView()
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(14, 8, 14, 8),
            };

            row.Children.Add(new Border
            {
                Child = Theme.Glyph(Theme.GlyphBell, 18, Theme.White(0.9)),
                Margin = new Thickness(0, 0, 10, 0),
                VerticalAlignment = VerticalAlignment.Center,
            });

            var texts = new StackPanel { Orientation = Orientation.Vertical, MaxWidth = 320 };
            _bannerTitle = Theme.Text(string.Empty, 12, Theme.White(1), FontWeights.SemiBold);
            _bannerBody = Theme.Text(string.Empty, 11, Theme.White(0.72));
            texts.Children.Add(_bannerTitle);
            texts.Children.Add(_bannerBody);
            row.Children.Add(texts);

            return row;
        }

        private FrameworkElement BuildOsdView()
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(10, 0, 10, 0),
            };

            _osdGlyph = Theme.Glyph(Theme.GlyphVolume, 14, Theme.White(0.95));
            _osdGlyph.Margin = new Thickness(0, 0, 8, 0);
            row.Children.Add(_osdGlyph);

            _osdLevel = new LevelBar(3) { Width = 54, ReadOnly = true };
            row.Children.Add(_osdLevel);

            _osdValue = Theme.Text("0 %", 9, Theme.White(0.8));
            _osdValue.Margin = new Thickness(8, 0, 0, 0);
            _osdValue.MinWidth = 26;
            _osdValue.TextAlignment = TextAlignment.Right;
            row.Children.Add(_osdValue);

            return row;
        }

        private FrameworkElement BuildExpandedView()
        {
            _panelStack = new StackPanel
            {
                Orientation = Orientation.Vertical,
                Margin = new Thickness(14),
            };

            _panelStack.Children.Add(BuildHeader());
            _panelStack.Children.Add(BuildMediaCard());
            _panelStack.Children.Add(BuildVolumeRow());
            _panelStack.Children.Add(BuildBrightnessRow());
            _panelStack.Children.Add(BuildShortcutsRow());
            _panelStack.Children.Add(BuildShelfSection());
            foreach (FrameworkElement element in BuildNotificationSection())
                _panelStack.Children.Add(element);

            return new ScrollViewer
            {
                Content = _panelStack,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                Background = System.Windows.Media.Brushes.Transparent,
                Padding = new Thickness(0),
            };
        }

        private FrameworkElement BuildHeader()
        {
            var grid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var texts = new StackPanel { Orientation = Orientation.Vertical };
            _clockLabel = Theme.Text(string.Empty, 20, Theme.White(1), FontWeights.Light);
            _dateLabel = Theme.Text(string.Empty, 11, Theme.White(0.7));
            texts.Children.Add(_clockLabel);
            texts.Children.Add(_dateLabel);
            grid.Children.Add(texts);

            var settingsButton = Theme.GlyphButton(Theme.GlyphSettings, 14, Theme.White(0.9),
                OpenSettings, "Réglages");
            Grid.SetColumn(settingsButton, 1);
            grid.Children.Add(settingsButton);

            return grid;
        }

        private Border BuildMediaCard()
        {
            var content = new StackPanel { Orientation = Orientation.Vertical };

            var top = new StackPanel { Orientation = Orientation.Horizontal };
            _mediaArt = new Border
            {
                Width = 56,
                Height = 56,
                CornerRadius = new CornerRadius(8),
                Background = Theme.White(0.12),
                Margin = new Thickness(0, 0, 10, 0),
            };
            top.Children.Add(_mediaArt);

            var texts = new StackPanel
            {
                Orientation = Orientation.Vertical,
                VerticalAlignment = VerticalAlignment.Center,
                Width = 170,
            };
            _mediaTitle = Theme.Text(string.Empty, 12, Theme.White(1), FontWeights.SemiBold);
            _mediaArtist = Theme.Text(string.Empty, 11, Theme.White(0.7));
            texts.Children.Add(_mediaTitle);
            texts.Children.Add(_mediaArtist);
            top.Children.Add(texts);

            var controls = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
            };
            controls.Children.Add(Theme.GlyphButton(Theme.GlyphPrevious, 13, Theme.White(0.9),
                () => _media.Previous()));
            var play = Theme.GlyphButton(Theme.GlyphPlay, 13, Theme.White(0.95), () => _media.PlayPause());
            _mediaPlayGlyph = (TextBlock)play.Child;
            controls.Children.Add(play);
            controls.Children.Add(Theme.GlyphButton(Theme.GlyphNext, 13, Theme.White(0.9),
                () => _media.Next()));
            top.Children.Add(controls);

            content.Children.Add(top);

            var progress = new Grid { Margin = new Thickness(0, 8, 0, 0) };
            progress.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            progress.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            progress.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            _mediaElapsed = Theme.Text("0:00", 9, Theme.White(0.6));
            _mediaElapsed.Margin = new Thickness(0, 0, 8, 0);
            progress.Children.Add(_mediaElapsed);

            _mediaProgress = new LevelBar(3);
            _mediaProgress.DragCompleted += (s, e) => _media.Seek(_mediaProgress.Value);
            Grid.SetColumn(_mediaProgress, 1);
            progress.Children.Add(_mediaProgress);

            _mediaTotal = Theme.Text("0:00", 9, Theme.White(0.6));
            _mediaTotal.Margin = new Thickness(8, 0, 0, 0);
            Grid.SetColumn(_mediaTotal, 2);
            progress.Children.Add(_mediaTotal);

            content.Children.Add(progress);

            _mediaCard = new Border
            {
                Child = content,
                Background = Theme.White(0.07),
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(8),
                Margin = new Thickness(0, 0, 0, 10),
            };
            return _mediaCard;
        }

        private StackPanel BuildVolumeRow()
        {
            _volumeRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Margin = new Thickness(0, 0, 0, 8),
            };

            var button = Theme.GlyphButton(Theme.GlyphVolume, 14, Theme.White(0.9),
                () => _audio.ToggleMute(), "Couper le son");
            _volumeGlyph = (TextBlock)button.Child;
            _volumeRow.Children.Add(button);

            _volumeLevel = new LevelBar { Width = 300, Margin = new Thickness(8, 0, 0, 0) };
            _volumeLevel.ValueChanged += (s, value) => _audio.Volume = value;
            _volumeRow.Children.Add(_volumeLevel);

            return _volumeRow;
        }

        private StackPanel BuildBrightnessRow()
        {
            _brightnessRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Margin = new Thickness(0, 0, 0, 10),
            };

            _brightnessRow.Children.Add(Theme.GlyphButton(Theme.GlyphBrightness, 14,
                Theme.White(0.9), () => { }));

            _brightnessLevel = new LevelBar { Width = 300, Margin = new Thickness(8, 0, 0, 0) };
            _brightnessLevel.ValueChanged += (s, value) => _brightness.Brightness = value;
            _brightnessRow.Children.Add(_brightnessLevel);

            return _brightnessRow;
        }

        private StackPanel BuildShortcutsRow()
        {
            _shortcutsRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Margin = new Thickness(0, 0, 0, 10),
            };
            return _shortcutsRow;
        }

        private StackPanel BuildShelfSection()
        {
            _shelfSection = new StackPanel { Orientation = Orientation.Vertical };

            var header = new Grid { Margin = new Thickness(0, 0, 0, 6) };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            _shelfTitle = Theme.Text("Fichiers", 11, Theme.White(0.85), FontWeights.SemiBold);
            header.Children.Add(_shelfTitle);

            _clearButton = Theme.TextButton("Vider", Theme.White(0.9), () => _shelf.Clear());
            Grid.SetColumn(_clearButton, 1);
            header.Children.Add(_clearButton);
            _shelfSection.Children.Add(header);

            _shelfList = new StackPanel { Orientation = Orientation.Vertical };
            _shelfSection.Children.Add(_shelfList);

            _shelfEmpty = Theme.Text("Glisse un fichier sur l'île, il se pose ici", 11, Theme.White(0.55));
            _shelfEmpty.Margin = new Thickness(0, 4, 0, 8);
            _shelfEmpty.TextAlignment = TextAlignment.Center;
            _shelfSection.Children.Add(_shelfEmpty);

            return _shelfSection;
        }

        private FrameworkElement[] BuildNotificationSection()
        {
            var header = new Grid { Margin = new Thickness(0, 6, 0, 6) };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.Children.Add(Theme.Text("Notifications", 11, Theme.White(0.85), FontWeights.SemiBold));

            var clear = Theme.TextButton("Tout effacer", Theme.White(0.9), () =>
            {
                foreach (NotificationItem item in _history.ToList())
                    _notifications.Dismiss(item.Id);
                _history.Clear();
                RefreshNotifications();
                ResizeToState();
            });
            Grid.SetColumn(clear, 1);
            header.Children.Add(clear);

            _notificationList = new StackPanel { Orientation = Orientation.Vertical };

            _notificationEmpty = Theme.Text("Aucune notification", 11, Theme.White(0.55));
            _notificationEmpty.Margin = new Thickness(0, 4, 0, 0);
            _notificationEmpty.TextAlignment = TextAlignment.Center;
            _notificationEmpty.TextWrapping = TextWrapping.Wrap;

            return new FrameworkElement[] { header, _notificationList, _notificationEmpty };
        }

        private void BuildTrayIcon()
        {
            try
            {
                _tray = new System.Windows.Forms.NotifyIcon
                {
                    Icon = System.Drawing.SystemIcons.Application,
                    Text = "Dynamic Island",
                    Visible = true,
                };

                var menu = new System.Windows.Forms.ContextMenuStrip();
                menu.Items.Add("Réglages", null, (s, e) => Dispatcher.Invoke(OpenSettings));
                menu.Items.Add("Quitter", null, (s, e) => Dispatcher.Invoke(Quit));
                _tray.ContextMenuStrip = menu;
                _tray.DoubleClick += (s, e) => Dispatcher.Invoke(() => Toggle());
            }
            catch (Exception)
            {
                // Sans icône de notification, il reste le clic droit sur la pilule.
            }
        }

        // ------------------------------------------------------------ geometrie

        private void OnSourceInitialized(object sender, EventArgs e)
        {
            var handle = new WindowInteropHelper(this).Handle;
            Native.HideFromTaskSwitcher(handle);

            // Le facteur d'échelle n'est lisible qu'une fois la fenêtre créée :
            // on replace l'île maintenant que la mesure est fiable.
            ResizeToState(false);
        }

        /// <summary>Zone utile de l'écran choisi, en unités WPF.</summary>
        private Rect GetWorkArea()
        {
            try
            {
                var screens = System.Windows.Forms.Screen.AllScreens;
                System.Windows.Forms.Screen screen =
                    _settings.Monitor >= 0 && _settings.Monitor < screens.Length
                        ? screens[_settings.Monitor]
                        : System.Windows.Forms.Screen.PrimaryScreen;

                var area = screen.WorkingArea;
                double scale = VisualTreeHelper.GetDpi(this).DpiScaleX;
                if (scale <= 0)
                    scale = 1;

                return new Rect(area.Left / scale, area.Top / scale,
                    area.Width / scale, area.Height / scale);
            }
            catch (Exception)
            {
                return new Rect(0, 0, SystemParameters.PrimaryScreenWidth,
                    SystemParameters.PrimaryScreenHeight);
            }
        }

        private Size MeasureContent(FrameworkElement view, double availableWidth)
        {
            view.Measure(new Size(availableWidth, double.PositiveInfinity));
            return view.DesiredSize;
        }

        private Size TargetSize(IslandState state)
        {
            double pillWidth = Math.Max(40, _settings.PillWidth);
            double pillHeight = Math.Max(12, _settings.PillHeight);
            Rect work = GetWorkArea();
            double panelWidth = Math.Min(_settings.ExpandedWidth, work.Width - 40);

            switch (state)
            {
                case IslandState.Compact:
                {
                    Size content = MeasureContent(_compactView, double.PositiveInfinity);
                    double width = Math.Max(pillWidth, Math.Min(content.Width + 20, 460));
                    return new Size(width, pillHeight);
                }

                case IslandState.Osd:
                {
                    Size content = MeasureContent(_osdView, double.PositiveInfinity);
                    double width = Math.Max(pillWidth, Math.Min(content.Width + 20, 340));
                    return new Size(width, pillHeight);
                }

                case IslandState.Notification:
                {
                    Size content = MeasureContent(_bannerView, panelWidth);
                    double height = Math.Max(pillHeight + 20, Math.Min(content.Height + 12, 160));
                    return new Size(panelWidth, height);
                }

                case IslandState.Expanded:
                {
                    Size content = MeasureContent(_panelStack, panelWidth);
                    double maximum = Math.Min(_settings.ExpandedMaxHeight, work.Height - 60);
                    double height = Math.Max(pillHeight, Math.Min(content.Height + 6, maximum));
                    return new Size(panelWidth, height);
                }

                default:
                    return new Size(pillWidth, pillHeight);
            }
        }

        private Point TargetPosition(Size size)
        {
            Rect work = GetWorkArea();
            string position = _settings.Position ?? "top-center";

            double x;
            if (position.EndsWith("left", StringComparison.Ordinal))
                x = work.Left + _settings.OffsetX;
            else if (position.EndsWith("right", StringComparison.Ordinal))
                x = work.Right - size.Width - _settings.OffsetX;
            else
                x = work.Left + (work.Width - size.Width) / 2 + _settings.OffsetX;

            double y = position.StartsWith("top", StringComparison.Ordinal)
                ? work.Top + _settings.OffsetY
                : work.Bottom - size.Height - _settings.OffsetY;

            return new Point(Math.Round(x), Math.Round(y));
        }

        private void ResizeToState(bool animate = true)
        {
            Size size = TargetSize(_state);
            Point position = TargetPosition(size);

            double radius = _state == IslandState.Expanded
                ? Math.Min(26, size.Height / 2)
                : Math.Min(_settings.CornerRadius, size.Height / 2);
            _pill.CornerRadius = new CornerRadius(radius);

            int milliseconds = animate
                ? (int)(300 / Math.Max(0.2, _settings.AnimationSpeed))
                : 0;

            Animate(LeftProperty, position.X, milliseconds);
            Animate(TopProperty, position.Y, milliseconds);
            Animate(WidthProperty, size.Width, milliseconds);
            Animate(HeightProperty, size.Height, milliseconds);

            bool hidden = _state == IslandState.Idle && _settings.AutoHide;
            Animate(OpacityProperty, hidden ? 0 : 1, milliseconds);
        }

        private void Animate(DependencyProperty property, double target, int milliseconds)
        {
            if (milliseconds <= 0)
            {
                BeginAnimation(property, null);
                SetValue(property, target);
                return;
            }

            var animation = new DoubleAnimation(target, TimeSpan.FromMilliseconds(milliseconds))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
                FillBehavior = FillBehavior.HoldEnd,
            };
            BeginAnimation(property, animation);
        }

        // --------------------------------------------------------------- etats

        private void SetState(IslandState state, bool animate = true)
        {
            _state = state;

            _compactView.Visibility = state == IslandState.Compact
                ? Visibility.Visible : Visibility.Hidden;
            _bannerView.Visibility = state == IslandState.Notification
                ? Visibility.Visible : Visibility.Hidden;
            _osdView.Visibility = state == IslandState.Osd
                ? Visibility.Visible : Visibility.Hidden;
            _expandedView.Visibility = state == IslandState.Expanded
                ? Visibility.Visible : Visibility.Hidden;

            ResizeToState(animate);
        }

        private IslandState CollapsedState()
        {
            return _settings.ShowMedia && _media.HasSession
                ? IslandState.Compact
                : IslandState.Idle;
        }

        private void ReturnToCollapsed()
        {
            SetState(CollapsedState());
        }

        public void Toggle()
        {
            if (_state == IslandState.Expanded)
                Collapse();
            else
                Expand();
        }

        private void Expand()
        {
            if (_state == IslandState.Expanded)
                return;

            StopTimer(ref _notificationTimer);
            StopTimer(ref _osdTimer);
            _shelf.PruneMissing();
            RefreshPanel();
            SetState(IslandState.Expanded);
            StartClock();
            Activate();
            Focus();
        }

        private void Collapse()
        {
            if (_state != IslandState.Expanded)
                return;

            StopTimer(ref _clockTimer);
            ReturnToCollapsed();
        }

        // ------------------------------------------------------------- contenus

        private void RefreshPanel()
        {
            UpdateClock();

            MediaInfo info = _settings.ShowMedia ? _media.Current : null;
            _mediaCard.Visibility = info != null ? Visibility.Visible : Visibility.Collapsed;
            if (info != null)
                UpdateMediaCard(info);

            _volumeRow.Visibility = _audio.Available ? Visibility.Visible : Visibility.Collapsed;
            if (_audio.Available)
            {
                _volumeLevel.Value = _audio.Volume;
                _volumeGlyph.Text = _audio.Muted || _audio.Volume <= 0
                    ? Theme.GlyphMute : Theme.GlyphVolume;
            }

            bool showBrightness = _settings.ShowBrightness && _brightness.Available;
            _brightnessRow.Visibility = showBrightness ? Visibility.Visible : Visibility.Collapsed;
            if (showBrightness)
                _brightnessLevel.Value = _brightness.Brightness;

            RefreshShortcuts();
            RefreshShelf();
            RefreshNotifications();
        }

        private void UpdateMediaCard(MediaInfo info)
        {
            _mediaTitle.Text = info.Title;
            _mediaArtist.Text = info.Artist;
            _mediaArtist.Visibility = string.IsNullOrWhiteSpace(info.Artist)
                ? Visibility.Collapsed : Visibility.Visible;
            _mediaPlayGlyph.Text = info.IsPlaying ? Theme.GlyphPause : Theme.GlyphPlay;
            _mediaArt.Background = info.Thumbnail != null
                ? new ImageBrush(info.Thumbnail) { Stretch = Stretch.UniformToFill }
                : (Brush)Theme.White(0.12);

            _mediaElapsed.Text = Theme.FormatClock(info.Position);
            _mediaTotal.Text = Theme.FormatClock(info.Duration);
            _mediaProgress.Value = info.Duration > TimeSpan.Zero
                ? info.Position.TotalSeconds / info.Duration.TotalSeconds
                : 0;
        }

        private void RefreshShortcuts()
        {
            _shortcutsRow.Children.Clear();

            foreach (string path in _settings.AppShortcuts)
            {
                string target = path;
                var icon = ShortcutService.LoadIcon(target);

                var content = icon != null
                    ? (FrameworkElement)new Image { Source = icon, Width = 26, Height = 26 }
                    : Theme.Glyph(Theme.GlyphOpen, 18, Theme.White(0.9));

                var button = new Border
                {
                    Child = content,
                    Padding = new Thickness(6),
                    CornerRadius = new CornerRadius(12),
                    Margin = new Thickness(0, 0, 6, 0),
                    Cursor = Cursors.Hand,
                    ToolTip = ShortcutService.DisplayName(target),
                };
                Theme.MakeClickable(button, () =>
                {
                    ShortcutService.Launch(target, _shelf.SelectedFiles);
                    Collapse();
                }, Theme.White(0.07), Theme.White(0.16));

                _shortcutsRow.Children.Add(button);
            }

            _shortcutsRow.Visibility = _shortcutsRow.Children.Count > 0
                ? Visibility.Visible : Visibility.Collapsed;
        }

        private void RefreshShelf()
        {
            _shelfSection.Visibility = _settings.ShowShelf ? Visibility.Visible : Visibility.Collapsed;
            if (!_settings.ShowShelf)
                return;

            _shelfList.Children.Clear();

            foreach (string path in _shelf.Files.ToList())
                _shelfList.Children.Add(BuildShelfRow(path));

            bool empty = _shelf.IsEmpty;
            _shelfEmpty.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
            _shelfList.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
            _clearButton.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
        }

        private Border BuildShelfRow(string path)
        {
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var icon = Theme.Glyph(Theme.GlyphFolder, 14, Theme.White(0.85));
            icon.Margin = new Thickness(0, 0, 8, 0);
            grid.Children.Add(icon);

            var name = Theme.Text(_shelf.DisplayName(path), 11,
                Theme.White(_shelf.Exists(path) ? 0.95 : 0.45));
            name.ToolTip = path;
            Grid.SetColumn(name, 1);
            grid.Children.Add(name);

            var actions = new StackPanel { Orientation = Orientation.Horizontal };
            actions.Children.Add(SmallGlyphButton(Theme.GlyphOpen, () =>
            {
                _shelf.Open(path);
                Collapse();
            }));
            actions.Children.Add(SmallGlyphButton(Theme.GlyphClose, () => _shelf.Remove(path)));
            Grid.SetColumn(actions, 2);
            grid.Children.Add(actions);

            bool selected = _shelf.IsSelected(path);
            var row = new Border
            {
                Child = grid,
                Padding = new Thickness(8, 6, 8, 6),
                CornerRadius = new CornerRadius(10),
                Margin = new Thickness(0, 0, 0, 4),
                Background = selected ? Theme.White(0.2) : Theme.White(0.07),
                Cursor = Cursors.Hand,
                ToolTip = "Clic pour sélectionner, ou glisse la ligne vers une autre fenêtre",
            };

            EnableDragOut(row, path);
            return row;
        }

        /// <summary>
        /// Permet de reglisser un fichier de l'étagère vers une autre fenêtre.
        /// C'est ce que GNOME ne permet pas et que Windows autorise.
        /// </summary>
        private void EnableDragOut(Border row, string path)
        {
            Point origin = new Point();
            bool pressed = false;

            row.MouseLeftButtonDown += (s, e) =>
            {
                pressed = true;
                origin = e.GetPosition(this);
                e.Handled = true;
            };

            row.MouseMove += (s, e) =>
            {
                if (!pressed || e.LeftButton != MouseButtonState.Pressed)
                    return;

                Point current = e.GetPosition(this);
                if (Math.Abs(current.X - origin.X) < 8 && Math.Abs(current.Y - origin.Y) < 8)
                    return;

                pressed = false;
                try
                {
                    var files = new System.Collections.Specialized.StringCollection();
                    files.Add(path);
                    var data = new DataObject();
                    data.SetFileDropList(files);
                    DragDrop.DoDragDrop(row, data, DragDropEffects.Copy);
                }
                catch (Exception)
                {
                    // La cible a refusé le dépôt.
                }
            };

            row.MouseLeftButtonUp += (s, e) =>
            {
                if (!pressed)
                    return;
                pressed = false;
                _shelf.ToggleSelection(path);
                e.Handled = true;
            };
        }

        private void RefreshNotifications()
        {
            _notificationList.Children.Clear();

            foreach (NotificationItem item in _history)
                _notificationList.Children.Add(BuildNotificationRow(item));

            if (!_notifications.Available)
            {
                _notificationEmpty.Text = _notifications.UnavailableReason;
                _notificationEmpty.Visibility = Visibility.Visible;
                _notificationList.Visibility = Visibility.Collapsed;
                return;
            }

            bool empty = _history.Count == 0;
            _notificationEmpty.Text = "Aucune notification";
            _notificationEmpty.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
            _notificationList.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
        }

        private Border BuildNotificationRow(NotificationItem item)
        {
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var glyph = Theme.Glyph(Theme.GlyphBell, 14, Theme.White(0.85));
            glyph.Margin = new Thickness(0, 0, 8, 0);
            grid.Children.Add(glyph);

            var texts = new StackPanel { Orientation = Orientation.Vertical };
            texts.Children.Add(Theme.Text(item.Title, 11, Theme.White(0.95), FontWeights.SemiBold));
            if (!string.IsNullOrWhiteSpace(item.Body))
                texts.Children.Add(Theme.Text(item.Body, 10, Theme.White(0.7)));
            Grid.SetColumn(texts, 1);
            grid.Children.Add(texts);

            var age = Theme.Text(Theme.FormatAge(item.Timestamp), 9, Theme.White(0.55));
            Grid.SetColumn(age, 2);
            grid.Children.Add(age);

            var row = new Border
            {
                Child = grid,
                Padding = new Thickness(10, 8, 10, 8),
                CornerRadius = new CornerRadius(12),
                Margin = new Thickness(0, 0, 0, 4),
                Background = Theme.White(0.07),
                RenderTransform = new TranslateTransform(),
                Cursor = Cursors.Hand,
                ToolTip = "Glisse sur le côté pour supprimer",
            };

            EnableSwipeToDismiss(row, item);
            return row;
        }

        /// <summary>Glissement latéral pour supprimer une notification.</summary>
        private void EnableSwipeToDismiss(Border row, NotificationItem item)
        {
            double startX = 0;
            bool dragging = false;
            var transform = (TranslateTransform)row.RenderTransform;

            row.MouseLeftButtonDown += (s, e) =>
            {
                startX = e.GetPosition(this).X;
                dragging = true;
                row.CaptureMouse();
                e.Handled = true;
            };

            row.MouseMove += (s, e) =>
            {
                if (!dragging)
                    return;
                double delta = e.GetPosition(this).X - startX;
                transform.X = delta;
                row.Opacity = Math.Max(0.3, 1 - Math.Abs(delta) / 200);
            };

            row.MouseLeftButtonUp += (s, e) =>
            {
                if (!dragging)
                    return;
                dragging = false;
                row.ReleaseMouseCapture();
                e.Handled = true;

                if (Math.Abs(transform.X) >= 70)
                {
                    DismissNotification(item);
                    return;
                }

                transform.X = 0;
                row.Opacity = 1;
            };
        }

        private void DismissNotification(NotificationItem item)
        {
            _notifications.Dismiss(item.Id);
            _history.Remove(item);
            RefreshNotifications();
            if (_state == IslandState.Expanded)
                ResizeToState();
        }

        private void UpdateClock()
        {
            DateTime now = DateTime.Now;
            _clockLabel.Text = now.ToString("HH:mm");
            _dateLabel.Text = now.ToString("dddd d MMMM");
        }

        private void StartClock()
        {
            StopTimer(ref _clockTimer);
            _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
            _clockTimer.Tick += (s, e) => UpdateClock();
            _clockTimer.Start();
        }

        // -------------------------------------------------------------- signaux

        private void OnMediaChanged()
        {
            MediaInfo info = _settings.ShowMedia ? _media.Current : null;

            if (info != null)
            {
                _compactTitle.Text = info.Title;
                _compactPlayGlyph.Text = info.IsPlaying ? Theme.GlyphPause : Theme.GlyphPlay;
                _compactArt.Background = info.Thumbnail != null
                    ? new ImageBrush(info.Thumbnail) { Stretch = Stretch.UniformToFill }
                    : (Brush)Theme.White(0.15);

                string track = info.Title + "\u0000" + info.Artist;
                if (track != _lastTrack)
                {
                    _lastTrack = track;
                    FlashCompactTitle();
                }
            }
            else
            {
                _lastTrack = string.Empty;
            }

            if (_state == IslandState.Expanded)
            {
                RefreshPanel();
                ResizeToState();
            }
            else if (_state != IslandState.Notification && _state != IslandState.Osd)
            {
                ReturnToCollapsed();
            }
        }

        /// <summary>
        /// Le titre s'affiche quelques secondes au changement de morceau, puis
        /// la pilule se rétracte sur la pochette et les boutons.
        /// </summary>
        private void FlashCompactTitle()
        {
            StopTimer(ref _compactTitleTimer);

            if (_settings.CompactTitleDuration <= 0)
            {
                SetCompactMode(false);
                return;
            }

            SetCompactMode(true);
            _compactTitleTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromSeconds(_settings.CompactTitleDuration),
            };
            _compactTitleTimer.Tick += (s, e) =>
            {
                StopTimer(ref _compactTitleTimer);
                SetCompactMode(false);
            };
            _compactTitleTimer.Start();
        }

        private void SetCompactMode(bool showTitle)
        {
            _compactShowsTitle = showTitle;
            _compactTitle.Visibility = showTitle ? Visibility.Visible : Visibility.Collapsed;
            _compactControls.Visibility = showTitle ? Visibility.Collapsed : Visibility.Visible;

            if (_state == IslandState.Compact)
                ResizeToState();
        }

        private void OnVolumeChanged()
        {
            if (_state == IslandState.Expanded)
            {
                _volumeLevel.Value = _audio.Volume;
                _volumeGlyph.Text = _audio.Muted || _audio.Volume <= 0
                    ? Theme.GlyphMute : Theme.GlyphVolume;
                return;
            }

            ShowOsd(_audio.Muted ? Theme.GlyphMute : Theme.GlyphVolume, _audio.Volume);
        }

        private void ShowOsd(string glyph, double level)
        {
            if (!_settings.ShowOsd)
                return;

            _osdGlyph.Text = glyph;
            _osdLevel.Value = level;
            _osdValue.Text = (int)Math.Round(level * 100) + " %";
            SetState(IslandState.Osd);

            StopTimer(ref _osdTimer);
            _osdTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(OsdMilliseconds) };
            _osdTimer.Tick += (s, e) =>
            {
                StopTimer(ref _osdTimer);
                if (_state == IslandState.Osd)
                    ReturnToCollapsed();
            };
            _osdTimer.Start();
        }

        private void OnNotification(NotificationItem item)
        {
            if (!_settings.ShowNotifications)
                return;

            _history.Insert(0, item);
            while (_history.Count > HistoryMax)
                _history.RemoveAt(_history.Count - 1);

            if (_state == IslandState.Expanded)
            {
                RefreshNotifications();
                ResizeToState();
                return;
            }

            _bannerTitle.Text = item.Title;
            _bannerBody.Text = item.Body;
            _bannerBody.Visibility = string.IsNullOrWhiteSpace(item.Body)
                ? Visibility.Collapsed : Visibility.Visible;

            SetState(IslandState.Notification);
            RestartNotificationTimer();
        }

        private void RestartNotificationTimer()
        {
            StopTimer(ref _notificationTimer);
            _notificationTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromSeconds(Math.Max(1, _settings.NotificationTimeout)),
            };
            _notificationTimer.Tick += (s, e) =>
            {
                StopTimer(ref _notificationTimer);
                if (_state == IslandState.Notification)
                    ReturnToCollapsed();
            };
            _notificationTimer.Start();
        }

        private void OnShelfChanged()
        {
            if (_state == IslandState.Expanded)
            {
                RefreshShelf();
                ResizeToState();
            }
        }

        private void FlashShelfTitle(string message)
        {
            _shelfTitle.Text = message;
            StopTimer(ref _shelfTitleTimer);
            _shelfTitleTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            _shelfTitleTimer.Tick += (s, e) =>
            {
                StopTimer(ref _shelfTitleTimer);
                _shelfTitle.Text = "Fichiers";
            };
            _shelfTitleTimer.Start();
        }

        // --------------------------------------------------------- interactions

        private void OnPillPressed(object sender, MouseButtonEventArgs e)
        {
            // Panneau ouvert : ce clic n'a été pris par aucun bouton, c'est donc
            // un clic sur le fond, et il referme.
            if (_state == IslandState.Expanded)
            {
                Collapse();
                return;
            }

            Expand();
        }

        private void OnKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape && _state == IslandState.Expanded)
            {
                Collapse();
                e.Handled = true;
            }
        }

        private void OnWheel(object sender, MouseWheelEventArgs e)
        {
            if (!_settings.ScrollVolume || !_audio.Available || _state == IslandState.Expanded)
                return;

            double delta = e.Delta > 0 ? 0.05 : -0.05;
            _audio.Volume = _audio.Volume + delta;
            ShowOsd(_audio.Muted ? Theme.GlyphMute : Theme.GlyphVolume, _audio.Volume);
            e.Handled = true;
        }

        private void OnHoverChanged(bool hovering)
        {
            if (_state == IslandState.Notification)
            {
                if (hovering)
                    StopTimer(ref _notificationTimer);
                else
                    RestartNotificationTimer();
            }

        }

        private void ShowContextMenu()
        {
            var menu = new ContextMenu();

            var settingsItem = new MenuItem { Header = "Réglages" };
            settingsItem.Click += (s, e) => OpenSettings();
            menu.Items.Add(settingsItem);

            var startupItem = new MenuItem
            {
                Header = "Démarrer avec Windows",
                IsCheckable = true,
                IsChecked = ShortcutService.IsStartupEnabled(),
            };
            startupItem.Click += (s, e) =>
            {
                ShortcutService.SetStartupEnabled(startupItem.IsChecked);
                _settings.StartWithWindows = startupItem.IsChecked;
                _settings.Save();
            };
            menu.Items.Add(startupItem);

            menu.Items.Add(new Separator());

            var quitItem = new MenuItem { Header = "Quitter" };
            quitItem.Click += (s, e) => Quit();
            menu.Items.Add(quitItem);

            menu.PlacementTarget = _pill;
            menu.IsOpen = true;
        }

        private void OpenSettings()
        {
            Collapse();
            var window = new SettingsWindow(_settings);
            window.Show();
            window.Activate();
        }

        // ------------------------------------------------------ glisser-deposer

        private void OnDragEnter(object sender, DragEventArgs e)
        {
            if (!_settings.ShowShelf || !e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                e.Effects = DragDropEffects.None;
                e.Handled = true;
                return;
            }

            _dragOverPill = true;
            e.Effects = DragDropEffects.Copy;
            e.Handled = true;

            _bannerTitle.Text = "Déposer ici";
            _bannerBody.Text = "Le fichier restera à portée de main";
            _bannerBody.Visibility = Visibility.Visible;
            if (_state != IslandState.Expanded)
                SetState(IslandState.Notification);
        }

        private void OnDragOver(object sender, DragEventArgs e)
        {
            e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop) && _settings.ShowShelf
                ? DragDropEffects.Copy
                : DragDropEffects.None;
            e.Handled = true;
        }

        private void OnDragLeave(object sender, DragEventArgs e)
        {
            if (!_dragOverPill)
                return;
            _dragOverPill = false;
            if (_state == IslandState.Notification)
                ReturnToCollapsed();
        }

        private void OnDrop(object sender, DragEventArgs e)
        {
            _dragOverPill = false;
            e.Handled = true;

            if (!e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                ReturnToCollapsed();
                return;
            }

            var paths = e.Data.GetData(DataFormats.FileDrop) as string[];
            int added = paths != null ? _shelf.Add(paths) : 0;

            if (_state == IslandState.Expanded)
            {
                RefreshShelf();
                FlashShelfTitle(added > 0 ? "Fichier posé" : "Déjà dans l'étagère");
                ResizeToState();
                return;
            }

            _bannerTitle.Text = added > 0
                ? (added > 1 ? added + " fichiers posés dans l'île" : "Fichier posé dans l'île")
                : "Déjà dans l'étagère";
            _bannerBody.Visibility = Visibility.Collapsed;
            SetState(IslandState.Notification);
            RestartNotificationTimer();
        }

        // -------------------------------------------------------------- reglages

        private void ApplySettings()
        {
            var background = Theme.Brush(_settings.BackgroundColor,
                Color.FromRgb(0, 0, 0), _settings.BackgroundOpacity);
            _pill.Background = background;

            if (_settings.BorderWidth > 0)
            {
                _pill.BorderBrush = Theme.Brush(_settings.BorderColor, Color.FromRgb(60, 60, 60));
                _pill.BorderThickness = new Thickness(_settings.BorderWidth);
            }
            else
            {
                _pill.BorderThickness = new Thickness(0);
            }

            if (_state == IslandState.Expanded)
                RefreshPanel();

            ResizeToState(false);
        }

        // ---------------------------------------------------------------- menage

        private void StopTimer(ref DispatcherTimer timer)
        {
            if (timer == null)
                return;
            timer.Stop();
            timer = null;
        }

        private void Quit()
        {
            Close();
            Application.Current.Shutdown();
        }

        private void OnClosed(object sender, EventArgs e)
        {
            StopTimer(ref _notificationTimer);
            StopTimer(ref _osdTimer);
            StopTimer(ref _compactTitleTimer);
            StopTimer(ref _shelfTitleTimer);
            StopTimer(ref _clockTimer);

            _media.Stop();
            _notifications.Stop();
            _audio.Dispose();

            if (_tray != null)
            {
                _tray.Visible = false;
                _tray.Dispose();
                _tray = null;
            }
        }
    }
}
