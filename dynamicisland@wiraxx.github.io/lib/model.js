/* Emplacement et téléchargement du modèle d'IA locale.
 *
 * Ce module ne dépend que de GLib et Gio : il sert aussi à la fenêtre de
 * réglages, qui tourne dans un autre processus que le shell.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function modelDir() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'dynamicisland', 'models']);
}

export function modelPath(settings) {
    const url = settings.get_string('ai-model-url');
    return GLib.build_filenamev([modelDir(), GLib.path_get_basename(url)]);
}

export function isModelInstalled(settings) {
    return GLib.file_test(modelPath(settings), GLib.FileTest.EXISTS);
}

/**
 * Télécharge le modèle avec curl, dans un fichier .part renommé à la fin :
 * un téléchargement interrompu ne laisse jamais un modèle invalide.
 * `onDone(error)` reçoit null en cas de succès.
 */
export function downloadModel(settings, onDone) {
    const target = modelPath(settings);
    const partial = `${target}.part`;

    try {
        GLib.mkdir_with_parents(modelDir(), 0o755);
        const process = Gio.Subprocess.new(
            ['curl', '--location', '--fail', '--silent', '--show-error',
                '--output', partial, settings.get_string('ai-model-url')],
            Gio.SubprocessFlags.STDERR_PIPE);

        process.communicate_utf8_async(null, null, (proc, res) => {
            try {
                const [, , stderr] = proc.communicate_utf8_finish(res);
                if (!proc.get_successful())
                    throw new Error(stderr.trim() || 'téléchargement échoué');
                if (GLib.rename(partial, target) !== 0)
                    throw new Error('impossible de ranger le modèle');
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
