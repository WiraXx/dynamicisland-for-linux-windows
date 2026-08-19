/* L'île elle-même : un seul acteur posé au-dessus du shell, qui change de
 * taille et de contenu selon ce qu'il a à raconter.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MediaPlayer} from './mediaPlayer.js';
import {NotificationWatcher} from './notifications.js';
import {FileShelf} from './shelf.js';
import {SystemControls} from './system.js';
import {
    AlbumArt, AppShortcuts, Equalizer, MediaCard, MediaControls, NotificationRow, OsdRow,
    ShelfRow, SliderRow, makeActionButtons, makeIconButton, makeNotificationIcon,
} from './widgets.js';
import {TimeoutPool, clamp, formatNow, hbox, toRgba, vbox} from './utils.js';

/** Les quatre visages de l'île. */
const State = {
    IDLE: 'idle',
    COMPACT: 'compact',
    NOTIFICATION: 'notification',
    OSD: 'osd',
    EXPANDED: 'expanded',
};

const HISTORY_MAX = 5;
const OSD_TIMEOUT = 1500;
const CONTENT_PADDING = 28;
const EXPANDED_RADIUS = 26;

export const Island = GObject.registerClass(
class Island extends St.Widget {
    _init(extension) {
        super._init({
            style_class: 'di-island',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            can_focus: true,
            clip_to_allocation: true,
        });

        this._extension = extension;
        this._settings = extension.getSettings();
        this._state = State.IDLE;
        this._timeouts = new TimeoutPool();
        this._history = [];
        this._grab = null;
        this._capturedId = 0;
        this._notificationTimer = 0;
        this._clockTimer = 0;
        this._compactTitleTimer = 0;
        this._osdTimer = 0;
        this._shelfTitleTimer = 0;
        this._osdPatched = false;
        this._compactShowsTitle = false;
        this._lastTrack = null;
        this._catcher = null;
        this._geometry = null;

        this.set_pivot_point(0.5, 0.5);

        this._media = new MediaPlayer();
        this._system = new SystemControls();
        this._notifications = new NotificationWatcher(this._settings);
        this._shelf = new FileShelf(this._settings);
        this._shelfCount = this._shelf.uris.length;

        this._buildViews();

        this._moduleIds = [
            [this._media, this._media.connect('changed', () => this._onMediaChanged())],
            [this._system, this._system.connect('volume-changed', () => this._onVolumeChanged())],
            [this._system, this._system.connect('brightness-changed', () => this._onBrightnessChanged())],
            [this._notifications, this._notifications.connect('notification',
                (_watcher, record) => this._onNotification(record))],
            [this._shelf, this._shelf.connect('changed', () => this._onShelfChanged())],
        ];

        this._settingsId = this._settings.connect('changed', (_settings, key) => this._onSettingChanged(key));
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            this._geometry = null;
            this._applyState(this._state, false);
        });

        this.connect('button-press-event', (_actor, event) => this._onButtonPress(event));
        this.connect('key-press-event', (_actor, event) => this._onKeyPress(event));
        // Le plein écran peut masquer l'île : le panneau ne doit pas rester
        // ouvert derrière, avec son calque de capture des clics.
        this.connect('notify::visible', () => {
            if (!this.visible)
                this.collapse();
        });
        this.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.connect('notify::hover', () => this._onHover());
        this.connect('destroy', () => this._onDestroy());

        this._addChrome();
        this._installOsdHook();
        this._updateStyle();
        this._onMediaChanged();
    }

    // ------------------------------------------------------------------ vues

    _buildViews() {
        this._compactView = this._buildCompactView();
        this._notificationView = this._buildNotificationView();
        this._osdView = new OsdRow();
        this._expandedView = this._buildExpandedView();

        this._views = [this._compactView, this._notificationView, this._osdView, this._expandedView];
        for (const view of this._views) {
            view.opacity = 0;
            view.hide();
            this.add_child(view);
        }
    }

    _buildCompactView() {
        const view = hbox({style_class: 'di-compact', x_expand: true, y_expand: true});

        this._compactArt = new AlbumArt(18);
        this._compactArt.add_style_class_name('di-art-small');
        view.add_child(this._compactArt);

        this._compactTitle = new St.Label({
            style_class: 'di-compact-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._compactTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._compactTitle.hide();
        view.add_child(this._compactTitle);

        this._equalizer = new Equalizer();
        this._equalizer.hide();
        view.add_child(this._equalizer);

        // Au repos, la pilule ne montre que la pochette et le transport :
        // elle garde ainsi exactement la taille réglée.
        this._compactControls = new MediaControls(this._media, {
            iconSize: 14,
            styleClass: 'di-compact-controls',
            highlightPlay: false,
        });
        view.add_child(this._compactControls);

        return view;
    }

    /**
     * Bascule entre les deux visages de la pilule : titre + égaliseur pendant
     * quelques secondes au changement de morceau, puis pochette + boutons.
     */
    _setCompactMode(showTitle) {
        this._compactShowsTitle = showTitle;
        this._compactTitle.visible = showTitle;
        this._equalizer.visible = showTitle;
        this._compactControls.visible = !showTitle;

        const info = this._currentMedia();
        this._equalizer.setPlaying(showTitle && info?.status === 'Playing');

        if (this._state === State.COMPACT) {
            this._geometry = null;
            this._applyState(State.COMPACT);
        }
    }

    /** Montre le titre le temps réglé, puis rétracte la pilule. */
    _flashCompactTitle() {
        this._timeouts.remove(this._compactTitleTimer);
        this._compactTitleTimer = 0;
        this._osdTimer = 0;
        this._shelfTitleTimer = 0;
        this._osdPatched = false;

        const seconds = this._settings.get_int('compact-title-duration');
        if (seconds <= 0) {
            this._setCompactMode(false);
            return;
        }

        this._setCompactMode(true);
        this._compactTitleTimer = this._timeouts.add(seconds * 1000, () => {
            this._compactTitleTimer = 0;
        this._osdTimer = 0;
        this._shelfTitleTimer = 0;
        this._osdPatched = false;
            this._setCompactMode(false);
        });
    }

    _buildNotificationView() {
        const view = hbox({style_class: 'di-banner', x_expand: true, y_expand: true});

        this._bannerIcon = makeNotificationIcon(null, 24);
        view.add_child(this._bannerIcon);

        const text = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._bannerTitle = new St.Label({style_class: 'di-banner-title'});
        this._bannerTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._bannerBody = new St.Label({style_class: 'di-banner-body', opacity: 180});
        this._bannerBody.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(this._bannerTitle);
        text.add_child(this._bannerBody);
        this._bannerActions = null;
        this._bannerText = text;
        view.add_child(text);

        return view;
    }

    _buildExpandedView() {
        const view = vbox({style_class: 'di-panel', x_expand: true, y_expand: true});

        // En-tête : heure, date, accès aux réglages.
        const header = hbox({style_class: 'di-header', x_expand: true});
        const clockBox = vbox({x_expand: true});
        this._clockLabel = new St.Label({style_class: 'di-clock'});
        this._dateLabel = new St.Label({style_class: 'di-date', opacity: 170});
        clockBox.add_child(this._clockLabel);
        clockBox.add_child(this._dateLabel);
        header.add_child(clockBox);

        const prefsButton = new St.Button({
            style_class: 'di-icon-button',
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}),
            y_align: Clutter.ActorAlign.CENTER,
        });
        prefsButton.connect('clicked', () => {
            this.collapse();
            this._extension.openPreferences();
        });
        header.add_child(prefsButton);
        view.add_child(header);

        // Lecteur multimédia.
        this._mediaCard = new MediaCard(this._media);
        view.add_child(this._mediaCard);

        // Volume et luminosité.
        this._volumeRow = new SliderRow('audio-volume-high-symbolic');
        this._volumeRow.connect('value-changed', (_row, value) => {
            this._system.volume = value;
        });
        this._volumeRow.connect('icon-clicked', () => this._system.toggleMute());
        view.add_child(this._volumeRow);

        this._brightnessRow = new SliderRow('display-brightness-symbolic');
        this._brightnessRow.connect('value-changed', (_row, value) => {
            this._system.brightness = value;
        });
        view.add_child(this._brightnessRow);

        // Raccourcis d'applications.
        this._shortcuts = new AppShortcuts(() => this._shelf?.selectedUris ?? []);
        this._shortcuts.connect('launched', () => this.collapse());
        view.add_child(this._shortcuts);

        // Étagère à fichiers.
        this._shelfSection = vbox({x_expand: true});
        const shelfHeader = hbox({style_class: 'di-section-header', x_expand: true});
        this._shelfTitle = new St.Label({
            style_class: 'di-section-title',
            text: 'Fichiers',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        shelfHeader.add_child(this._shelfTitle);
        shelfHeader.add_child(makeIconButton('edit-paste-symbolic', () => this._pasteIntoShelf()));
        this._shelfClearButton = new St.Button({
            style_class: 'di-text-button',
            label: 'Vider',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._shelfClearButton.connect('clicked', () => this._shelf?.clear());
        shelfHeader.add_child(this._shelfClearButton);
        this._shelfSection.add_child(shelfHeader);

        this._shelfList = vbox({style_class: 'di-shelf-list', x_expand: true});
        this._shelfSection.add_child(this._shelfList);

        this._shelfEmpty = new St.Label({
            style_class: 'di-empty',
            text: 'Copie un fichier, il se pose ici',
            x_expand: true,
            opacity: 150,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._shelfSection.add_child(this._shelfEmpty);
        view.add_child(this._shelfSection);

        // Historique des notifications.
        const notifHeader = hbox({style_class: 'di-section-header', x_expand: true});
        notifHeader.add_child(new St.Label({
            style_class: 'di-section-title',
            text: 'Notifications',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._clearButton = new St.Button({
            style_class: 'di-text-button',
            label: 'Tout effacer',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clearButton.connect('clicked', () => this._clearHistory());
        notifHeader.add_child(this._clearButton);
        view.add_child(notifHeader);

        this._notificationList = vbox({style_class: 'di-notification-list', x_expand: true});
        view.add_child(this._notificationList);

        this._emptyLabel = new St.Label({
            style_class: 'di-empty',
            text: 'Aucune notification',
            x_expand: true,
            opacity: 150,
            x_align: Clutter.ActorAlign.CENTER,
        });
        view.add_child(this._emptyLabel);

        return view;
    }

    // ------------------------------------------------------------- géométrie

    _monitor() {
        const monitors = Main.layoutManager.monitors;
        const index = this._settings.get_int('monitor');
        if (index >= 0 && index < monitors.length)
            return monitors[index];
        return Main.layoutManager.primaryMonitor ?? monitors[0];
    }

    /** Taille visée pour un état donné, contenu compris. */
    _targetSize(state, monitor) {
        const pillWidth = this._settings.get_int('pill-width');
        const pillHeight = this._settings.get_int('pill-height');
        const panelWidth = Math.min(this._settings.get_int('expanded-width'), monitor.width - 40);

        switch (state) {
        case State.COMPACT: {
            const [, natural] = this._compactView.get_preferred_width(-1);
            const width = clamp(natural + CONTENT_PADDING, pillWidth,
                Math.min(Math.round(monitor.width * 0.6), 460));
            return [width, pillHeight];
        }
        case State.OSD: {
            const [, natural] = this._osdView.get_preferred_width(-1);
            const width = clamp(natural + CONTENT_PADDING, pillWidth,
                Math.min(Math.round(monitor.width * 0.5), 340));
            return [width, pillHeight];
        }
        case State.NOTIFICATION: {
            const [, natural] = this._notificationView.get_preferred_height(panelWidth - CONTENT_PADDING);
            const height = clamp(natural + 16, Math.max(pillHeight, 56), 160);
            return [panelWidth, height];
        }
        case State.EXPANDED: {
            const [, natural] = this._expandedView.get_preferred_height(panelWidth - CONTENT_PADDING);
            const maximum = Math.min(this._settings.get_int('expanded-max-height'), monitor.height - 80);
            return [panelWidth, clamp(natural + 8, pillHeight, maximum)];
        }
        default:
            return [pillWidth, pillHeight];
        }
    }

    /** Coin haut-gauche visé, selon l'ancrage et les décalages. */
    _targetPosition(width, height, monitor) {
        const position = this._settings.get_string('position');
        const offsetX = this._settings.get_int('offset-x');
        const offsetY = this._settings.get_int('offset-y');

        let x;
        if (position.endsWith('left'))
            x = monitor.x + offsetX;
        else if (position.endsWith('right'))
            x = monitor.x + monitor.width - width - offsetX;
        else
            x = monitor.x + Math.round((monitor.width - width) / 2) + offsetX;

        const y = position.startsWith('top')
            ? monitor.y + offsetY
            : monitor.y + monitor.height - height - offsetY;

        return [Math.round(x), Math.round(y)];
    }

    _duration(base) {
        const speed = this._settings.get_double('animation-speed');
        return Math.round(base / (speed > 0 ? speed : 1));
    }

    /** Applique taille, position, arrondi et visibilité pour l'état courant. */
    _applyState(state, animate = true) {
        const monitor = this._monitor();
        if (!monitor)
            return;

        const [width, height] = this._targetSize(state, monitor);
        const [x, y] = this._targetPosition(width, height, monitor);

        const radius = state === State.EXPANDED
            ? Math.min(EXPANDED_RADIUS, Math.round(height / 2))
            : Math.min(this._settings.get_int('corner-radius'), Math.round(height / 2));
        this._applyRadius(radius);

        // Un lecteur bavard peut émettre plusieurs mises à jour par seconde :
        // inutile de relancer une animation qui ne changerait rien.
        const geometry = `${state}:${x}:${y}:${width}:${height}`;
        if (geometry === this._geometry)
            return;
        this._geometry = geometry;

        const expanding = state === State.EXPANDED || state === State.NOTIFICATION;
        const duration = animate ? this._duration(expanding ? 340 : 260) : 0;

        this.remove_all_transitions();
        this.ease({
            x, y, width, height,
            duration,
            mode: expanding
                ? Clutter.AnimationMode.EASE_OUT_BACK
                : Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        const hidden = state === State.IDLE && this._settings.get_boolean('auto-hide');
        this.ease({
            opacity: hidden ? 0 : 255,
            duration: animate ? this._duration(200) : 0,
        });
        this.reactive = !hidden;
    }

    _setState(state, animate = true) {
        this._state = state;
        this._showView(this._viewFor(state));
        this._applyState(state, animate);
    }

    _viewFor(state) {
        switch (state) {
        case State.COMPACT:
            return this._compactView;
        case State.NOTIFICATION:
            return this._notificationView;
        case State.OSD:
            return this._osdView;
        case State.EXPANDED:
            return this._expandedView;
        default:
            return null;
        }
    }

    /** Fondu croisé entre deux contenus. */
    _showView(view) {
        for (const candidate of this._views) {
            if (candidate === view || !candidate.visible)
                continue;
            candidate.remove_all_transitions();
            candidate.ease({
                opacity: 0,
                duration: this._duration(120),
                onComplete: () => candidate.hide(),
            });
        }

        if (!view)
            return;
        view.remove_all_transitions();
        view.show();
        view.ease({
            opacity: 255,
            duration: this._duration(200),
            delay: this._duration(60),
        });
    }

    _applyRadius(radius) {
        this.set_style(`${this._baseStyle ?? ''} border-radius: ${radius}px;`);
    }

    _updateStyle() {
        const background = toRgba(
            this._settings.get_string('background-color'),
            this._settings.get_double('background-opacity'));
        const foreground = toRgba(this._settings.get_string('text-color'), 1);
        const borderWidth = this._settings.get_int('border-width');
        const borderColor = toRgba(this._settings.get_string('border-color'), 1);

        this._baseStyle = `background-color: ${background}; color: ${foreground};`;
        if (borderWidth > 0)
            this._baseStyle += ` border: ${borderWidth}px solid ${borderColor};`;

        this._geometry = null;
        this._applyState(this._state, false);
    }

    _addChrome() {
        Main.layoutManager.addTopChrome(this, {
            affectsInputRegion: true,
            affectsStruts: false,
            trackFullscreen: this._settings.get_boolean('hide-in-fullscreen'),
        });
    }

    removeChrome() {
        Main.layoutManager.removeChrome(this);
    }

    // ------------------------------------------------------------ états haut

    /** L'état de repos : compact s'il y a de la musique, sinon la pilule nue. */
    _collapsedState() {
        return this._currentMedia() ? State.COMPACT : State.IDLE;
    }

    /** Le lecteur à afficher, ou null si le module est coupé ou muet. */
    _currentMedia() {
        if (!this._settings.get_boolean('show-media'))
            return null;
        return this._media?.info ?? null;
    }

    expand() {
        if (this._state === State.EXPANDED)
            return;

        this._cancelNotificationTimer();
        this._resetScale();
        // Un fichier a pu être déplacé ou supprimé depuis la dernière ouverture.
        this._shelf?.pruneMissing();
        this._updateExpanded();
        this._setState(State.EXPANDED);
        this._mediaCard.setPolling(this._mediaCard.visible);
        this._startClock();
        this._grabInput();
        this._addCatcher();
    }

    collapse() {
        if (this._state !== State.EXPANDED)
            return;

        this._removeCatcher();
        this._releaseGrab();
        this._stopClock();
        this._mediaCard.setPolling(false);
        this._setState(this._collapsedState());
    }

    toggle() {
        if (this._state === State.EXPANDED)
            this.collapse();
        else
            this.expand();
    }

    // ------------------------------------------------------------- contenus

    _updateExpanded() {
        this._updateClock();

        const info = this._currentMedia();
        this._mediaCard.visible = info !== null;
        if (info)
            this._mediaCard.update();

        this._volumeRow.visible = this._system.volumeAvailable;
        if (this._volumeRow.visible) {
            this._volumeRow.setValue(this._system.volume);
            this._volumeRow.setIcon(this._system.volumeIconName);
        }

        this._brightnessRow.visible = this._settings.get_boolean('show-brightness') &&
            this._system.brightnessAvailable;
        if (this._brightnessRow.visible)
            this._brightnessRow.setValue(this._system.brightness);

        this._shortcuts.setApps(this._settings.get_strv('app-shortcuts'));
        this._updateShelf();
        this._rebuildNotificationList();
    }

    // ------------------------------------------------------------- étagère

    _updateShelf() {
        const show = this._settings.get_boolean('show-shelf');
        this._shelfSection.visible = show;
        if (!show || !this._shelf)
            return;

        this._shelfList.destroy_all_children();

        for (const uri of this._shelf.uris) {
            const row = new ShelfRow(this._shelf.describe(uri), this._shelf.isSelected(uri));
            row.connect('copy-requested', () => {
                if (this._shelf.copyToClipboard(uri))
                    this._flashShelfTitle('Copié dans le presse-papier');
            });
            row.connect('open-requested', () => {
                this._shelf.open(uri);
                this.collapse();
            });
            row.connect('remove-requested', () => this._shelf.remove(uri));
            row.connect('selection-toggled', () => this._shelf.toggleSelection(uri));
            this._shelfList.add_child(row);
        }

        const empty = this._shelf.isEmpty;
        this._shelfEmpty.visible = empty;
        this._shelfList.visible = !empty;
        this._shelfClearButton.visible = !empty;
    }

    _pasteIntoShelf() {
        this._shelf?.captureClipboard(count => {
            this._flashShelfTitle(count > 0
                ? `${count} fichier${count > 1 ? 's' : ''} ajouté${count > 1 ? 's' : ''}`
                : 'Aucun fichier dans le presse-papier');
        });
    }

    /** Confirmation discrète, dans le titre de la section. */
    _flashShelfTitle(message) {
        this._shelfTitle.text = message;
        this._timeouts.remove(this._shelfTitleTimer);
        this._shelfTitleTimer = this._timeouts.add(2000, () => {
            this._shelfTitleTimer = 0;
            this._shelfTitle.text = 'Fichiers';
        });
    }

    _onShelfChanged() {
        const count = this._shelf?.uris.length ?? 0;
        const grew = count > this._shelfCount;
        this._shelfCount = count;

        if (this._state === State.EXPANDED) {
            this._updateShelf();
            this._geometry = null;
            this._applyState(State.EXPANDED);
            return;
        }

        // Fichier attrapé au vol pendant que l'île est repliée : on le signale.
        if (grew && this.visible && this._settings.get_boolean('show-shelf')) {
            this._showOsd(new Gio.ThemedIcon({name: 'folder-symbolic'}),
                'Fichier posé dans l’île', null, null);
        }
    }

    // -------------------------------------------------------- notifications

    _rebuildNotificationList() {
        this._notificationList.destroy_all_children();

        const showActions = this._settings.get_boolean('show-notification-actions');
        for (const record of this._history) {
            const row = new NotificationRow(record, showActions);
            row.connect('activated', () => this.collapse());
            row.connect('dismissed', () => this._dismissNotification(record));
            this._notificationList.add_child(row);
        }

        const empty = this._history.length === 0;
        this._emptyLabel.visible = empty;
        this._notificationList.visible = !empty;
        this._clearButton.visible = !empty;
    }

    /** Retire une notification de l'île et du shell. */
    _dismissNotification(record) {
        try {
            record.notification?.destroy();
        } catch {
            // Déjà disparue côté shell.
        }
        this._history = this._history.filter(entry => entry !== record);
        this._rebuildNotificationList();

        if (this._state === State.EXPANDED) {
            this._geometry = null;
            this._applyState(State.EXPANDED);
        }
    }

    _clearHistory() {
        for (const record of this._history) {
            try {
                record.notification?.destroy();
            } catch {
                // Déjà disparue côté shell.
            }
        }
        this._history = [];
        this._rebuildNotificationList();
        this._geometry = null;
        this._applyState(State.EXPANDED);
    }

    _updateClock() {
        const {time, date} = formatNow();
        this._clockLabel.text = time;
        this._dateLabel.text = date;
    }

    _startClock() {
        this._stopClock();
        this._clockTimer = this._timeouts.addRepeating(20000, () => {
            this._updateClock();
            return this._state === State.EXPANDED;
        });
    }

    _stopClock() {
        this._timeouts.remove(this._clockTimer);
        this._clockTimer = 0;
    }

    // -------------------------------------------------------------- signaux

    _onMediaChanged() {
        const info = this._currentMedia();

        if (info) {
            this._compactTitle.text = info.title;
            this._compactArt.setArt(info.artUrl);
            this._compactControls.update(info);

            const track = `${info.title}\u0000${info.artist}`;
            if (track !== this._lastTrack) {
                this._lastTrack = track;
                this._flashCompactTitle();
            } else {
                this._equalizer.setPlaying(this._compactShowsTitle && info.status === 'Playing');
            }
        } else {
            this._lastTrack = null;
            this._timeouts.remove(this._compactTitleTimer);
            this._compactTitleTimer = 0;
        this._osdTimer = 0;
        this._shelfTitleTimer = 0;
        this._osdPatched = false;
            this._equalizer.setPlaying(false);
        }

        if (this._state === State.EXPANDED) {
            this._updateExpanded();
            this._mediaCard.setPolling(this._mediaCard.visible);
            this._geometry = null;
            this._applyState(State.EXPANDED);
        } else if (this._state !== State.NOTIFICATION && this._state !== State.OSD) {
            this._setState(this._collapsedState());
        }
    }

    _onVolumeChanged() {
        if (this._state !== State.EXPANDED)
            return;
        this._volumeRow.visible = this._system.volumeAvailable;
        this._volumeRow.setValue(this._system.volume);
        this._volumeRow.setIcon(this._system.volumeIconName);
    }

    _onBrightnessChanged() {
        if (this._state !== State.EXPANDED)
            return;
        this._brightnessRow.visible = this._settings.get_boolean('show-brightness') &&
            this._system.brightnessAvailable;
        if (this._brightnessRow.visible)
            this._brightnessRow.setValue(this._system.brightness);
    }

    _onNotification(record) {
        this._timeouts.remove(this._osdTimer);
        this._osdTimer = 0;
        this._shelfTitleTimer = 0;

        if (!record.transient) {
            this._history.unshift(record);
            this._history = this._history.slice(0, HISTORY_MAX);
        }

        if (this._state === State.EXPANDED) {
            this._rebuildNotificationList();
            this._geometry = null;
            this._applyState(State.EXPANDED);
            return;
        }

        this._bannerTitle.text = record.title;
        this._bannerBody.text = record.body;
        this._bannerBody.visible = Boolean(record.body);
        this._bannerIcon.gicon = null;
        if (record.gicon)
            this._bannerIcon.gicon = record.gicon;
        else
            this._bannerIcon.icon_name = 'preferences-system-notifications-symbolic';

        if (this._bannerActions) {
            this._bannerActions.destroy();
            this._bannerActions = null;
        }
        if (this._settings.get_boolean('show-notification-actions')) {
            this._bannerActions = makeActionButtons(record, () => {
                this._cancelNotificationTimer();
                this._setState(this._collapsedState());
            }, 2);
            if (this._bannerActions)
                this._bannerText.add_child(this._bannerActions);
        }

        this._setState(State.NOTIFICATION);
        this._restartNotificationTimer();
    }

    _restartNotificationTimer() {
        this._cancelNotificationTimer();
        const seconds = this._settings.get_int('notification-timeout');
        this._notificationTimer = this._timeouts.add(seconds * 1000, () => {
            this._notificationTimer = 0;
            if (this._state === State.NOTIFICATION)
                this._setState(this._collapsedState());
        });
    }

    _cancelNotificationTimer() {
        this._timeouts.remove(this._notificationTimer);
        this._notificationTimer = 0;
    }

    _onSettingChanged(key) {
        switch (key) {
        case 'hide-in-fullscreen':
            this.removeChrome();
            this._addChrome();
            break;
        case 'background-color':
        case 'background-opacity':
        case 'text-color':
        case 'border-width':
        case 'border-color':
            this._updateStyle();
            return;
        case 'app-shortcuts':
        case 'show-shelf':
        case 'show-notification-actions':
            if (this._state === State.EXPANDED)
                this._updateExpanded();
            break;
        case 'show-media':
        case 'show-notifications':
        case 'show-brightness':
            this._onMediaChanged();
            if (this._state === State.EXPANDED)
                this._updateExpanded();
            break;
        default:
            break;
        }

        this._geometry = null;
        this._applyState(this._state, false);
    }

    _onButtonPress(event) {
        const button = event.get_button();

        if (button === Clutter.BUTTON_SECONDARY) {
            this.collapse();
            this._extension.openPreferences();
            return Clutter.EVENT_STOP;
        }

        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        // Panneau ouvert : ce qui arrive jusqu'ici n'a été consommé par aucun
        // bouton, aucun curseur, aucune notification — c'est donc un clic sur
        // le fond, et il referme. Combiné au calque qui couvre l'écran, cliquer
        // n'importe où ferme le panneau.
        if (this._state === State.EXPANDED) {
            this.collapse();
            return Clutter.EVENT_STOP;
        }

        this.expand();
        return Clutter.EVENT_STOP;
    }

    _onScroll(event) {
        if (!this._settings.get_boolean('scroll-volume') || !this._system.volumeAvailable)
            return Clutter.EVENT_PROPAGATE;

        let delta = 0;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            delta = 0.05;
            break;
        case Clutter.ScrollDirection.DOWN:
            delta = -0.05;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [, dy] = event.get_scroll_delta();
            delta = -dy * 0.05;
            break;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        if (!delta)
            return Clutter.EVENT_PROPAGATE;

        this._system.volume = this._system.volume + delta;
        this._showVolumeOsd();
        return Clutter.EVENT_STOP;
    }

    _resetScale() {
        this.remove_transition('scale-x');
        this.remove_transition('scale-y');
        this.set_scale(1, 1);
    }

    _onHover() {
        if (this._state === State.NOTIFICATION) {
            if (this.hover)
                this._cancelNotificationTimer();
            else
                this._restartNotificationTimer();
        }

        if (!this._settings.get_boolean('hover-peek') || this._state === State.EXPANDED) {
            this._resetScale();
            return;
        }

        const scale = this.hover ? 1.05 : 1;
        this.ease({
            scale_x: scale,
            scale_y: scale,
            duration: this._duration(180),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // -------------------------------------------------------------- OSD

    /**
     * Détourne l'OSD du shell.
     *
     * Tout ce qui s'affiche d'ordinaire dans la pastille en bas de l'écran
     * passe par osdWindowManager.show() : le volume et le micro (envoyés par
     * gnome-settings-daemon sur les touches multimédia), la luminosité, la
     * disposition clavier. On remplace cette méthode le temps de la session
     * de l'extension, et on la rend telle quelle à la désactivation.
     */
    _installOsdHook() {
        const manager = Main.osdWindowManager;
        if (!manager || this._osdPatched)
            return;

        this._osdOriginalShow = manager.show;
        this._osdOwnedShow = Object.prototype.hasOwnProperty.call(manager, 'show');

        manager.show = (monitorIndex, icon, label, level, maxLevel) => {
            if (this._shouldHandleOsd()) {
                this._showOsd(icon, label, level, maxLevel);
                return;
            }
            // Île masquée, panneau ouvert ou réglage coupé : l'OSD d'origine
            // reprend la main, on ne perd jamais l'information.
            this._osdOriginalShow.call(manager, monitorIndex, icon, label, level, maxLevel);
        };
        this._osdPatched = true;
    }

    _removeOsdHook() {
        if (!this._osdPatched)
            return;

        const manager = Main.osdWindowManager;
        if (this._osdOwnedShow)
            manager.show = this._osdOriginalShow;
        else
            delete manager.show;

        this._osdOriginalShow = null;
        this._osdPatched = false;
    }

    _shouldHandleOsd() {
        return this._settings.get_boolean('show-osd') &&
            this.visible &&
            this._state !== State.EXPANDED;
    }

    /** Affiche l'OSD dans la pilule, puis la rétracte. */
    _showOsd(icon, label, level, maxLevel) {
        this._osdView.update(icon, label, level, maxLevel);
        this._setState(State.OSD);

        this._timeouts.remove(this._osdTimer);
        this._osdTimer = this._timeouts.add(OSD_TIMEOUT, () => {
            this._osdTimer = 0;
        this._shelfTitleTimer = 0;
            if (this._state === State.OSD)
                this._setState(this._collapsedState());
        });
    }

    /** Retour visuel du volume réglé à la molette, que gsd n'annonce pas. */
    _showVolumeOsd() {
        if (!this._shouldHandleOsd())
            return;
        this._showOsd(new Gio.ThemedIcon({name: this._system.volumeIconName}),
            null, this._system.volume, 1);
    }

    // ------------------------------------------------------------- fermeture

    /**
     * Calque transparent couvrant l'écran, glissé sous l'île pendant que le
     * panneau est ouvert : n'importe quel clic ailleurs le referme, même si la
     * prise de focus clavier a échoué.
     */
    _addCatcher() {
        if (this._catcher)
            return;

        const catcher = new St.Widget({
            reactive: true,
            opacity: 0,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });
        catcher.connect('button-press-event', () => {
            this.collapse();
            return Clutter.EVENT_STOP;
        });
        catcher.connect('touch-event', () => {
            this.collapse();
            return Clutter.EVENT_STOP;
        });

        Main.layoutManager.addChrome(catcher, {
            affectsInputRegion: true,
            affectsStruts: false,
            trackFullscreen: false,
        });

        // addChrome() range l'acteur sous les fenêtres ; on le remonte juste
        // sous l'île, sinon les clics sur une fenêtre ne l'atteindraient pas.
        try {
            Main.uiGroup.set_child_below_sibling(catcher, this);
        } catch (error) {
            logError(error, 'Dynamic Island: impossible de placer le calque de fermeture');
        }
        this._catcher = catcher;
    }

    _removeCatcher() {
        if (!this._catcher)
            return;
        Main.layoutManager.removeChrome(this._catcher);
        this._catcher.destroy();
        this._catcher = null;
    }

    _onKeyPress(event) {
        if (event.get_key_symbol() === Clutter.KEY_Escape && this._state === State.EXPANDED) {
            this.collapse();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // ---------------------------------------------------------------- clavier

    /** Prend le focus le temps du panneau, pour Échap et le clic extérieur. */
    _grabInput() {
        try {
            this._grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
            if (this._grab.get_seat_state &&
                (this._grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0) {
                Main.popModal(this._grab);
                this._grab = null;
                return;
            }
        } catch {
            this._grab = null;
            return;
        }

        this.grab_key_focus();
        this._capturedId = global.stage.connect('captured-event',
            (_actor, event) => this._onCapturedEvent(event));
    }

    _releaseGrab() {
        if (this._capturedId) {
            global.stage.disconnect(this._capturedId);
            this._capturedId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
    }

    _onCapturedEvent(event) {
        const type = event.type();

        if (type === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.collapse();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            const target = typeof global.stage.get_event_actor === 'function'
                ? global.stage.get_event_actor(event)
                : event.get_source?.();
            if (target && (target === this || this.contains(target)))
                return Clutter.EVENT_PROPAGATE;
            this.collapse();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    // ---------------------------------------------------------------- ménage

    _onDestroy() {
        this._removeOsdHook();
        this._removeCatcher();
        this._releaseGrab();
        this._timeouts.destroy();

        for (const [source, id] of this._moduleIds ?? [])
            source.disconnect(id);
        this._moduleIds = [];

        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }

        this._shelf?.destroy();
        this._notifications?.destroy();
        this._media?.destroy();
        this._system?.destroy();
        this._shelf = null;
        this._notifications = null;
        this._media = null;
        this._system = null;
    }
});
