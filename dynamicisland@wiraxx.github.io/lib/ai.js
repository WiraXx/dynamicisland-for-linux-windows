/* Moteur de l'assistant : lance `llama-server` (llama.cpp) sur le modèle
 * téléchargé, puis lui envoie les questions et lit la réponse au fil de l'eau.
 *
 * Soup n'est pas une dépendance de gnome-shell : son typelib peut manquer sur
 * certains systèmes. On le charge donc à la demande, au premier message, pour
 * qu'une absence n'empêche jamais l'île elle-même d'apparaître.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {describeAction, extractAction, runAction} from './actions.js';
import {isInstalled, pathForSetting} from './model.js';

const PORT = 8765;
const VISION_PORT = 8766;
const HISTORY_MAX = 10;
const START_ATTEMPTS = 40;
// Un modèle de vision est plus lourd à charger qu'un modèle de conversation.
const VISION_START_ATTEMPTS = 90;
const SYSTEM_PROMPT = 'Tu es un assistant concis, en français, en quelques phrases. '
    + 'Si on te demande de lire un fichier, de chercher des fichiers, d\'ouvrir une '
    + 'application, de faire une recherche web ou de regarder ce qui est affiché à '
    + 'l\'écran, réponds uniquement par une ligne au format ACTION: nom("argument"), '
    + 'où nom vaut read_file, search_files, open_app, web_search ou read_screen '
    + '(sans argument utile pour celle-ci, laisse "" ). N\'utilise une action que si '
    + 'elle est vraiment utile ; sinon réponds normalement, sans jamais inventer de '
    + 'résultat toi-même.';
const VISION_PROMPT = 'Décris brièvement et en français ce que montre cette capture d\'écran.';

export class AiAssistant {
    constructor(settings) {
        this._settings = settings;
        this._process = null;
        this._visionProcess = null;
        this._soup = null;
        this._session = null;
        this._cancellable = new Gio.Cancellable();
        this._history = [];
    }

    /** Charge libsoup au premier besoin ; rejette si le typelib est absent. */
    async _ensureSoup() {
        if (this._soup)
            return this._soup;
        const module = await import('gi://Soup?version=3.0');
        this._soup = module.default;
        this._session = new this._soup.Session();
        return this._soup;
    }

    /**
     * Envoie `text`. `onToken` reçoit chaque fragment de réponse, `onDone`
     * est appelé une fois la réponse complète, `onError` en cas d'échec.
     * Si le modèle demande une action (lecture de fichier, recherche…), elle
     * est exécutée puis le modèle en commente le résultat en une seconde
     * passe — jamais plus d'une action par message envoyé.
     */
    ask(text, onToken, onDone, onError) {
        const fail = message => {
            this._history.pop();
            onError(message);
        };

        this._history.push({role: 'user', content: text});

        this._ensureSoup().then(() => {
            try {
                this._startServer();
            } catch (error) {
                fail(error.message);
                return;
            }
            this._completeAndAct(onToken, onDone, fail, 0);
        }).catch(() => fail('bibliothèque libsoup3 introuvable : installe « gir1.2-soup-3.0 »'));
    }

    /** Une passe de complétion ; `depth` vaut 1 une fois une action déjà exécutée. */
    _completeAndAct(onToken, onDone, onError, depth) {
        const body = JSON.stringify({
            messages: [{role: 'system', content: SYSTEM_PROMPT}, ...this._history],
            stream: true,
            temperature: 0.7,
        });

        let answer = '';
        this._post(PORT, this._process, body, 0, START_ATTEMPTS, stream => {
            this._readStream(stream,
                token => {
                    answer += token;
                    onToken(token);
                },
                () => this._afterCompletion(answer, onToken, onDone, onError, depth),
                onError);
        }, onError);
    }

    _afterCompletion(answer, onToken, onDone, onError, depth) {
        this._history.push({role: 'assistant', content: answer});
        this._history = this._history.slice(-HISTORY_MAX);

        const action = depth === 0 ? extractAction(answer) : null;
        if (!action) {
            onDone();
            return;
        }

        onToken(`\n\n⚙ ${describeAction(action)}\n`);
        this._runAndDescribe(action).then(result => {
            this._history.push({role: 'user', content: `[Résultat] ${result}`});
            this._completeAndAct(onToken, onDone, onError, depth + 1);
        }).catch(error => {
            this._history.push({role: 'user', content: `[Résultat] échec : ${error.message}`});
            onToken(`⚠ ${error.message}\n`);
            onDone();
        });
    }

    /** `read_screen` renvoie un chemin d'image : il faut encore la faire décrire par le modèle de vision. */
    _runAndDescribe(action) {
        if (action.type !== 'read_screen')
            return runAction(action);

        return runAction(action).then(path =>
            this._describeImage(path).finally(() => GLib.unlink(path)));
    }

    /** Lance le serveur de conversation au premier besoin ; il reste actif jusqu'à destroy(). */
    _startServer() {
        if (this._process && !this._process.get_if_exited())
            return;

        if (!isInstalled(this._settings, 'ai-model-url'))
            throw new Error('modèle absent : télécharge-le dans les réglages');

        const binary = GLib.find_program_in_path('llama-server');
        if (!binary)
            throw new Error('llama-server introuvable : installe llama.cpp');

        this._process = Gio.Subprocess.new([
            binary, '--model', pathForSetting(this._settings, 'ai-model-url'),
            '--host', '127.0.0.1', '--port', String(PORT), '--ctx-size', '2048',
        ], Gio.SubprocessFlags.NONE);
    }

    /** Lance le serveur de vision (--mmproj) au premier besoin ; distinct du serveur de conversation. */
    _startVisionServer() {
        if (this._visionProcess && !this._visionProcess.get_if_exited())
            return;

        if (!isInstalled(this._settings, 'ai-vision-model-url') ||
            !isInstalled(this._settings, 'ai-vision-mmproj-url')) {
            throw new Error('modèle de vision absent : configure-le dans les réglages '
                + '(section Assistant IA, sous-section Vision)');
        }

        const binary = GLib.find_program_in_path('llama-server');
        if (!binary)
            throw new Error('llama-server introuvable : installe llama.cpp');

        this._visionProcess = Gio.Subprocess.new([
            binary,
            '--model', pathForSetting(this._settings, 'ai-vision-model-url'),
            '--mmproj', pathForSetting(this._settings, 'ai-vision-mmproj-url'),
            '--host', '127.0.0.1', '--port', String(VISION_PORT), '--ctx-size', '4096',
        ], Gio.SubprocessFlags.NONE);
    }

    /** Lit le fichier image, démarre le serveur de vision et en récupère une description. */
    _describeImage(path) {
        return new Promise((resolve, reject) => {
            let contents;
            try {
                this._startVisionServer();
                [, contents] = GLib.file_get_contents(path);
            } catch (error) {
                reject(error);
                return;
            }

            const body = JSON.stringify({
                messages: [{
                    role: 'user',
                    content: [
                        {type: 'text', text: VISION_PROMPT},
                        {type: 'image_url', image_url: {
                            url: `data:image/png;base64,${GLib.base64_encode(contents)}`,
                        }},
                    ],
                }],
                stream: true,
                temperature: 0.4,
            });

            let answer = '';
            this._post(VISION_PORT, this._visionProcess, body, 0, VISION_START_ATTEMPTS, stream => {
                this._readStream(stream,
                    token => { answer += token; },
                    () => resolve(answer.trim() || '(aucune description)'),
                    message => reject(new Error(message)));
            }, message => reject(new Error(message)));
        });
    }

    /**
     * Envoie la requête au serveur du port donné ; celui-ci met un moment à charger
     * son modèle au premier appel, d'où les nouvelles tentatives tant qu'il tourne
     * encore mais ne répond pas.
     */
    _post(port, process, body, attempt, maxAttempts, onStream, onError) {
        const Soup = this._soup;
        const message = Soup.Message.new('POST', `http://127.0.0.1:${port}/v1/chat/completions`);
        message.set_request_body_from_bytes('application/json',
            GLib.Bytes.new(new TextEncoder().encode(body)));

        this._session.send_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
            let stream;
            try {
                stream = session.send_finish(res);
            } catch (error) {
                const starting = process && !process.get_if_exited();
                if (starting && attempt < maxAttempts && !this._cancellable.is_cancelled()) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        this._post(port, process, body, attempt + 1, maxAttempts, onStream, onError);
                        return GLib.SOURCE_REMOVE;
                    });
                    return;
                }
                onError(process?.get_if_exited()
                    ? 'llama-server s\'est arrêté'
                    : error.message);
                return;
            }

            if (message.get_status() !== Soup.Status.OK) {
                onError(`serveur : erreur HTTP ${message.get_status()}`);
                return;
            }
            onStream(stream);
        });
    }

    /** Lit le flux SSE ligne par ligne jusqu'au marqueur [DONE]. */
    _readStream(stream, onToken, onDone, onError) {
        const reader = new Gio.DataInputStream({base_stream: stream, close_base_stream: true});
        let finished = false;
        const finish = () => {
            if (!finished) {
                finished = true;
                onDone();
            }
        };

        const next = () => {
            reader.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (source, res) => {
                let line;
                try {
                    [line] = source.read_line_finish_utf8(res);
                } catch (error) {
                    if (!this._cancellable.is_cancelled())
                        onError(error.message);
                    return;
                }

                if (line === null) {
                    finish();
                    return;
                }
                if (!line.startsWith('data: ')) {
                    next();
                    return;
                }

                const data = line.slice('data: '.length);
                if (data === '[DONE]') {
                    finish();
                    return;
                }
                try {
                    const delta = JSON.parse(data).choices?.[0]?.delta?.content ?? '';
                    if (delta)
                        onToken(delta);
                } catch {
                    // Ligne SSE mal formée : on passe à la suivante.
                }
                next();
            });
        };
        next();
    }

    destroy() {
        this._cancellable.cancel();
        this._session?.abort();
        if (this._process && !this._process.get_if_exited())
            this._process.force_exit();
        if (this._visionProcess && !this._visionProcess.get_if_exited())
            this._visionProcess.force_exit();
        this._process = null;
        this._visionProcess = null;
    }
}
