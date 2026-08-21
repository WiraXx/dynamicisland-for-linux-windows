using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace DynamicIsland
{
    /// <summary>
    /// Réglages de l'île, enregistrés en JSON dans %APPDATA%\DynamicIsland.
    /// Ce sont les mêmes que la version GNOME, à quelques ajouts près propres
    /// à Windows (démarrage automatique).
    /// </summary>
    public class AppSettings
    {
        // Géométrie
        public int PillWidth { get; set; } = 150;
        public int PillHeight { get; set; } = 30;
        public int CornerRadius { get; set; } = 15;
        public string Position { get; set; } = "top-center";
        public int OffsetX { get; set; }
        public int OffsetY { get; set; } = 2;
        public int Monitor { get; set; } = -1;
        public int ExpandedWidth { get; set; } = 400;
        public int ExpandedMaxHeight { get; set; } = 640;

        // Apparence
        public string BackgroundColor { get; set; } = "#000000";
        public double BackgroundOpacity { get; set; } = 1.0;
        public string TextColor { get; set; } = "#FFFFFF";
        public int BorderWidth { get; set; }
        public string BorderColor { get; set; } = "#3C3C3C";
        public double AnimationSpeed { get; set; } = 1.0;

        // Comportement
        public int NotificationTimeout { get; set; } = 5;
        public int CompactTitleDuration { get; set; } = 3;
        public bool ShowNotifications { get; set; } = true;
        public bool ShowNotificationActions { get; set; } = true;
        public bool ShowMedia { get; set; } = true;
        public bool ShowBrightness { get; set; } = true;
        public bool ShowOsd { get; set; } = true;
        public bool ShowShelf { get; set; } = true;
        public bool HoverPeek { get; set; } = true;
        public bool ScrollVolume { get; set; } = true;
        public bool AutoHide { get; set; }
        public bool StartWithWindows { get; set; }

        // Contenus
        public List<string> AppShortcuts { get; set; } = new List<string>();
        public List<string> ShelfFiles { get; set; } = new List<string>();

        /// <summary>Prévient l'île qu'un réglage a changé, pour l'appliquer à chaud.</summary>
        public event EventHandler Changed;

        public static string Directory =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "DynamicIsland");

        public static string FilePath => Path.Combine(Directory, "settings.json");

        public static AppSettings Load()
        {
            try
            {
                if (File.Exists(FilePath))
                {
                    string json = File.ReadAllText(FilePath);
                    var loaded = JsonSerializer.Deserialize<AppSettings>(json);
                    if (loaded != null)
                        return loaded;
                }
            }
            catch (Exception)
            {
                // Fichier illisible ou corrompu : on repart des valeurs d'origine
                // plutôt que d'empêcher l'île de démarrer.
            }
            return new AppSettings();
        }

        public void Save()
        {
            try
            {
                System.IO.Directory.CreateDirectory(Directory);
                string json = JsonSerializer.Serialize(this, new JsonSerializerOptions
                {
                    WriteIndented = true,
                });
                File.WriteAllText(FilePath, json);
            }
            catch (Exception)
            {
                // Disque plein ou dossier verrouillé : on garde les réglages en
                // mémoire pour la session en cours.
            }
        }

        public void NotifyChanged()
        {
            Save();
            Changed?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Remet tous les réglages d'apparence et de comportement d'origine.</summary>
        public void ResetToDefaults()
        {
            var fresh = new AppSettings();
            PillWidth = fresh.PillWidth;
            PillHeight = fresh.PillHeight;
            CornerRadius = fresh.CornerRadius;
            Position = fresh.Position;
            OffsetX = fresh.OffsetX;
            OffsetY = fresh.OffsetY;
            Monitor = fresh.Monitor;
            ExpandedWidth = fresh.ExpandedWidth;
            ExpandedMaxHeight = fresh.ExpandedMaxHeight;
            BackgroundColor = fresh.BackgroundColor;
            BackgroundOpacity = fresh.BackgroundOpacity;
            TextColor = fresh.TextColor;
            BorderWidth = fresh.BorderWidth;
            BorderColor = fresh.BorderColor;
            AnimationSpeed = fresh.AnimationSpeed;
            NotificationTimeout = fresh.NotificationTimeout;
            CompactTitleDuration = fresh.CompactTitleDuration;
            ShowNotifications = fresh.ShowNotifications;
            ShowNotificationActions = fresh.ShowNotificationActions;
            ShowMedia = fresh.ShowMedia;
            ShowBrightness = fresh.ShowBrightness;
            ShowOsd = fresh.ShowOsd;
            ShowShelf = fresh.ShowShelf;
            HoverPeek = fresh.HoverPeek;
            ScrollVolume = fresh.ScrollVolume;
            AutoHide = fresh.AutoHide;
            NotifyChanged();
        }
    }
}
