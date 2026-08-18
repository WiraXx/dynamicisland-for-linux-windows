/* Briques d'interface réutilisées par l'île : pochette, carte média,
 * égaliseur animé, ligne de curseur et entrée de notification.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {formatAge, formatClock, hbox, setVertical, vbox} from './utils.js';

/** Pochette d'album, avec repli sur une icône générique. */
export const AlbumArt = GObject.registerClass(
class AlbumArt extends St.Widget {
    _init(size) {
        super._init({
            style_class: 'di-art',
            width: size,
            height: size,
            layout_manager: new Clutter.BinLayout(),
        });

        this._size = size;
        this._url = undefined;
        this._fallback = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: Math.round(size * 0.55),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._fallback);
    }

    setArt(url) {
        if (url === this._url)
            return;
        this._url = url;

        const path = this._localPath(url);
        if (path) {
            this.set_style(`background-image: url("${path}"); background-size: cover;`);
            this._fallback.hide();
        } else {
            this.set_style(null);
            this._fallback.show();
        }
    }

    /** St ne sait afficher qu'un fichier local : les pochettes distantes sont ignorées. */
    _localPath(url) {
        if (!url)
            return null;
        if (url.startsWith('/'))
            return url;
        if (!url.startsWith('file://'))
            return null;
        try {
            const [path] = GLib.filename_from_uri(url);
            return GLib.file_test(path, GLib.FileTest.EXISTS) ? path : null;
        } catch {
            return null;
        }
    }
});

