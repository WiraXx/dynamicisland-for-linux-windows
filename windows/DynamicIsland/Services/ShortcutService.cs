using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;

namespace DynamicIsland.Services
{
    /// <summary>
    /// Lancement des applications épinglées, et démarrage automatique.
    /// </summary>
    public static class ShortcutService
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValue = "DynamicIsland";

        /// <summary>Nom lisible d'un raccourci, pour l'affichage.</summary>
        public static string DisplayName(string path)
        {
            try
            {
                return Path.GetFileNameWithoutExtension(path);
            }
            catch (Exception)
            {
                return path;
            }
        }

        /// <summary>Icône du programme, convertie pour WPF.</summary>
        public static ImageSource LoadIcon(string path)
        {
            try
            {
                using (Icon icon = Icon.ExtractAssociatedIcon(path))
                {
                    if (icon == null)
                        return null;

                    ImageSource source = Imaging.CreateBitmapSourceFromHIcon(
                        icon.Handle,
                        Int32Rect.Empty,
                        BitmapSizeOptions.FromEmptyOptions());
                    source.Freeze();
                    return source;
                }
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Lance l'application. Si des fichiers sont fournis, ils lui sont
        /// passés en arguments : de quoi envoyer un fichier avec LocalSend
        /// sans passer par sa fenêtre d'ouverture.
        /// </summary>
        public static void Launch(string path, IReadOnlyList<string> files)
        {
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = path,
                    UseShellExecute = true,
                };

                if (files != null && files.Count > 0)
                {
                    var quoted = new List<string>();
                    foreach (string file in files)
                        quoted.Add("\"" + file + "\"");
                    startInfo.Arguments = string.Join(" ", quoted);
                }

                Process.Start(startInfo);
            }
            catch (Exception)
            {
                // Programme déplacé ou désinstallé : le raccourci reste, sans effet.
            }
        }

        public static bool IsStartupEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, false))
                {
                    return key?.GetValue(RunValue) != null;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        public static void SetStartupEnabled(bool enabled)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key == null)
                        return;

                    if (enabled)
                    {
                        string executable = Process.GetCurrentProcess().MainModule?.FileName;
                        if (!string.IsNullOrEmpty(executable))
                            key.SetValue(RunValue, "\"" + executable + "\"");
                    }
                    else
                    {
                        key.DeleteValue(RunValue, false);
                    }
                }
            }
            catch (Exception)
            {
                // Stratégie d'entreprise ou registre verrouillé.
            }
        }
    }
}
