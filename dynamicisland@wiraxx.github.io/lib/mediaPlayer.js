/* Client MPRIS : découvre les lecteurs présents sur le bus de session,
 * suit celui qui joue, et expose de quoi le piloter.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';

const PlayerIface = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Play"/>
    <method name="Pause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Seek">
      <arg type="x" direction="in"/>
    </method>
    <method name="SetPosition">
      <arg type="o" direction="in"/>
      <arg type="x" direction="in"/>
    </method>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
  </interface>
</node>`;

const AppIface = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
  </interface>
</node>`;

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(PlayerIface);
const AppProxy = Gio.DBusProxy.makeProxyWrapper(AppIface);

/** Déballe une valeur d'un dictionnaire a{sv} sans faire confiance au lecteur. */
function unpackValue(variant) {
    if (variant === null || variant === undefined)
        return null;
    if (typeof variant.deepUnpack !== 'function')
        return variant;
    try {
        return variant.deepUnpack();
    } catch {
        return null;
    }
}

export const MediaPlayer = GObject.registerClass({
    Signals: {'changed': {}},
}, class MediaPlayer extends GObject.Object {
    _init() {
        super._init();

        this._players = new Map();  // busName → {player, app, identity}
        this._activeName = null;
        this._destroyed = false;

        this._watchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            MPRIS_PREFIX,
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (conn, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(`${MPRIS_PREFIX}.`))
                    return;
                if (newOwner && !oldOwner)
                    this._addPlayer(name);
                else if (!newOwner)
                    this._removePlayer(name);
            });

        this._listExistingPlayers();
    }

    _listExistingPlayers() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, null,
            (connection, result) => {
                if (this._destroyed)
                    return;
                try {
                    const [names] = connection.call_finish(result).deepUnpack();
                    names
                        .filter(name => name.startsWith(`${MPRIS_PREFIX}.`))
                        .forEach(name => this._addPlayer(name));
                } catch (error) {
                    logError(error, 'Dynamic Island: énumération MPRIS impossible');
                }
            });
    }

    _addPlayer(busName) {
        if (this._destroyed || this._players.has(busName))
            return;

        const entry = {player: null, app: null, identity: null, signalId: 0};
        this._players.set(busName, entry);

        new PlayerProxy(Gio.DBus.session, busName, MPRIS_PATH, (proxy, error) => {
            if (this._destroyed || error || !this._players.has(busName)) {
                if (error && !this._destroyed)
                    this._players.delete(busName);
                return;
            }
            entry.player = proxy;
            entry.signalId = proxy.connect('g-properties-changed', () => this._onPlayerUpdated());
            this._onPlayerUpdated();
        });

        new AppProxy(Gio.DBus.session, busName, MPRIS_PATH, (proxy, error) => {
            if (this._destroyed || error || !this._players.has(busName))
                return;
            entry.app = proxy;
            entry.identity = proxy.Identity;
            this.emit('changed');
        });
    }

    _removePlayer(busName) {
        const entry = this._players.get(busName);
        if (!entry)
            return;
        if (entry.player && entry.signalId)
            entry.player.disconnect(entry.signalId);
        this._players.delete(busName);
        this._onPlayerUpdated();
    }

    /** Le lecteur « actif » : celui qui joue, sinon le dernier connu. */
    _onPlayerUpdated() {
        let candidate = null;
        for (const [name, entry] of this._players) {
            if (!entry.player)
                continue;
            if (entry.player.PlaybackStatus === 'Playing') {
                candidate = name;
                break;
            }
            if (!candidate)
                candidate = name;
        }
        this._activeName = candidate;
        this.emit('changed');
    }

    get hasPlayer() {
        return this._activeName !== null;
    }

    get isPlaying() {
        return this._entry?.player?.PlaybackStatus === 'Playing';
    }

    get _entry() {
        return this._activeName ? this._players.get(this._activeName) : null;
    }

    /** Tout ce dont l'interface a besoin, déjà normalisé. */
    get info() {
        const entry = this._entry;
        if (!entry?.player)
            return null;

        const metadata = entry.player.Metadata ?? {};
        const artists = unpackValue(metadata['xesam:artist']);
        const artUrl = unpackValue(metadata['mpris:artUrl']);
        const length = unpackValue(metadata['mpris:length']);

        return {
            title: unpackValue(metadata['xesam:title']) || 'Lecture en cours',
            artist: Array.isArray(artists) ? artists.join(', ') : (artists || ''),
            artUrl: typeof artUrl === 'string' ? artUrl : null,
            length: typeof length === 'number' ? length : 0,
            status: entry.player.PlaybackStatus ?? 'Stopped',
            canGoNext: entry.player.CanGoNext ?? false,
            canGoPrevious: entry.player.CanGoPrevious ?? false,
            canSeek: entry.player.CanSeek ?? false,
            appName: entry.identity || '',
        };
    }

    /**
     * Appelle une méthode du lecteur.
     *
     * makeProxyWrapper génère selon les versions de GJS un variant `…Async`
     * (promesse) et un variant `…Remote` (rappel) : on prend ce qui existe.
     */
    _invoke(proxy, method, ...args) {
        if (!proxy)
            return;
        const fail = error => logError(error, `Dynamic Island: ${method} a échoué`);
        try {
            if (typeof proxy[`${method}Async`] === 'function')
                proxy[`${method}Async`](...args).catch(fail);
            else if (typeof proxy[`${method}Remote`] === 'function')
                proxy[`${method}Remote`](...args, (_result, error) => {
                    if (error)
                        fail(error);
                });
        } catch (error) {
            fail(error);
        }
    }

    playPause() {
        this._invoke(this._entry?.player, 'PlayPause');
    }

    next() {
        this._invoke(this._entry?.player, 'Next');
    }

    previous() {
        this._invoke(this._entry?.player, 'Previous');
    }

    /** Position courante en microsecondes (asynchrone : elle n'est jamais notifiée). */
    getPosition(callback) {
        const busName = this._activeName;
        if (!busName) {
            callback(0);
            return;
        }
        Gio.DBus.session.call(
            busName, MPRIS_PATH, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [`${MPRIS_PREFIX}.Player`, 'Position']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 1000, null,
            (connection, result) => {
                if (this._destroyed)
                    return;
                try {
                    const [position] = connection.call_finish(result).recursiveUnpack();
                    callback(Number(position) || 0);
                } catch {
                    callback(0);
                }
            });
    }

    /**
     * Déplace la lecture à `fraction` (0 → 1) du morceau.
     * SetPosition attend un identifiant de piste qui soit un vrai chemin D-Bus ;
     * Spotify n'en fournit pas, on retombe alors sur un Seek relatif.
     */
    seek(fraction) {
        const entry = this._entry;
        const info = this.info;
        if (!entry?.player || !info?.canSeek || !info.length)
            return;

        const target = Math.round(Math.max(0, Math.min(1, fraction)) * info.length);
        const trackId = unpackValue(entry.player.Metadata?.['mpris:trackid']);

        if (typeof trackId === 'string' && trackId.startsWith('/')) {
            this._invoke(entry.player, 'SetPosition', trackId, target);
            return;
        }
        this._seekRelative(entry, target);
    }

    _seekRelative(entry, target) {
        this.getPosition(current => this._invoke(entry.player, 'Seek', target - current));
    }

    /** Met le lecteur au premier plan (clic sur la pochette). */
    raise() {
        const app = this._entry?.app;
        if (!app?.CanRaise)
            return;
        this._invoke(app, 'Raise');
    }

    destroy() {
        this._destroyed = true;
        if (this._watchId) {
            Gio.DBus.session.signal_unsubscribe(this._watchId);
            this._watchId = 0;
        }
        for (const entry of this._players.values()) {
            if (entry.player && entry.signalId)
                entry.player.disconnect(entry.signalId);
        }
        this._players.clear();
        this._activeName = null;
    }
});
