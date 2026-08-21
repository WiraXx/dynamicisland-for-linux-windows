using System;
using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace DynamicIsland.Services
{
    /// <summary>
    /// Volume du périphérique de sortie par défaut, via CoreAudio.
    /// Le niveau est relu régulièrement : c'est ainsi qu'on voit les
    /// changements venus d'ailleurs (touches multimédia, mélangeur Windows).
    /// </summary>
    public class AudioService : IDisposable
    {
        private const int RenderDataFlow = 0;   // eRender
        private const int ConsoleRole = 0;      // eConsole
        private const int InProcServer = 1;     // CLSCTX_INPROC_SERVER

        private IAudioEndpointVolume _endpoint;
        private Guid _context = Guid.Empty;
        private DispatcherTimer _timer;
        private double _lastVolume = -1;
        private bool _lastMuted;

        public event EventHandler Changed;

        public bool Available => _endpoint != null;

        public AudioService()
        {
            Connect();

            _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            _timer.Tick += (s, e) => Poll();
            _timer.Start();
        }

        private void Connect()
        {
            try
            {
                var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                if (enumerator.GetDefaultAudioEndpoint(RenderDataFlow, ConsoleRole, out IMMDevice device) != 0
                    || device == null)
                    return;

                Guid iid = typeof(IAudioEndpointVolume).GUID;
                if (device.Activate(ref iid, InProcServer, IntPtr.Zero, out object instance) != 0)
                    return;

                _endpoint = instance as IAudioEndpointVolume;
            }
            catch (Exception)
            {
                // Pas de carte son, ou service audio arrêté : les curseurs de
                // volume resteront simplement masqués.
                _endpoint = null;
            }
        }

        private void Poll()
        {
            if (_endpoint == null)
            {
                Connect();
                return;
            }

            double volume = Volume;
            bool muted = Muted;
            if (Math.Abs(volume - _lastVolume) < 0.001 && muted == _lastMuted)
                return;

            _lastVolume = volume;
            _lastMuted = muted;
            Changed?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Volume principal, de 0 à 1.</summary>
        public double Volume
        {
            get
            {
                if (_endpoint == null)
                    return 0;
                try
                {
                    if (_endpoint.GetMasterVolumeLevelScalar(out float level) == 0)
                        return level;
                }
                catch (COMException)
                {
                    _endpoint = null;
                }
                return 0;
            }
            set
            {
                if (_endpoint == null)
                    return;
                float level = (float)Math.Max(0, Math.Min(1, value));
                try
                {
                    _endpoint.SetMasterVolumeLevelScalar(level, ref _context);
                    if (level > 0 && Muted)
                        Muted = false;
                }
                catch (COMException)
                {
                    _endpoint = null;
                }
            }
        }

        public bool Muted
        {
            get
            {
                if (_endpoint == null)
                    return false;
                try
                {
                    if (_endpoint.GetMute(out bool muted) == 0)
                        return muted;
                }
                catch (COMException)
                {
                    _endpoint = null;
                }
                return false;
            }
            set
            {
                if (_endpoint == null)
                    return;
                try
                {
                    _endpoint.SetMute(value, ref _context);
                }
                catch (COMException)
                {
                    _endpoint = null;
                }
            }
        }

        public void ToggleMute()
        {
            Muted = !Muted;
        }

        public void Dispose()
        {
            _timer?.Stop();
            _timer = null;
            if (_endpoint != null)
            {
                Marshal.ReleaseComObject(_endpoint);
                _endpoint = null;
            }
        }
    }
}
