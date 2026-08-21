using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace DynamicIsland.Services
{
    /// <summary>Instantane de ce que joue Windows.</summary>
    public class MediaInfo
    {
        public string Title = string.Empty;
        public string Artist = string.Empty;
        public bool IsPlaying;
        public bool CanGoNext;
        public bool CanGoPrevious;
        public TimeSpan Position;
        public TimeSpan Duration;
        public ImageSource Thumbnail;
    }

    /// <summary>
    /// Lecteur en cours, par les controles de transport de Windows (SMTC) :
    /// la meme source que la fenetre de lecture du systeme, donc tout ce qui
    /// la remplit - Spotify, Firefox, Chrome, VLC - remplit l'ile.
    /// </summary>
    public class MediaService
    {
        private GlobalSystemMediaTransportControlsSessionManager _manager;
        private GlobalSystemMediaTransportControlsSession _session;
        private DispatcherTimer _timer;
        private string _thumbnailKey = string.Empty;
        private ImageSource _thumbnail;
        private bool _busy;

        public event EventHandler Changed;

        public MediaInfo Current { get; private set; }

        public bool HasSession => Current != null;

        public async void Start()
        {
            try
            {
                _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            }
            catch (Exception)
            {
                // Service indisponible : la section media restera masquee.
                return;
            }

            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _timer.Tick += async (s, e) => await PollAsync();
            _timer.Start();
            await PollAsync();
        }

        private async Task PollAsync()
        {
            if (_busy || _manager == null)
                return;
            _busy = true;

            try
            {
                _session = _manager.GetCurrentSession();
                if (_session == null)
                {
                    if (Current != null)
                    {
                        Current = null;
                        _thumbnailKey = string.Empty;
                        _thumbnail = null;
                        Changed?.Invoke(this, EventArgs.Empty);
                    }
                    return;
                }

                var properties = await _session.TryGetMediaPropertiesAsync();
                var playback = _session.GetPlaybackInfo();
                var timeline = _session.GetTimelineProperties();

                string title = properties?.Title ?? string.Empty;
                string artist = properties?.Artist ?? string.Empty;
                string key = title + " " + artist;

                if (key != _thumbnailKey)
                {
                    _thumbnailKey = key;
                    _thumbnail = await LoadThumbnailAsync(properties?.Thumbnail);
                }

                Current = new MediaInfo
                {
                    Title = string.IsNullOrWhiteSpace(title) ? "Lecture en cours" : title,
                    Artist = artist,
                    IsPlaying = playback != null && playback.PlaybackStatus ==
                        GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
                    CanGoNext = playback != null && playback.Controls.IsNextEnabled,
                    CanGoPrevious = playback != null && playback.Controls.IsPreviousEnabled,
                    Position = timeline != null ? timeline.Position : TimeSpan.Zero,
                    Duration = timeline != null ? timeline.EndTime : TimeSpan.Zero,
                    Thumbnail = _thumbnail,
                };

                Changed?.Invoke(this, EventArgs.Empty);
            }
            catch (Exception)
            {
                // Le lecteur a pu disparaitre entre deux appels.
            }
            finally
            {
                _busy = false;
            }
        }

        private async Task<ImageSource> LoadThumbnailAsync(IRandomAccessStreamReference reference)
        {
            if (reference == null)
                return null;

            try
            {
                using (var source = await reference.OpenReadAsync())
                using (var memory = new MemoryStream())
                {
                    await source.AsStreamForRead().CopyToAsync(memory);
                    memory.Position = 0;

                    var bitmap = new BitmapImage();
                    bitmap.BeginInit();
                    bitmap.CacheOption = BitmapCacheOption.OnLoad;
                    bitmap.StreamSource = memory;
                    bitmap.EndInit();
                    bitmap.Freeze();
                    return bitmap;
                }
            }
            catch (Exception)
            {
                return null;
            }
        }

        public async void PlayPause()
        {
            try
            {
                if (_session != null)
                    await _session.TryTogglePlayPauseAsync();
            }
            catch (Exception)
            {
            }
        }

        public async void Next()
        {
            try
            {
                if (_session != null)
                    await _session.TrySkipNextAsync();
            }
            catch (Exception)
            {
            }
        }

        public async void Previous()
        {
            try
            {
                if (_session != null)
                    await _session.TrySkipPreviousAsync();
            }
            catch (Exception)
            {
            }
        }

        /// <summary>Deplace la lecture, si le lecteur l'accepte.</summary>
        public async void Seek(double fraction)
        {
            try
            {
                if (_session == null || Current == null || Current.Duration <= TimeSpan.Zero)
                    return;

                double clamped = Math.Max(0, Math.Min(1, fraction));
                long ticks = (long)(Current.Duration.Ticks * clamped);
                await _session.TryChangePlaybackPositionAsync(ticks);
            }
            catch (Exception)
            {
            }
        }

        public void Stop()
        {
            if (_timer != null)
            {
                _timer.Stop();
                _timer = null;
            }
        }
    }
}
