/* Fenêtre de réglages.
 *
 * Tout est écrit avec les widgets libadwaita les plus anciens possible
 * (ActionRow + widget suffixe) pour rester compatible de GNOME 45 à 49.
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = [
    ['top-left', 'Haut gauche'],
    ['top-center', 'Haut centre'],
    ['top-right', 'Haut droite'],
    ['bottom-left', 'Bas gauche'],
    ['bottom-center', 'Bas centre'],
    ['bottom-right', 'Bas droite'],
];

/** Ligne « interrupteur ». */
function switchRow(settings, key, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle: subtitle ?? null});
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    return row;
}

/**
 * Ligne « valeur numérique ».
 *
 * La synchronisation est faite à la main : la propriété `value` d'un
 * Gtk.SpinButton est un flottant, et la lier directement à une clé entière
 * dépend d'une conversion que GSettings n'assure pas partout.
 */
function spinRow(settings, key, title, subtitle, min, max, step = 1) {
    const row = new Adw.ActionRow({title, subtitle: subtitle ?? null});
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step * 10}),
        valign: Gtk.Align.CENTER,
        numeric: true,
    });

    spin.set_value(settings.get_int(key));
    spin.connect('value-changed', () => {
        const value = spin.get_value_as_int();
        if (value !== settings.get_int(key))
            settings.set_int(key, value);
    });
    settings.connect(`changed::${key}`, () => {
        const value = settings.get_int(key);
        if (value !== spin.get_value_as_int())
            spin.set_value(value);
    });

    row.add_suffix(spin);
    row.activatable_widget = spin;
    return row;
}

/** Ligne « curseur » pour les valeurs à virgule. */
function scaleRow(settings, key, title, subtitle, min, max, step) {
    const row = new Adw.ActionRow({title, subtitle: subtitle ?? null});
    const scale = new Gtk.Scale({
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step * 2}),
        digits: 2,
        draw_value: true,
        value_pos: Gtk.PositionType.LEFT,
        hexpand: true,
        width_request: 220,
        valign: Gtk.Align.CENTER,
    });
    settings.bind(key, scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(scale);
    return row;
}

/** Ligne « couleur », stockée en #rrggbb. */
function colorRow(settings, key, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle: subtitle ?? null});
    const button = new Gtk.ColorButton({valign: Gtk.Align.CENTER, use_alpha: false});

    const rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string(key));
    button.set_rgba(rgba);

    button.connect('color-set', () => {
        const color = button.get_rgba();
        const hex = [color.red, color.green, color.blue]
            .map(channel => Math.round(channel * 255).toString(16).padStart(2, '0'))
            .join('');
        settings.set_string(key, `#${hex}`);
    });

    settings.connect(`changed::${key}`, () => {
        const updated = new Gdk.RGBA();
        if (updated.parse(settings.get_string(key)))
            button.set_rgba(updated);
    });

    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
}

/** Ligne « liste déroulante » pour l'ancrage. */
function positionRow(settings) {
    const model = new Gtk.StringList();
    POSITIONS.forEach(([, label]) => model.append(label));

    const row = new Adw.ComboRow({
        title: 'Ancrage',
        subtitle: 'Bord de l’écran auquel la pilule est accrochée',
        model,
        selected: Math.max(0, POSITIONS.findIndex(([id]) => id === settings.get_string('position'))),
    });

    row.connect('notify::selected', () => {
        settings.set_string('position', POSITIONS[row.selected][0]);
    });
    settings.connect('changed::position', () => {
        const index = POSITIONS.findIndex(([id]) => id === settings.get_string('position'));
        if (index >= 0 && index !== row.selected)
            row.selected = index;
    });

    return row;
}

/** Fenêtre de choix d'une application installée. */
function showAppChooser(parent, settings) {
    const window = new Adw.Window({
        title: 'Ajouter une application',
        modal: true,
        transient_for: parent,
        default_width: 440,
        default_height: 560,
    });

    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    box.append(new Adw.HeaderBar());

    const search = new Gtk.SearchEntry({
        placeholder_text: 'Rechercher…',
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 6,
    });
    box.append(search);

    const list = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        css_classes: ['boxed-list'],
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 12,
    });

    const scrolled = new Gtk.ScrolledWindow({vexpand: true, child: list});
    box.append(scrolled);
    window.set_content(box);

    const apps = Gio.AppInfo.get_all()
        .filter(app => app.should_show() && app.get_id())
        .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));

    for (const app of apps) {
        const row = new Adw.ActionRow({
            title: app.get_display_name(),
            subtitle: app.get_description() ?? null,
            activatable: true,
        });
        const icon = app.get_icon();
        if (icon)
            row.add_prefix(Gtk.Image.new_from_gicon(icon));
        row._appId = app.get_id();
        row._searchText = `${app.get_display_name()} ${app.get_id()}`.toLowerCase();
        list.append(row);
    }

    list.set_filter_func(row => {
        const query = search.text.trim().toLowerCase();
        return query === '' || row._searchText.includes(query);
    });
    search.connect('search-changed', () => list.invalidate_filter());

    list.connect('row-activated', (_list, row) => {
        const shortcuts = settings.get_strv('app-shortcuts');
        if (!shortcuts.includes(row._appId))
            settings.set_strv('app-shortcuts', [...shortcuts, row._appId]);
        window.close();
    });

    window.present();
}