/** Les quatre barres qui s'agitent quand la musique joue. */
export const Equalizer = GObject.registerClass(
class Equalizer extends St.BoxLayout {
    _init(barCount = 4) {
        super._init({
            style_class: 'di-equalizer',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._bars = [];
        this._timeoutId = 0;
        for (let i = 0; i < barCount; i++) {
            const bar = new St.Widget({
                style_class: 'di-equalizer-bar',
                width: 3,
                height: 4,
                y_align: Clutter.ActorAlign.END,
            });
            this._bars.push(bar);
            this.add_child(bar);
        }

        // Un acteur détruit par son parent ne passe pas par un destroy()
        // redéfini en JS : seul le signal est fiable.
        this.connect('destroy', () => this._stop());
    }

    setPlaying(playing) {
        if (playing) {
            this._start();
        } else {
            this._stop();
            this._bars.forEach(bar => {
                bar.remove_all_transitions();
                bar.height = 4;
            });
        }
    }

    _start() {
        if (this._timeoutId)
            return;
        this._pulse();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 280, () => {
            this._pulse();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _pulse() {
        for (const bar of this._bars) {
            bar.remove_all_transitions();
            bar.ease({
                height: 4 + Math.round(Math.random() * 12),
                duration: 260,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            });
        }
    }

    _stop() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }
});

/** Icône + curseur, utilisé pour le volume et la luminosité. */
export const SliderRow = GObject.registerClass({
    Signals: {
        'value-changed': {param_types: [GObject.TYPE_DOUBLE]},
        'icon-clicked': {},
    },
}, class SliderRow extends St.BoxLayout {
    _init(iconName) {
        super._init({style_class: 'di-slider-row', x_expand: true});

        this._button = new St.Button({
            style_class: 'di-icon-button',
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button.connect('clicked', () => this.emit('icon-clicked'));
        this.add_child(this._button);

        this._slider = new Slider(0);
        this._slider.style_class = 'di-slider';
        this._slider.x_expand = true;
        this._slider.y_align = Clutter.ActorAlign.CENTER;
        this._slider.connect('notify::value', () => {
            if (!this._syncing)
                this.emit('value-changed', this._slider.value);
        });
        this.add_child(this._slider);
    }

    /** Met le curseur à jour sans réémettre le signal (sinon on boucle). */
    setValue(value) {
        this._syncing = true;
        this._slider.value = Math.max(0, Math.min(1, value));
        this._syncing = false;
    }

    setIcon(iconName) {
        this._button.child.icon_name = iconName;
    }
});

/** Carte du lecteur : pochette, titre, transport et progression. */
export const MediaCard = GObject.registerClass(
class MediaCard extends St.BoxLayout {
    _init(media) {
        super._init({style_class: 'di-media', x_expand: true});
        setVertical(this, true);

        this._media = media;
        this._dragging = false;
        this._pollId = 0;
        this._length = 0;

        const top = hbox({style_class: 'di-media-top', x_expand: true});

        this._art = new AlbumArt(56);
        const artButton = new St.Button({
            style_class: 'di-art-button',
            child: this._art,
            y_align: Clutter.ActorAlign.CENTER,
        });
        artButton.connect('clicked', () => this._media.raise());
        top.add_child(artButton);

        const info = vbox({style_class: 'di-media-info', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._title = new St.Label({style_class: 'di-media-title', text: ''});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist = new St.Label({style_class: 'di-media-artist', text: '', opacity: 170});
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        info.add_child(this._title);
        info.add_child(this._artist);
        top.add_child(info);

        const controls = hbox({style_class: 'di-media-controls', y_align: Clutter.ActorAlign.CENTER});
        this._prev = this._makeButton('media-skip-backward-symbolic', () => this._media.previous());
        this._play = this._makeButton('media-playback-start-symbolic', () => this._media.playPause());
        this._next = this._makeButton('media-skip-forward-symbolic', () => this._media.next());
        this._play.add_style_class_name('di-play-button');
        controls.add_child(this._prev);
        controls.add_child(this._play);
        controls.add_child(this._next);
        top.add_child(controls);

        this.add_child(top);

        const progress = hbox({style_class: 'di-media-progress', x_expand: true});
        this._elapsed = new St.Label({style_class: 'di-media-time', text: '0:00', opacity: 150});
        this._total = new St.Label({style_class: 'di-media-time', text: '0:00', opacity: 150});
        this._seek = new Slider(0);
        this._seek.style_class = 'di-slider';
        this._seek.x_expand = true;
        this._seek.y_align = Clutter.ActorAlign.CENTER;
        this._seek.connect('drag-begin', () => {
            this._dragging = true;
        });
        this._seek.connect('drag-end', () => {
            this._dragging = false;
            this._media.seek(this._seek.value);
        });
        progress.add_child(this._elapsed);
        progress.add_child(this._seek);
        progress.add_child(this._total);
        this.add_child(progress);

        this.connect('destroy', () => this.setPolling(false));
    }

    _makeButton(iconName, callback) {
        const button = new St.Button({
            style_class: 'di-icon-button',
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
        });
        button.connect('clicked', () => callback());
        return button;
    }

    /** Recopie l'état du lecteur dans la carte. */
    update() {
        const info = this._media.info;
        if (!info)
            return;

        this._title.text = info.title;
        this._artist.text = info.artist || info.appName;
        this._artist.visible = Boolean(this._artist.text);
        this._art.setArt(info.artUrl);

        this._play.child.icon_name = info.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._prev.reactive = info.canGoPrevious;
        this._next.reactive = info.canGoNext;
        this._prev.opacity = info.canGoPrevious ? 255 : 100;
        this._next.opacity = info.canGoNext ? 255 : 100;

        this._length = info.length;
        this._seek.reactive = info.canSeek && info.length > 0;
        this._total.text = formatClock(info.length);
        this.visible = true;
    }

    /** Démarre/arrête le rafraîchissement de la progression (1 Hz). */
    setPolling(active) {
        if (active && !this._pollId) {
            this._refreshPosition();
            this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._refreshPosition();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!active && this._pollId) {
            GLib.Source.remove(this._pollId);
            this._pollId = 0;
        }
    }

    _refreshPosition() {
        if (this._dragging || !this._length)
            return;
        this._media.getPosition(position => {
            if (this._dragging)
                return;
            this._elapsed.text = formatClock(position);
            this._seek.value = Math.max(0, Math.min(1, position / this._length));
        });
    }
});

/** Une notification dans l'historique du panneau. */
export const NotificationRow = GObject.registerClass({
    Signals: {'activated': {}},
}, class NotificationRow extends St.Button {
    _init(record) {
        super._init({style_class: 'di-notification-row', x_expand: true, can_focus: true});

        this._record = record;

        const row = hbox({style_class: 'di-notification-inner', x_expand: true});
        row.add_child(makeNotificationIcon(record, 20));

        const text = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const title = new St.Label({style_class: 'di-notification-title', text: record.title});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        if (record.body) {
            const body = new St.Label({style_class: 'di-notification-body', text: record.body, opacity: 175});
            body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(body);
        }
        row.add_child(text);

        row.add_child(new St.Label({
            style_class: 'di-notification-age',
            text: formatAge(record.timestamp),
            opacity: 140,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this.set_child(row);
        this.connect('clicked', () => {
            try {
                this._record.notification?.activate();
            } catch {
                // La notification a pu être détruite entre-temps.
            }
            this.emit('activated');
        });
    }
});

/** Icône d'une notification, avec repli symbolique. */
export function makeNotificationIcon(record, size) {
    const icon = new St.Icon({
        style_class: 'di-notification-icon',
        icon_size: size,
        y_align: Clutter.ActorAlign.CENTER,
    });
    if (record?.gicon)
        icon.gicon = record.gicon;
    else
        icon.icon_name = 'preferences-system-notifications-symbolic';
    return icon;
}
