using System;
using System.Threading;
using System.Windows;
using DynamicIsland.UI;

namespace DynamicIsland
{
    /// <summary>
    /// Point d'entrée. L'interface est construite en C# : il n'y a ni XAML ni
    /// App.xaml, ce qui évite toute divergence entre le balisage et le code.
    /// </summary>
    public static class Program
    {
        private static Mutex _instanceLock;

        [STAThread]
        public static void Main()
        {
            // Une seule île à la fois, sinon on empile les pilules à l'écran.
            _instanceLock = new Mutex(true, "DynamicIsland.SingleInstance", out bool isFirst);
            if (!isFirst)
                return;

            var application = new Application
            {
                ShutdownMode = ShutdownMode.OnExplicitShutdown,
            };

            var settings = AppSettings.Load();
            var island = new IslandWindow(settings);
            island.Show();

            application.Run();
            _instanceLock.ReleaseMutex();
        }
    }
}