/** Liste des applications épinglées, avec ajout et retrait. */
function appShortcutsGroup(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Applications épinglées',
        description: 'Leurs icônes apparaissent dans le panneau. ' +
            'Si des fichiers sont sélectionnés dans l’étagère, ils sont passés à l’application ' +
            'lancée — de quoi envoyer un fichier avec LocalSend en deux clics.',
    });

    const addButton = new Gtk.Button({
        icon_name: 'list-add-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: 'Ajouter une application',
    });
    addButton.connect('clicked', () => showAppChooser(group.get_root(), settings));
    group.set_header_suffix(addButton);

    let rows = [];
    const rebuild = () => {
        rows.forEach(row => group.remove(row));
        rows = [];

        const shortcuts = settings.get_strv('app-shortcuts');
        if (shortcuts.length === 0) {
            const empty = new Adw.ActionRow({
                title: 'Aucune application',
                subtitle: 'Utilise le bouton + pour en ajouter',
            });
            rows.push(empty);
            group.add(empty);
            return;
        }

        shortcuts.forEach((id, index) => {
            let appInfo = null;
            try {
                appInfo = Gio.DesktopAppInfo.new(id);
            } catch {
                appInfo = null;
            }

            const row = new Adw.ActionRow({
                title: appInfo?.get_display_name() ?? id,
                subtitle: appInfo ? null : 'Application introuvable',
            });
            const icon = appInfo?.get_icon();
            if (icon)
                row.add_prefix(Gtk.Image.new_from_gicon(icon));

            const up = new Gtk.Button({
                icon_name: 'go-up-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                sensitive: index > 0,
                tooltip_text: 'Monter',
            });
            up.connect('clicked', () => {
                const list = settings.get_strv('app-shortcuts');
                [list[index - 1], list[index]] = [list[index], list[index - 1]];
                settings.set_strv('app-shortcuts', list);
            });

            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
                tooltip_text: 'Retirer',
            });
            remove.connect('clicked', () => {
                settings.set_strv('app-shortcuts',
                    settings.get_strv('app-shortcuts').filter(entry => entry !== id));
            });

            row.add_suffix(up);
            row.add_suffix(remove);
            rows.push(row);
            group.add(row);
        });
    };

    settings.connect('changed::app-shortcuts', rebuild);
    rebuild();
    return group;
}

function page(title, iconName) {
    return new Adw.PreferencesPage({title, icon_name: iconName});
}

function group(title, description) {
    return new Adw.PreferencesGroup({title, description: description ?? null});
}

