/* Volume et luminosité : les deux réglages système exposés par le panneau. */

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

const BrightnessIface = `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Screen">
    <property name="Brightness" type="i" access="readwrite"/>
  </interface>
</node>`;

const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(BrightnessIface);

export const SystemControls = GObject.registerClass({
    Signals: {
        'volume-changed': {},
        'brightness-changed': {},
    },
}, class SystemControls extends GObject.Object {
    _init() {
        super._init();

        this._destroyed = false;
        this._stream = null;
        this._streamIds = [];
        this._brightness = null;

        this._control = Volume.getMixerControl();
        this._controlIds = [
            this._control.connect('default-sink-changed', () => this._updateStream()),
            this._control.connect('state-changed', () => this._updateStream()),
        ];
        this._updateStream();

        new BrightnessProxy(Gio.DBus.session,
            'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power/Screen',
            (proxy, error) => {
                if (this._destroyed || error)
                    return;
                this._brightness = proxy;
                this._brightnessId = proxy.connect('g-properties-changed',
                    () => this.emit('brightness-changed'));
                this.emit('brightness-changed');
            });
    }

    _updateStream() {
        const stream = this._control.get_default_sink();
        if (stream === this._stream)
            return;

        for (const id of this._streamIds)
            this._stream?.disconnect(id);
        this._streamIds = [];

        this._stream = stream;
        if (stream) {
            this._streamIds = [
                stream.connect('notify::volume', () => this.emit('volume-changed')),
                stream.connect('notify::is-muted', () => this.emit('volume-changed')),
            ];
        }
        this.emit('volume-changed');
    }

    get volumeAvailable() {
        return this._stream !== null;
    }

    /** Volume normalisé entre 0 et 1. */
    get volume() {
        if (!this._stream)
            return 0;
        const max = this._control.get_vol_max_norm();
        return max > 0 ? this._stream.volume / max : 0;
    }

    set volume(value) {
        if (!this._stream)
            return;
        const max = this._control.get_vol_max_norm();
        this._stream.volume = Math.round(Math.max(0, Math.min(1, value)) * max);
        this._stream.push_volume();
        if (this._stream.is_muted && value > 0)
            this._stream.change_is_muted(false);
    }

    get muted() {
        return this._stream?.is_muted ?? false;
    }

    toggleMute() {
        if (this._stream)
            this._stream.change_is_muted(!this._stream.is_muted);
    }

    /** Icône symbolique correspondant au niveau courant. */
    get volumeIconName() {
        if (this.muted || this.volume <= 0)
            return 'audio-volume-muted-symbolic';
        if (this.volume < 0.34)
            return 'audio-volume-low-symbolic';
        if (this.volume < 0.67)
            return 'audio-volume-medium-symbolic';
        return 'audio-volume-high-symbolic';
    }

    /** Absent sur les machines sans rétroéclairage pilotable. */
    get brightnessAvailable() {
        return this._brightness !== null && this._brightness.Brightness >= 0;
    }

    get brightness() {
        return (this._brightness?.Brightness ?? 0) / 100;
    }

    set brightness(value) {
        if (!this._brightness)
            return;
        this._brightness.Brightness = Math.round(Math.max(0.01, Math.min(1, value)) * 100);
    }

    destroy() {
        this._destroyed = true;

        for (const id of this._controlIds)
            this._control.disconnect(id);
        this._controlIds = [];

        for (const id of this._streamIds)
            this._stream?.disconnect(id);
        this._streamIds = [];
        this._stream = null;

        if (this._brightness && this._brightnessId) {
            this._brightness.disconnect(this._brightnessId);
            this._brightnessId = 0;
        }
        this._brightness = null;
    }
});
