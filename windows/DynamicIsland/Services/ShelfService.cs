using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace DynamicIsland.Services
{
    /// <summary>
    /// Étagère à fichiers.
    ///
    /// Sur Windows, contrairement à GNOME, la fenêtre peut être une vraie cible
    /// de dépôt : on glisse un fichier dans l'île, il y reste, et on peut le
    /// reglisser vers une autre fenêtre.
    /// </summary>
    public class ShelfService
    {
        private const int MaxFiles = 8;

        private readonly AppSettings _settings;
        private readonly HashSet<string> _selected =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public event EventHandler Changed;

        public ShelfService(AppSettings settings)
        {
            _settings = settings;
        }

        public IReadOnlyList<string> Files => _settings.ShelfFiles;

        public bool IsEmpty => _settings.ShelfFiles.Count == 0;

        public IReadOnlyList<string> SelectedFiles =>
            _settings.ShelfFiles.Where(path => _selected.Contains(path)).ToList();

        public bool IsSelected(string path) => _selected.Contains(path);

        public void ToggleSelection(string path)
        {
            if (!_selected.Remove(path))
                _selected.Add(path);
            Changed?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Ajoute des fichiers en tête, sans doublon.</summary>
        public int Add(IEnumerable<string> paths)
        {
            var added = paths
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Where(path => File.Exists(path) || Directory.Exists(path))
                .Where(path => !_settings.ShelfFiles.Contains(path, StringComparer.OrdinalIgnoreCase))
                .ToList();

            if (added.Count == 0)
                return 0;

            var updated = new List<string>(added);
            updated.AddRange(_settings.ShelfFiles);
            _settings.ShelfFiles = updated.Take(MaxFiles).ToList();
            Persist();
            return added.Count;
        }

        public void Remove(string path)
        {
            if (_settings.ShelfFiles.RemoveAll(entry =>
                    string.Equals(entry, path, StringComparison.OrdinalIgnoreCase)) == 0)
                return;
            _selected.Remove(path);
            Persist();
        }

        public void Clear()
        {
            if (IsEmpty)
                return;
            _settings.ShelfFiles.Clear();
            _selected.Clear();
            Persist();
        }

        /// <summary>Retire les fichiers déplacés ou supprimés depuis.</summary>
        public void PruneMissing()
        {
            int removed = _settings.ShelfFiles.RemoveAll(
                path => !File.Exists(path) && !Directory.Exists(path));
            if (removed > 0)
                Persist();
        }

        public string DisplayName(string path)
        {
            try
            {
                string name = Path.GetFileName(path);
                return string.IsNullOrEmpty(name) ? path : name;
            }
            catch (Exception)
            {
                return path;
            }
        }

        public bool Exists(string path)
        {
            try
            {
                return File.Exists(path) || Directory.Exists(path);
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>Ouvre le fichier avec l'application par défaut.</summary>
        public void Open(string path)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = path,
                    UseShellExecute = true,
                });
            }
            catch (Exception)
            {
                // Fichier disparu ou aucune application associée.
            }
        }

        /// <summary>Ouvre l'explorateur sur le fichier, sélectionné.</summary>
        public void Reveal(string path)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = "/select,\"" + path + "\"",
                    UseShellExecute = true,
                });
            }
            catch (Exception)
            {
            }
        }

        private void Persist()
        {
            _settings.Save();
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }
}
