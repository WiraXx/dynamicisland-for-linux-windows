/* Capture des notifications du shell, et mise à l'écart des bannières natives
 * pour que l'île soit le seul endroit où elles apparaissent.
 */

import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {stripMarkup} from './utils.js';

/** Distance de mise hors champ de la bannière GNOME (en pixels). */
const BANNER_PARKING = 4000;

export const NotificationWatcher = GObject.registerClass({
    Signals: {
        'notification': {param_types: [GObject.TYPE_JSOBJECT]},
    },
}, class NotificationWatcher extends GObject.Object {
    _init(settings) {
        super._init();

        this._settings = settings;
        this._sources = new Map();  // source → id du signal
        this._bannerBin = null;
        this._bannerOpacityId = 0;

        const tray = Main.messageTray;
        this._sourceAddedId = tray.connect('source-added', (_tray, source) => this._addSource(source));
        this._sourceRemovedId = tray.connect('source-removed', (_tray, source) => this._removeSource(source));
        tray.getSources().forEach(source => this._addSource(source));

        this._settingsId = this._settings.connect('changed::hide-native-banners',
            () => this._syncBannerSuppression());
        this._syncBannerSuppression();
    }

    _addSource(source) {
        if (this._sources.has(source))
            return;
        const id = source.connect('notification-added',
            (_source, notification) => this._onNotification(source, notification));
        this._sources.set(source, id);
    }

    _removeSource(source) {
        const id = this._sources.get(source);
        if (!id)
            return;
        try {
            source.disconnect(id);
        } catch {
            // La source est déjà partie, rien à faire.
        }
        this._sources.delete(source);
    }

    _onNotification(source, notification) {
        if (!this._settings.get_boolean('show-notifications'))
            return;

        this.emit('notification', {
            title: stripMarkup(notification.title) || source.title || 'Notification',
            body: stripMarkup(notification.body),
            gicon: this._iconFor(source, notification),
            appName: source.title ?? '',
            timestamp: Date.now(),
            transient: notification.isTransient ?? false,
            notification,
        });
    }

    /** L'icône a changé de place au fil des versions : on prend la première qui répond. */
    _iconFor(source, notification) {
        const candidates = [
            notification.gicon,
            notification.icon,
            source.icon,
            source.gicon,
        ];
        for (const candidate of candidates) {
            if (candidate)
                return candidate;
        }
        try {
            return source.getIcon?.() ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Masquage des bannières GNOME.
     *
     * Plutôt que de neutraliser la machine à états du message tray — qui se
     * retrouverait bloquée —, on déplace simplement son conteneur hors de
     * l'écran et on force son opacité à zéro. Les animations internes se
     * terminent normalement, la zone cliquable suit la transformation, et
     * tout revient en place à la désactivation.
     */
    _syncBannerSuppression() {
        const enabled = this._settings.get_boolean('hide-native-banners');
        const bin = Main.messageTray._bannerBin;
        if (!bin) {
            log('Dynamic Island : conteneur de bannières introuvable, ' +
                'les notifications natives de GNOME restent visibles.');
            return;
        }

        if (enabled) {
            if (this._bannerBin)
                return;
            this._bannerBin = bin;
            bin.set_translation(0, -BANNER_PARKING, 0);
            bin.opacity = 0;
            this._bannerOpacityId = bin.connect('notify::opacity', () => {
                if (bin.opacity !== 0)
                    bin.opacity = 0;
            });
        } else {
            this._restoreBanner();
        }
    }

    _restoreBanner() {
        if (!this._bannerBin)
            return;
        if (this._bannerOpacityId) {
            this._bannerBin.disconnect(this._bannerOpacityId);
            this._bannerOpacityId = 0;
        }
        this._bannerBin.set_translation(0, 0, 0);
        this._bannerBin.opacity = 255;
        this._bannerBin = null;
    }

    destroy() {
        this._restoreBanner();

        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }

        const tray = Main.messageTray;
        if (this._sourceAddedId) {
            tray.disconnect(this._sourceAddedId);
            this._sourceAddedId = 0;
        }
        if (this._sourceRemovedId) {
            tray.disconnect(this._sourceRemovedId);
            this._sourceRemovedId = 0;
        }
        for (const source of [...this._sources.keys()])
            this._removeSource(source);
        this._sources.clear();
    }
});
