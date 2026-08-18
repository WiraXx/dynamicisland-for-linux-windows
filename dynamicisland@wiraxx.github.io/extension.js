/* Dynamic Island pour GNOME Shell.
 *
 * L'extension se contente de faire naître et mourir l'île ; toute la logique
 * vit dans lib/island.js.
 */

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Island} from './lib/island.js';

export default class DynamicIslandExtension extends Extension {
    enable() {
        this._island = new Island(this);
    }

    disable() {
        if (!this._island)
            return;
        this._island.removeChrome();
        this._island.destroy();
        this._island = null;
    }
}
