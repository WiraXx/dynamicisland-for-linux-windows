/* Moteur de l'assistant : lance `llama-server` (llama.cpp) sur le modèle
 * téléchargé, puis lui envoie les questions et lit la réponse au fil de l'eau.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {isModelInstalled, modelPath} from './model.js';

const PORT = 8765;
const HISTORY_MAX = 10;
const START_ATTEMPTS = 40;
const SYSTEM_PROMPT = 'Tu es un assistant concis. Réponds en français, en quelques phrases.';

export class AiAssistant {
    constructor(settings) {
        this._settings = settings;
        this._process = null;
        this._session = new Soup.Session();
        this._cancellable = new Gio.Cancellable();
        this._history = [];
    }

    /**
     * Envoie `text`. `onToken` reçoit chaque fragment de réponse, `onDone`
     * est appelé une fois la réponse complète, `onError` en cas d'échec.
     */
    ask(text, onToken, onDone, onError) {
        const fail = message => {
            this._history.pop();
            onError(message);
        };

        try {
            this._startServer();
        } catch (error) {
            onError(error.message);
            return;
        }

        this._history.push({role: 'user', content: text});
        const body = JSON.stringify({
            messages: [{role: 'system', content: SYSTEM_PROMPT}, ...this._history],
            stream: true,
            temperature: 0.7,
        });

        let answer = '';
        this._post(body, 0, stream => {
            this._readStream(stream,
                token => {
                    answer += token;
                    onToken(token);
                },
                () => {
                    this._history.push({role: 'assistant', content: answer});
                    this._history = this._history.slice(-HISTORY_MAX);
                    onDone();
                },
                fail);
        }, fail);
    }

    /** Lance le serveur au premier besoin ; il reste actif jusqu'à destroy(). */
    _startServer() {
        if (this._process && !this._process.get_if_exited())
            return;

        if (!isModelInstalled(this._settings))
            throw new Error('modèle absent : télécharge-le dans les réglages');

        const binary = GLib.find_program_in_path('llama-server');
        if (!binary)
            throw new Error('llama-server introuvable : installe llama.cpp');

        this._process = Gio.Subprocess.new([
            binary, '--model', modelPath(this._settings),
            '--host', '127.0.0.1', '--port', String(PORT), '--ctx-size', '2048',
        ], Gio.SubprocessFlags.NONE);
    }

    /** Envoie la requête ; le serveur met quelques secondes à charger le modèle, d'où les nouvelles tentatives. */
    _post(body, attempt, onStream, onError) {
        const message = Soup.Message.new('POST', `http://127.0.0.1:${PORT}/v1/chat/completions`);
        message.set_request_body_from_bytes('application/json',
            GLib.Bytes.new(new TextEncoder().encode(body)));

        this._session.send_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (session, res) => {
            let stream;
            try {
                stream = session.send_finish(res);
            } catch (error) {
                const starting = this._process && !this._process.get_if_exited();
                if (starting && attempt < START_ATTEMPTS && !this._cancellable.is_cancelled()) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        this._post(body, attempt + 1, onStream, onError);
                        return GLib.SOURCE_REMOVE;
                    });
                    return;
                }
                onError(this._process?.get_if_exited()
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
        this._session.abort();
        if (this._process && !this._process.get_if_exited())
            this._process.force_exit();
        this._process = null;
    }
}
