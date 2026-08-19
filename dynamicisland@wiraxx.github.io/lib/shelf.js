/* Étagère à fichiers.
 *
 * GNOME Shell ne peut pas recevoir un fichier déposé depuis Nautilus : le
 * gestionnaire XDND du shell (js/ui/xdndHandler.js) suit la position du
 * curseur pendant un glisser, mais aucune donnée ne lui est transmise et
 * aucun dépôt ne lui est délivré — seule une fenêtre peut être destinataire.
 *
 * On passe donc par le presse-papier, qui transporte exactement la même
 * chose (une liste d'URI) : copier un fichier le fait apparaître ici, et un
 * clic le remet dans le presse-papier pour le coller ailleurs.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

const SHELF_MAX = 8;
const URI_MIME = 'text/uri-list';

export const FileShelf = GObject.registerClass({
    Signals: {'changed': {}},
}, class FileShelf extends GObject.Object {
    _init(settings) {
        super._init();

        this._settings = settings;
        this._uris = settings.get_strv('shelf-files');
        this._selected = new Set();
        this._selection = null;
        this._selectionId = 0;

        this._watchClipboard();
    }

    /** Surveille les copies de fichiers pour les déposer ici automatiquement. */
    _watchClipboard() {
        try {
            const selection = global.display.get_selection();
            this._selectionId = selection.connect('owner-changed', (_selection, type) => {
                if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
                    return;
                if (!this._settings.get_boolean('shelf-auto-capture'))
                    return;
                this.captureClipboard();
            });
            this._selection = selection;
        } catch (error) {
            log('Dynamic Island : surveillance du presse-papier indisponible, ' +
                'le bouton « coller » de l’étagère reste utilisable.');
        }
    }

    /** Lit le presse-papier et ajoute les fichiers qui s'y trouvent. */
    captureClipboard(onDone = null) {
        St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, URI_MIME,
            (_clipboard, bytes) => {
                const uris = this._parseUriList(bytes);
                if (uris.length)
                    this.addUris(uris);
                onDone?.(uris.length);
            });
    }

    _parseUriList(bytes) {
        const data = bytes?.get_data?.();
        if (!data || data.length === 0)
            return [];

        let text;
        try {
            text = new TextDecoder().decode(data);
        } catch {
            return [];
        }

        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            // Nautilus ajoute une ligne « copy » ou « cut » en tête.
            .filter(line => line.startsWith('file://'))
            .filter(uri => Gio.File.new_for_uri(uri).query_exists(null));
    }

    get uris() {
        return [...this._uris];
    }

    get isEmpty() {
        return this._uris.length === 0;
    }

    get selectedUris() {
        return this._uris.filter(uri => this._selected.has(uri));
    }

    isSelected(uri) {
        return this._selected.has(uri);
    }

    toggleSelection(uri) {
        if (this._selected.has(uri))
            this._selected.delete(uri);
        else
            this._selected.add(uri);
        this.emit('changed');
    }

    /** Ajoute des fichiers en tête, sans doublon, et retient les plus récents. */
    addUris(uris) {
        const added = uris.filter(uri => !this._uris.includes(uri));
        if (added.length === 0)
            return 0;

        this._uris = [...added, ...this._uris].slice(0, SHELF_MAX);
        this._persist();
        return added.length;
    }

    remove(uri) {
        const index = this._uris.indexOf(uri);
        if (index < 0)
            return;
        this._uris.splice(index, 1);
        this._selected.delete(uri);
        this._persist();
    }

    clear() {
        if (this.isEmpty)
            return;
        this._uris = [];
        this._selected.clear();
        this._persist();
    }

    _persist() {
        this._settings.set_strv('shelf-files', this._uris);
        this.emit('changed');
    }

    /** Remet un fichier dans le presse-papier, prêt à être collé ailleurs. */
    copyToClipboard(uri) {
        const clipboard = St.Clipboard.get_default();
        const bytes = new GLib.Bytes(new TextEncoder().encode(`${uri}\r\n`));
        try {
            clipboard.set_content(St.ClipboardType.CLIPBOARD, URI_MIME, bytes);
        } catch (error) {
            logError(error, 'Dynamic Island: copie du fichier impossible');
            return false;
        }
        return true;
    }

    /** Ouvre le fichier avec l'application par défaut. */
    open(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
            return true;
        } catch (error) {
            logError(error, 'Dynamic Island: ouverture du fichier impossible');
            return false;
        }
    }

    /** Nom et icône d'un fichier, pour l'affichage. */
    describe(uri) {
        const file = Gio.File.new_for_uri(uri);
        const fallback = {
            uri,
            name: decodeURIComponent(file.get_basename() ?? uri),
            gicon: new Gio.ThemedIcon({name: 'text-x-generic-symbolic'}),
            exists: false,
        };

        try {
            const info = file.query_info(
                `${Gio.FILE_ATTRIBUTE_STANDARD_ICON},${Gio.FILE_ATTRIBUTE_STANDARD_DISPLAY_NAME}`,
                Gio.FileQueryInfoFlags.NONE, null);
            return {
                uri,
                name: info.get_display_name() || fallback.name,
                gicon: info.get_icon() ?? fallback.gicon,
                exists: true,
            };
        } catch {
            // Fichier déplacé ou supprimé depuis : on garde la ligne, barrée.
            return fallback;
        }
    }

    /** Retire de l'étagère les fichiers qui n'existent plus. */
    pruneMissing() {
        const alive = this._uris.filter(uri => Gio.File.new_for_uri(uri).query_exists(null));
        if (alive.length === this._uris.length)
            return;
        this._uris = alive;
        this._persist();
    }

    destroy() {
        if (this._selection && this._selectionId) {
            this._selection.disconnect(this._selectionId);
            this._selectionId = 0;
        }
        this._selection = null;
    }
});