export default class DynamicIslandPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(660, 780);

        window.add(this._positionPage(settings));
        window.add(this._sizePage(settings));
        window.add(this._appearancePage(settings));
        window.add(this._shortcutsPage(settings));
        window.add(this._behaviourPage(settings));
    }

    _positionPage(settings) {
        const p = page('Position', 'view-fullscreen-symbolic');

        const placement = group('Emplacement',
            'L’île se replace immédiatement : ajuste les valeurs en la regardant.');
        placement.add(positionRow(settings));
        placement.add(spinRow(settings, 'offset-x', 'Décalage horizontal',
            'En pixels, depuis l’ancrage choisi', -4000, 4000));
        placement.add(spinRow(settings, 'offset-y', 'Décalage vertical',
            'Distance au bord haut ou bas', -4000, 4000));
        p.add(placement);

        const screen = group('Écran');
        screen.add(spinRow(settings, 'monitor', 'Écran cible',
            '-1 pour suivre l’écran principal', -1, 16));
        p.add(screen);

        return p;
    }

    _sizePage(settings) {
        const p = page('Taille', 'object-flip-vertical-symbolic');

        const pill = group('Pilule au repos');
        pill.add(spinRow(settings, 'pill-width', 'Largeur', null, 40, 1200));
        pill.add(spinRow(settings, 'pill-height', 'Hauteur', null, 12, 200));
        pill.add(spinRow(settings, 'corner-radius', 'Arrondi des coins',
            'Une valeur égale à la moitié de la hauteur donne une pilule parfaite', 0, 100));
        p.add(pill);

        const panel = group('Panneau déployé');
        panel.add(spinRow(settings, 'expanded-width', 'Largeur', null, 200, 1600));
        panel.add(spinRow(settings, 'expanded-max-height', 'Hauteur maximale',
            'Le panneau s’arrête là, même s’il a plus à afficher', 120, 2000));
        p.add(panel);

        return p;
    }

    _appearancePage(settings) {
        const p = page('Apparence', 'applications-graphics-symbolic');

        const colors = group('Couleurs');
        colors.add(colorRow(settings, 'background-color', 'Fond'));
        colors.add(scaleRow(settings, 'background-opacity', 'Opacité du fond', null, 0.1, 1.0, 0.05));
        colors.add(colorRow(settings, 'text-color', 'Texte'));
        p.add(colors);

        const border = group('Bordure');
        border.add(spinRow(settings, 'border-width', 'Épaisseur', '0 pour aucune bordure', 0, 10));
        border.add(colorRow(settings, 'border-color', 'Couleur'));
        p.add(border);

        const motion = group('Animations');
        motion.add(scaleRow(settings, 'animation-speed', 'Vitesse',
            '1 = vitesse normale, 2 = deux fois plus rapide', 0.2, 3.0, 0.1));
        motion.add(switchRow(settings, 'hover-peek', 'Réagir au survol',
            'La pilule grossit légèrement quand la souris passe dessus'));
        p.add(motion);

        return p;
    }

    _shortcutsPage(settings) {
        const p = page('Raccourcis', 'view-grid-symbolic');
        p.add(appShortcutsGroup(settings));

        const shelf = group('Étagère à fichiers',
            'Copie un fichier (Ctrl+C dans les Fichiers) et il se pose dans l’île : ' +
            'un clic le remet dans le presse-papier pour le coller ailleurs, ou le passe ' +
            'à une application épinglée.');
        shelf.add(switchRow(settings, 'show-shelf', 'Afficher l’étagère'));
        shelf.add(switchRow(settings, 'shelf-auto-capture', 'Attraper les fichiers copiés',
            'Sinon, le bouton coller de la section « Fichiers » les ajoute à la demande'));
        p.add(shelf);

        return p;
    }

    _behaviourPage(settings) {
        const p = page('Comportement', 'preferences-system-symbolic');

        const modules = group('Contenus affichés');
        modules.add(switchRow(settings, 'show-notifications', 'Notifications',
            'Les afficher dans l’île'));
        modules.add(switchRow(settings, 'hide-native-banners', 'Masquer les bannières GNOME',
            'Évite de voir la notification deux fois'));
        modules.add(switchRow(settings, 'show-notification-actions', 'Boutons d’action',
            'Affiche les actions jointes par l’application, comme « Répondre »'));
        modules.add(spinRow(settings, 'notification-timeout', 'Durée d’affichage',
            'En secondes', 1, 60));
        modules.add(switchRow(settings, 'show-osd', 'Volume et luminosité dans l’île',
            'Remplace la pastille grise que GNOME affiche en bas de l’écran. ' +
            'Elle revient d’elle-même si l’île est masquée ou si le panneau est ouvert'));
        modules.add(switchRow(settings, 'show-media', 'Lecteur multimédia',
            'Pochette et boutons de lecture dans la pilule'));
        modules.add(spinRow(settings, 'compact-title-duration', 'Titre du morceau dans la pilule',
            'Secondes d’affichage au changement de morceau, avant que la pilule ne se rétracte. 0 pour ne jamais l’afficher',
            0, 30));
        modules.add(switchRow(settings, 'show-brightness', 'Luminosité',
            'Masqué automatiquement si l’écran ne se pilote pas'));
        p.add(modules);

        const behaviour = group('Interactions');
        behaviour.add(switchRow(settings, 'scroll-volume', 'Molette = volume',
            'Faire défiler au-dessus de la pilule règle le son'));
        behaviour.add(switchRow(settings, 'hide-in-fullscreen', 'Masquer en plein écran'));
        behaviour.add(switchRow(settings, 'auto-hide', 'Masquer au repos',
            'La pilule disparaît quand il n’y a rien à afficher'));
        p.add(behaviour);

        const reset = group('Réinitialisation');
        const row = new Adw.ActionRow({
            title: 'Revenir aux réglages d’origine',
            subtitle: 'Position, taille, couleurs et comportement',
        });
        const button = new Gtk.Button({
            label: 'Réinitialiser',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        button.connect('clicked', () => {
            for (const key of settings.list_keys())
                settings.reset(key);
        });
        row.add_suffix(button);
        reset.add(row);
        p.add(reset);

        return p;
    }
}
