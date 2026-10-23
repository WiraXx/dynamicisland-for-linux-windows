/* Briques d'interface réutilisées par l'île : pochette, carte média,
 * égaliseur animé, ligne de curseur et entrée de notification.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {BarLevel} from 'resource:///org/gnome/shell/ui/barLevel.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {formatAge, formatClock, hbox, setVertical, vbox} from './utils.js';

/** Bouton rond ne portant qu'une icône. */
export function makeIconButton(iconName, callback, iconSize = 14, styleClass = 'di-icon-button') {
    const button = new St.Button({
        style_class: styleClass,
        child: new St.Icon({icon_name: iconName, icon_size: iconSize}),
        y_align: Clutter.ActorAlign.CENTER,
    });
    button.connect('clicked', () => callback());
    return button;
}

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

/** Trois points qui s'allument à tour de rôle, façon indicateur Siri. */
export const ThinkingDots = GObject.registerClass(
class ThinkingDots extends St.BoxLayout {
    _init() {
        super._init({style_class: 'di-ai-dots', y_align: Clutter.ActorAlign.CENTER});

        this._dots = [0, 1, 2].map(() => {
            const dot = new St.Widget({style_class: 'di-ai-dot', opacity: 60});
            this.add_child(dot);
            return dot;
        });
        this._timeoutId = 0;
        this._step = 0;
        this.connect('destroy', () => this.setActive(false));
    }

    setActive(active) {
        if (active === Boolean(this._timeoutId))
            return;

        if (!active) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
            this._dots.forEach(dot => {
                dot.remove_all_transitions();
                dot.opacity = 60;
            });
            return;
        }

        const tick = () => {
            this._dots.forEach((dot, i) => {
                dot.remove_all_transitions();
                dot.ease({
                    opacity: i === this._step ? 255 : 60,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                });
            });
            this._step = (this._step + 1) % this._dots.length;
            return GLib.SOURCE_CONTINUE;
        };
        tick();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 320, tick);
    }
});

