/* Actions que l'assistant peut déclencher lui-même, à la demande du modèle.
 *
 * Volontairement limitées et jamais passées par un shell : pas de commande
 * arbitraire, seulement ces quatre gestes précis, chacun avec ses propres
 * garde-fous. `read_file` et `search_files` restent sous le dossier personnel.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const READ_MAX_BYTES = 200 * 1000;
const SEARCH_MAX_RESULTS = 20;
const SEARCH_TIMEOUT_MS = 4000;

// Sous-dossiers du HOME jamais lus ni listés, même sur demande explicite.
const BLOCKED_SUBDIRS = ['.ssh', '.gnupg', '.local/share/keyrings', '.mozilla', '.config/syncthing'];

export const ACTIONS = ['read_file', 'search_files', 'open_app', 'web_search', 'read_screen'];

/** Reconnaît `ACTION: nom("argument")` dans la réponse du modèle. */
export function extractAction(text) {
    const match = text.match(/ACTION:\s*(\w+)\(\s*["']([^"']*)["']\s*\)/);
    if (!match || !ACTIONS.includes(match[1]))
        return null;
    return {type: match[1], arg: match[2].trim()};
}

export function describeAction(action) {
    switch (action.type) {
    case 'read_file': return `Lecture de ${action.arg}`;
    case 'search_files': return `Recherche de fichiers : « ${action.arg} »`;
    case 'open_app': return `Ouverture de ${action.arg}`;
    case 'web_search': return `Recherche web : « ${action.arg} »`;
    case 'read_screen': return 'Lecture de l\'écran';
    default: return action.type;
    }
}

/** Résout un chemin sous le dossier personnel, ou null s'il en sort. */
function resolveHomePath(rawPath) {
    const home = GLib.get_home_dir();
    if (!rawPath)
        return null;

    const absolute = rawPath.startsWith('/') ? rawPath : GLib.build_filenamev([home, rawPath]);
    const canon = GLib.canonicalize_filename(absolute, null);
    if (canon !== home && !canon.startsWith(`${home}/`))
        return null;
    if (BLOCKED_SUBDIRS.some(dir => canon === `${home}/${dir}` || canon.startsWith(`${home}/${dir}/`)))
        return null;
    return canon;
}

function readFile(rawPath) {
    const path = resolveHomePath(rawPath);
    if (!path)
        return Promise.reject(new Error('chemin hors du dossier personnel, refusé'));

    return new Promise((resolve, reject) => {
        const file = Gio.File.new_for_path(path);
        file.load_contents_async(null, (source, res) => {
            try {
                const [, contents] = source.load_contents_finish(res);
                const text = new TextDecoder('utf-8', {fatal: false}).decode(contents);
                const truncated = contents.length > READ_MAX_BYTES;
                resolve((truncated ? `${text.slice(0, READ_MAX_BYTES)}\n[…tronqué…]` : text) || '(fichier vide)');
            } catch (error) {
                reject(new Error(`lecture impossible : ${error.message}`));
            }
        });
    });
}

/** `find` en argv direct, sans shell : la requête ne peut rien injecter. */
function searchFiles(query) {
    if (!query)
        return Promise.reject(new Error('requête vide'));

    const home = GLib.get_home_dir();
    const excludes = BLOCKED_SUBDIRS.flatMap(dir => ['-path', `${home}/${dir}`, '-prune', '-o']);
    const argv = ['find', home, ...excludes,
        '-iname', `*${query.replace(/\0/g, '')}*`, '-print'];

    return new Promise((resolve, reject) => {
        let process;
        try {
            process = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (error) {
            reject(new Error(error.message));
            return;
        }

        const cancellable = new Gio.Cancellable();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_TIMEOUT_MS, () => {
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });

        process.communicate_utf8_async(null, cancellable, (proc, res) => {
            try {
                const [, stdout] = proc.communicate_utf8_finish(res);
                const results = stdout.split('\n').filter(Boolean).slice(0, SEARCH_MAX_RESULTS);
                resolve(results.length ? results.join('\n') : 'aucun résultat');
            } catch {
                resolve('recherche interrompue (trop longue)');
            }
        });
    });
}

/** Ne lance que des applications déjà installées, jamais un exécutable arbitraire. */
function openApp(name) {
    if (!name)
        return Promise.reject(new Error('nom d\'application vide'));

    const needle = name.toLowerCase();
    const match = Gio.AppInfo.get_all().find(app =>
        app.get_name()?.toLowerCase().includes(needle) ||
        app.get_display_name?.()?.toLowerCase().includes(needle) ||
        app.get_executable()?.toLowerCase().includes(needle));

    if (!match)
        return Promise.reject(new Error(`application « ${name} » introuvable`));

    try {
        match.launch([], null);
        return Promise.resolve(`${match.get_display_name() ?? name} lancé`);
    } catch (error) {
        return Promise.reject(new Error(error.message));
    }
}

/** Ouvre une recherche dans le navigateur par défaut ; jamais de requête réseau depuis l'extension. */
function webSearch(query) {
    if (!query)
        return Promise.reject(new Error('requête vide'));

    const uri = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    try {
        Gio.AppInfo.launch_default_for_uri(uri, null);
        return Promise.resolve(`recherche « ${query} » ouverte dans le navigateur`);
    } catch (error) {
        return Promise.reject(new Error(error.message));
    }
}

/**
 * Capture l'écran via l'API D-Bus publique de GNOME Shell (org.gnome.Shell.Screenshot),
 * stable depuis des années et pensée pour des tiers — contrairement aux classes internes
 * du shell, qui elles changent entre versions (St.ScrollView en a fait les frais ici).
 * Résout le chemin d'un PNG temporaire ; à l'appelant de le supprimer après usage.
 */
function screenshot() {
    const path = GLib.build_filenamev([GLib.get_tmp_dir(), `dynamicisland-${GLib.uuid_string_random()}.png`]);

    return new Promise((resolve, reject) => {
        Gio.DBusProxy.new(
            Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
            'org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot', 'org.gnome.Shell.Screenshot',
            null, (source, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_finish(res);
                } catch (error) {
                    reject(new Error(error.message));
                    return;
                }

                // (inclure le curseur, pas de flash, chemin de sortie) → (réussite, chemin réel)
                proxy.call('Screenshot', new GLib.Variant('(bbs)', [false, false, path]),
                    Gio.DBusCallFlags.NONE, 5000, null, (target, callRes) => {
                        try {
                            target.call_finish(callRes);
                            resolve(path);
                        } catch (error) {
                            reject(new Error(`capture d'écran impossible : ${error.message}`));
                        }
                    });
            });
    });
}

export function runAction(action) {
    switch (action.type) {
    case 'read_file': return readFile(action.arg);
    case 'search_files': return searchFiles(action.arg);
    case 'open_app': return openApp(action.arg);
    case 'web_search': return webSearch(action.arg);
    case 'read_screen': return screenshot();
    default: return Promise.reject(new Error('action inconnue'));
    }
}
