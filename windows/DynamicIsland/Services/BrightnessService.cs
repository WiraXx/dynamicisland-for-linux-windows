using System;
using System.Management;

namespace DynamicIsland.Services
{
    /// <summary>
    /// Luminosité de l'écran, par WMI. Absente sur les machines de bureau :
    /// seuls les écrans pilotés par le portable répondent.
    /// </summary>
    public class BrightnessService
    {
        private const string Scope = @"\\.\root\wmi";

        public bool Available { get; private set; }

        public BrightnessService()
        {
            Available = TryRead(out _);
        }

        private bool TryRead(out int percent)
        {
            percent = 0;
            try
            {
                using (var searcher = new ManagementObjectSearcher(Scope, "SELECT * FROM WmiMonitorBrightness"))
                using (var results = searcher.Get())
                {
                    foreach (ManagementObject monitor in results)
                    {
                        using (monitor)
                        {
                            percent = Convert.ToInt32(monitor["CurrentBrightness"]);
                            return true;
                        }
                    }
                }
            }
            catch (Exception)
            {
                // WMI absent, ou écran non pilotable.
            }
            return false;
        }

        /// <summary>Luminosité de 0 à 1.</summary>
        public double Brightness
        {
            get => TryRead(out int percent) ? percent / 100.0 : 0;
            set
            {
                if (!Available)
                    return;

                byte percent = (byte)Math.Max(0, Math.Min(100, Math.Round(value * 100)));
                try
                {
                    using (var searcher = new ManagementObjectSearcher(Scope, "SELECT * FROM WmiMonitorBrightnessMethods"))
                    using (var results = searcher.Get())
                    {
                        foreach (ManagementObject method in results)
                        {
                            using (method)
                            {
                                method.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, percent });
                            }
                        }
                    }
                }
                catch (Exception)
                {
                    Available = false;
                }
            }
        }
    }
}
