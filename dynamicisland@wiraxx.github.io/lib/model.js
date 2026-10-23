/* Emplacement et téléchargement des modèles d'IA locale : le modèle de
 * conversation, et optionnellement un modèle de vision (GGUF + projecteur
 * « mmproj ») pour l'action qui décrit l'écran.
 *
 * Ce module ne dépend que de GLib et Gio : il sert aussi à la fenêtre de
 * réglages, qui tourne dans un autre processus que le shell.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function modelDir() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'dynamicisland', 'models']);
}

/** Chemin local du fichier dont l'URL est rangée dans la clé `urlKey`, ou null si vide. */
export function pathForSetting(settings, urlKey) {
    const url = settings.get_string(urlKey);
    if (!url)
        return null;
    return GLib.build_filenamev([modelDir(), GLib.path_get_basename(url)]);
}

export function isInstalled(settings, urlKey) {
    const path = pathForSetting(settings, urlKey);
    return Boolean(path) && GLib.file_test(path, GLib.FileTest.EXISTS);
}

// Conservés pour le modèle de conversation : ce sont les seuls appels déjà en place ailleurs.
export function modelPath(settings) {
    return pathForSetting(settings, 'ai-model-url');
}

export function isModelInstalled(settings) {
    return isInstalled(settings, 'ai-model-url');
}

/**
 * Télécharge le fichier dont l'URL est rangée dans `urlKey`, avec curl, dans
 * un fichier .part renommé à la fin : un téléchargement interrompu ne laisse
 * jamais un fichier invalide. `onDone(error)` reçoit null en cas de succès.
 */
export function downloadFile(settings, urlKey, onDone) {
    const target = pathForSetting(settings, urlKey);
    if (!target) {
        onDone('URL vide');
        return;
    }
    const partial = `${target}.part`;

    try {
        GLib.mkdir_with_parents(modelDir(), 0o755);
        const process = Gio.Subprocess.new(
            ['curl', '--location', '--fail', '--silent', '--show-error',
                '--output', partial, settings.get_string(urlKey)],
            Gio.SubprocessFlags.STDERR_PIPE);

        process.communicate_utf8_async(null, null, (proc, res) => {
            try {
                const [, , stderr] = proc.communicate_utf8_finish(res);
                if (!proc.get_successful())
                    throw new Error(stderr.trim() || 'téléchargement échoué');
                if (GLib.rename(partial, target) !== 0)
                    throw new Error('impossible de ranger le fichier');
                onDone(null);
            } catch (error) {
                GLib.unlink(partial);
                onDone(error.message);
            }
        });
    } catch (error) {
        onDone(error.message);
    }
}

export function downloadModel(settings, onDone) {
    downloadFile(settings, 'ai-model-url', onDone);
}