/** Bulle de conversation, à l'iMessage : alignée à gauche ou à droite. */
export const AiBubble = GObject.registerClass(
class AiBubble extends St.BoxLayout {
    _init(fromUser) {
        super._init({
            style_class: `di-ai-bubble ${fromUser ? 'di-ai-bubble-user' : 'di-ai-bubble-assistant'}`,
            x_align: fromUser ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
            x_expand: true,
        });

        this._label = new St.Label({style_class: 'di-ai-bubble-text'});
        this._label.clutter_text.line_wrap = true;
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.add_child(this._label);
    }

    setText(text) {
        this._label.text = text;
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

/** Précédent / lecture-pause / suivant, en icônes du thème. */
export const MediaControls = GObject.registerClass(
class MediaControls extends St.BoxLayout {
    _init(media, {iconSize = 16, styleClass = 'di-media-controls', highlightPlay = true} = {}) {
        super._init({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});

        this._media = media;
        this._iconSize = iconSize;

        this._previous = this._button('media-skip-backward-symbolic', () => this._media.previous());
        this._play = this._button('media-playback-start-symbolic', () => this._media.playPause());
        this._next = this._button('media-skip-forward-symbolic', () => this._media.next());
        if (highlightPlay)
            this._play.add_style_class_name('di-play-button');

        this.add_child(this._previous);
        this.add_child(this._play);
        this.add_child(this._next);
    }

    _button(iconName, callback) {
        const button = new St.Button({
            style_class: 'di-icon-button',
            child: new St.Icon({icon_name: iconName, icon_size: this._iconSize}),
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', () => callback());
        return button;
    }

    /** Recopie l'état du lecteur : icône de lecture et boutons disponibles. */
    update(info) {
        if (!info)
            return;

        this._play.child.icon_name = info.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        this._previous.reactive = info.canGoPrevious;
        this._previous.opacity = info.canGoPrevious ? 255 : 100;
        this._next.reactive = info.canGoNext;
        this._next.opacity = info.canGoNext ? 255 : 100;
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

        this._controls = new MediaControls(this._media);
        top.add_child(this._controls);

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

    /** Recopie l'état du lecteur dans la carte. */
    update() {
        const info = this._media.info;
        if (!info)
            return;

        this._title.text = info.title;
        this._artist.text = info.artist || info.appName;
        this._artist.visible = Boolean(this._artist.text);
        this._art.setArt(info.artUrl);

        this._controls.update(info);

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

/**
 * Contenu d'un OSD : icône, jauge et pourcentage.
 *
 * Les paramètres sont ceux que GNOME passe à son propre OSD, repris tels
 * quels — volume, luminosité, micro… tout arrive par le même chemin.
 */
export const OsdRow = GObject.registerClass(
class OsdRow extends St.BoxLayout {
    _init() {
        super._init({style_class: 'di-osd', x_expand: true, y_expand: true});

        this._icon = new St.Icon({
            style_class: 'di-osd-icon',
            icon_size: 18,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            style_class: 'di-osd-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._level = new BarLevel({
            style_class: 'di-osd-level',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._value = new St.Label({
            style_class: 'di-osd-value',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.add_child(this._icon);
        this.add_child(this._label);
        this.add_child(this._level);
        this.add_child(this._value);
    }

    update(icon, label, level, maxLevel) {
        this._icon.gicon = null;
        if (typeof icon === 'string') {
            this._icon.icon_name = icon;
        } else if (icon) {
            try {
                this._icon.gicon = icon;
            } catch {
                this._icon.icon_name = 'audio-volume-high-symbolic';
            }
        } else {
            this._icon.icon_name = 'audio-volume-high-symbolic';
        }

        this._label.text = label ?? '';
        this._label.visible = Boolean(label);

        const hasLevel = typeof level === 'number' && Number.isFinite(level);
        this._level.visible = hasLevel;
        this._value.visible = hasLevel;
        if (!hasLevel)
            return;

        // Au-delà de 100 %, GNOME annonce un maximum plus grand (sur-amplification) ;
        // la jauge marque alors le 100 % par un repère.
        const maximum = typeof maxLevel === 'number' && maxLevel > 1 ? maxLevel : 1;
        try {
            this._level.maximum_value = maximum;
            this._level.overdrive_start = Math.min(1, maximum);
        } catch {
            // Une version qui refuse ces valeurs garde simplement sa jauge par défaut.
        }
        this._level.value = Math.max(0, Math.min(level, maximum));
        this._value.text = `${Math.round(level * 100)} %`;
    }
});

/** Distance à parcourir pour qu'un glissement latéral supprime la ligne. */
const SWIPE_THRESHOLD = 70;

/** GNOME 45 passait des objets simples, 46+ des objets Action. */
function invokeAction(action) {
    try {
        if (typeof action.activate === 'function')
            action.activate();
        else if (typeof action.callback === 'function')
            action.callback();
    } catch (error) {
        logError(error, 'Dynamic Island: action de notification impossible');
    }
}

/**
 * Boutons d'action d'une notification, ou null s'il n'y en a aucune.
 *
 * GNOME n'implémente pas la réponse en ligne du protocole freedesktop — ni en
 * 48, ni en 49 : le shell ne reçoit jamais de canal de réponse de la part de
 * l'application. Ce qu'une messagerie propose (« Répondre », « Marquer comme
 * lu »…) passe par ses actions, et c'est ce qu'on affiche ici.
 */
export function makeActionButtons(record, onActivated, max = 3) {
    let actions = [];
    try {
        actions = record?.notification?.actions ?? [];
    } catch {
        return null;
    }
    if (actions.length === 0)
        return null;

    const box = hbox({style_class: 'di-notification-actions'});
    for (const action of actions.slice(0, max)) {
        const label = action?.label;
        if (!label)
            continue;
        const button = new St.Button({style_class: 'di-action-button', label});
        button.connect('clicked', () => {
            invokeAction(action);
            onActivated?.();
        });
        box.add_child(button);
    }
    return box.get_n_children() > 0 ? box : null;
}

/**
 * Une notification dans l'historique du panneau.
 *
 * Se glisse sur le côté pour être supprimée, et affiche les actions que
 * l'application a jointes à sa notification — dont le « Répondre » des
 * messageries, qui ouvre la conversation.
 */
export const NotificationRow = GObject.registerClass({
    Signals: {'activated': {}, 'dismissed': {}},
}, class NotificationRow extends St.Button {
    _init(record, showActions = true) {
        super._init({style_class: 'di-notification-row', x_expand: true, can_focus: true});

        this._record = record;
        this._dragStartX = 0;
        this._dragging = false;
        this._swiped = false;

        const content = vbox({x_expand: true});

        const row = hbox({style_class: 'di-notification-inner', x_expand: true});
        row.add_child(makeNotificationIcon(record, 20));

        const text = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const title = new St.Label({style_class: 'di-notification-title', text: record.title});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        if (record.body) {
            const body = new St.Label({
                style_class: 'di-notification-body',
                text: record.body,
                opacity: 175,
            });
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
        content.add_child(row);

        const actions = this._buildActions(showActions);
        if (actions)
            content.add_child(actions);

        this.set_child(content);

        this.connect('clicked', () => {
            if (this._swiped) {
                this._swiped = false;
                return;
            }
            this._activateNotification();
        });
        this.connect('button-press-event', (_actor, event) => this._onPress(event));
        this.connect('motion-event', (_actor, event) => this._onMotion(event));
        this.connect('button-release-event', (_actor, event) => this._onRelease(event));
    }

    _buildActions(showActions) {
        if (!showActions)
            return null;
        return makeActionButtons(this._record, () => this.emit('activated'));
    }

    _activateNotification() {
        try {
            this._record.notification?.activate();
        } catch {
            // La notification a pu être détruite entre-temps.
        }
        this.emit('activated');
    }

    // --- Glissement latéral -------------------------------------------------

    _onPress(event) {
        [this._dragStartX] = event.get_coords();
        this._dragging = true;
        this._swiped = false;
        this.remove_all_transitions();
        // On laisse St.Button traiter l'appui : sans quoi il n'y aurait plus de clic.
        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion(event) {
        if (!this._dragging)
            return Clutter.EVENT_PROPAGATE;

        const [x] = event.get_coords();
        const delta = x - this._dragStartX;
        if (Math.abs(delta) < 5)
            return Clutter.EVENT_PROPAGATE;

        this._swiped = true;
        this.translation_x = delta;
        this.opacity = Math.max(70, 255 - Math.abs(delta) * 2);
        return Clutter.EVENT_STOP;
    }

    _onRelease(event) {
        if (!this._dragging)
            return Clutter.EVENT_PROPAGATE;
        this._dragging = false;

        const delta = this.translation_x;
        if (Math.abs(delta) >= SWIPE_THRESHOLD) {
            this.dismiss(delta > 0 ? 1 : -1);
            return Clutter.EVENT_STOP;
        }

        this.ease({
            translation_x: 0,
            opacity: 255,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        // Un glissement avorté ne doit pas se transformer en clic.
        return this._swiped ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    /** Fait sortir la ligne par le côté, puis annonce la suppression. */
    dismiss(direction = 1) {
        this.reactive = false;
        this.ease({
            translation_x: direction * 400,
            opacity: 0,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.emit('dismissed'),
        });
    }
});

/** Un fichier posé dans l'étagère. */
export const ShelfRow = GObject.registerClass({
    Signals: {
        'copy-requested': {},
        'open-requested': {},
        'remove-requested': {},
        'selection-toggled': {},
    },
}, class ShelfRow extends St.Button {
    _init(info, selected) {
        super._init({style_class: 'di-shelf-row', x_expand: true, can_focus: true});

        if (selected)
            this.add_style_class_name('di-shelf-row-selected');

        const row = hbox({style_class: 'di-shelf-inner', x_expand: true});
        row.add_child(new St.Icon({
            gicon: info.gicon,
            icon_size: 18,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const name = new St.Label({
            style_class: 'di-shelf-name',
            text: info.name,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: info.exists ? 255 : 120,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        row.add_child(name);

        row.add_child(makeIconButton('edit-copy-symbolic', () => this.emit('copy-requested')));
        row.add_child(makeIconButton('document-open-symbolic', () => this.emit('open-requested')));
        row.add_child(makeIconButton('window-close-symbolic', () => this.emit('remove-requested')));

        this.set_child(row);
        this.connect('clicked', () => this.emit('selection-toggled'));
    }
});

/**
 * Rangée de raccourcis vers des applications.
 *
 * Si des fichiers sont sélectionnés dans l'étagère, ils sont passés à
 * l'application lancée — de quoi envoyer un fichier avec LocalSend en deux
 * clics.
 */
export const AppShortcuts = GObject.registerClass({
    Signals: {'launched': {}},
}, class AppShortcuts extends St.BoxLayout {
    _init(getSelectedUris) {
        super._init({style_class: 'di-shortcuts', x_expand: true});
        this._getSelectedUris = getSelectedUris;
    }

    /** Reconstruit la rangée depuis la liste d'identifiants .desktop. */
    setApps(ids) {
        this.destroy_all_children();

        for (const id of ids) {
            const button = this._buildButton(id);
            if (button)
                this.add_child(button);
        }
        this.visible = this.get_n_children() > 0;
    }

    _buildButton(id) {
        const app = Shell.AppSystem.get_default().lookup_app(id);
        const appInfo = app?.get_app_info?.() ?? this._desktopInfo(id);
        if (!app && !appInfo)
            return null;

        const button = new St.Button({style_class: 'di-shortcut-button', can_focus: true});
        const icon = new St.Icon({icon_size: 26});
        const gicon = appInfo?.get_icon?.();
        if (gicon)
            icon.gicon = gicon;
        else
            icon.icon_name = 'application-x-executable-symbolic';
        button.set_child(icon);

        const name = appInfo?.get_display_name?.() ?? id.replace(/\.desktop$/, '');
        button.accessible_name = name;

        button.connect('clicked', () => {
            this._launch(app, appInfo);
            this.emit('launched');
        });
        return button;
    }

    _desktopInfo(id) {
        try {
            return Gio.DesktopAppInfo.new(id);
        } catch {
            return null;
        }
    }

    _launch(app, appInfo) {
        const uris = this._getSelectedUris?.() ?? [];
        try {
            if (uris.length > 0 && appInfo) {
                appInfo.launch_uris(uris, global.create_app_launch_context(0, -1));
                return;
            }
            if (app)
                app.activate();
            else
                appInfo?.launch([], global.create_app_launch_context(0, -1));
        } catch (error) {
            logError(error, 'Dynamic Island: lancement de l’application impossible');
        }
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
