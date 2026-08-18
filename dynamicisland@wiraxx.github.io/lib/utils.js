/* Petites fonctions partagées.
 *
 * Ce fichier concentre tout ce qui dépend de la version de GNOME Shell :
 * si une API bouge, c'est ici qu'on l'adapte, pas dans le reste du code.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

/** Oriente une St.BoxLayout (`orientation` en GNOME 48+, `vertical` avant). */
export function setVertical(box, vertical = true) {
    try {
        if (box.orientation !== undefined) {
            box.orientation = vertical
                ? Clutter.Orientation.VERTICAL
                : Clutter.Orientation.HORIZONTAL;
            return;
        }
    } catch {
        // On retombe sur la propriété historique.
    }
    box.vertical = vertical;
}

/** Boîte horizontale. */
export function hbox(props = {}) {
    const box = new St.BoxLayout(props);
    setVertical(box, false);
    return box;
}

/** Boîte verticale. */
export function vbox(props = {}) {
    const box = new St.BoxLayout(props);
    setVertical(box, true);
    return box;
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/** '#rrggbb' ou 'rgb(…)' → 'rgba(r, g, b, alpha)' utilisable en CSS de St. */
export function toRgba(color, alpha = 1) {
    const a = clamp(alpha, 0, 1);
    let hex = (color ?? '').trim();

    const rgbMatch = hex.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
        const parts = rgbMatch[1].split(',').map(p => parseFloat(p.trim()));
        const [r = 0, g = 0, b = 0] = parts;
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
    }

    hex = hex.replace('#', '');
    if (hex.length === 3)
        hex = hex.split('').map(c => c + c).join('');
    if (hex.length !== 6 || !/^[0-9a-f]{6}$/i.test(hex))
        return `rgba(0, 0, 0, ${a})`;

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Microsecondes MPRIS → « m:ss ». */
export function formatClock(micros) {
    const total = Math.max(0, Math.floor((micros ?? 0) / 1000000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** « 14:32 » et « lundi 18 août », dans la langue de la session. */
export function formatNow() {
    const now = GLib.DateTime.new_now_local();
    return {
        time: now.format('%H:%M'),
        date: now.format('%A %e %B'),
    };
}

/** Heure d'arrivée d'une notification, en relatif court. */
export function formatAge(timestampMs) {
    const minutes = Math.floor((Date.now() - timestampMs) / 60000);
    if (minutes < 1)
        return 'à l’instant';
    if (minutes < 60)
        return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
}

/** Retire le balisage Pango des corps de notification pour l'affichage compact. */
export function stripMarkup(text) {
    if (!text)
        return '';
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, '\'')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Gestionnaire de timeouts GLib : rien ne survit à un destroy(). */
export class TimeoutPool {
    constructor() {
        this._ids = new Set();
    }

    /** Exécute `callback` après `ms`. Retourne un jeton annulable. */
    add(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._ids.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._ids.add(id);
        return id;
    }

    /** Répète `callback` toutes les `ms` tant qu'il renvoie true. */
    addRepeating(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            if (callback())
                return GLib.SOURCE_CONTINUE;
            this._ids.delete(id);
            return GLib.SOURCE_REMOVE;
        });
        this._ids.add(id);
        return id;
    }

    remove(id) {
        if (id && this._ids.delete(id))
            GLib.Source.remove(id);
    }

    destroy() {
        for (const id of this._ids)
            GLib.Source.remove(id);
        this._ids.clear();
    }
}
