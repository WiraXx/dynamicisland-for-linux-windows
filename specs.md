# Spécifications — Dynamic Island pour GNOME

Référence des fonctions du logiciel, module par module.
Chemins relatifs à `dynamicisland@wiraxx.github.io/`.

---

## `extension.js` — cycle de vie

| Fonction | Rôle | Entrées | Sorties / effets |
|---|---|---|---|
| `enable()` | Appelée par GNOME à l'ouverture de session ou à l'activation | — | Crée l'île et l'ajoute au shell |
| `disable()` | Appelée au verrouillage de session ou à la désactivation | — | Retire l'île, restaure les bannières natives, coupe tous les signaux et minuteries |

---

## `lib/island.js` — l'île

Acteur `St.Widget` unique, ajouté via `Main.layoutManager.addTopChrome()`.

### États

| État | Déclenché par | Contenu |
|---|---|---|
| `IDLE` | rien à afficher | pilule vide |
| `COMPACT` | un lecteur MPRIS est présent | pochette + précédent/lecture-pause/suivant ; au changement de morceau, titre + égaliseur pendant `compact-title-duration` secondes |
| `NOTIFICATION` | notification reçue | icône + titre + message, pendant `notification-timeout` secondes |
| `EXPANDED` | clic sur la pilule | panneau de contrôle complet |

### Fonctions

| Fonction | Rôle | Entrées | Sorties |
|---|---|---|---|
| `_buildViews()` | Construit les trois vues et les empile dans l'île | — | — |
| `_setCompactMode(showTitle)` | Bascule la pilule entre « titre + égaliseur » et « pochette + boutons » | booléen | réanime la géométrie si l'île est compacte |
| `_flashCompactTitle()` | Montre le titre le temps réglé puis rétracte la pilule | — | ne fait rien si la durée vaut 0 |
| `_monitor()` | Écran sur lequel s'affiche l'île | réglage `monitor` | objet moniteur ; l'écran principal si l'index est invalide |
| `_targetSize(state, monitor)` | Taille visée, calculée depuis le contenu réel | état, moniteur | `[largeur, hauteur]`, bornées par l'écran et les réglages |
| `_targetPosition(w, h, monitor)` | Coin haut-gauche visé | taille, moniteur | `[x, y]` selon `position`, `offset-x`, `offset-y` |
| `_applyState(state, animate)` | Anime taille, position, arrondi et opacité | état, booléen | transition Clutter ; durée divisée par `animation-speed` |
| `_setState(state, animate)` | Change d'état : vue + géométrie | état | — |
| `_showView(view)` | Fondu croisé entre deux contenus | vue ou `null` | — |
| `_updateStyle()` | Recalcule fond, texte et bordure depuis les réglages | — | style en ligne appliqué à l'île |
| `_collapsedState()` | État de repos selon la présence d'un média | — | `COMPACT` ou `IDLE` |
| `expand()` / `collapse()` / `toggle()` | Ouvre, ferme ou bascule le panneau | — | prend/rend le focus clavier, démarre/arrête l'horloge et le suivi de progression |
| `_updateExpanded()` | Remplit le panneau (heure, média, curseurs, notifications) | — | — |
| `_rebuildNotificationList()` | Reconstruit la liste d'historique | — | affiche « Aucune notification » si vide |
| `_clearHistory()` | Vide l'historique et détruit les notifications côté shell | — | — |
| `_onNotification(record)` | Reçoit une notification | enregistrement normalisé | l'affiche, l'ajoute à l'historique (sauf notifications transitoires, max 5) |
| `_onMediaChanged()` | Le lecteur a changé d'état | — | met à jour la vue compacte, ou le panneau s'il est ouvert |
| `_onButtonPress(event)` | Clics | événement | gauche = déplier, droit = réglages ; les clics dans le panneau ouvert ne le referment pas |
| `_onScroll(event)` | Molette | événement | volume ±5 % si `scroll-volume` |
| `_onHover()` | Survol | — | léger agrandissement si `hover-peek` |
| `_grabInput()` / `_releaseGrab()` | Focus clavier le temps du panneau | — | permet `Échap` |
| `_addCatcher()` / `_removeCatcher()` | Calque transparent glissé sous l'île pendant que le panneau est ouvert | — | un clic n'importe où ailleurs referme, même sans focus clavier ; retiré à la fermeture, au masquage en plein écran et à la destruction |
| `_onKeyPress(event)` | Clavier sur l'île | événement | `Échap` referme le panneau |
| `_onCapturedEvent(event)` | Filtre les événements pendant que le panneau est ouvert | événement | ferme sur `Échap` ou sur un clic hors de l'île |
| `_onDestroy()` | Ménage | — | déconnecte tout, détruit les trois modules |

---

## `lib/mediaPlayer.js` — lecteurs MPRIS

| Fonction | Rôle | Entrées | Sorties |
|---|---|---|---|
| `_listExistingPlayers()` | Recense les lecteurs déjà lancés | — | remplit la table des lecteurs |
| `_addPlayer(busName)` / `_removePlayer(busName)` | Suivi des lecteurs qui apparaissent et disparaissent | nom D-Bus | émet `changed` |
| `_onPlayerUpdated()` | Choisit le lecteur actif | — | celui qui joue, sinon le premier connu |
| `info` (accesseur) | État normalisé du lecteur actif | — | `{title, artist, artUrl, length, status, canGoNext, canGoPrevious, canSeek, appName}` ou `null` |
| `playPause()`, `next()`, `previous()` | Transport | — | appels D-Bus asynchrones |
| `getPosition(callback)` | Position courante (jamais notifiée par MPRIS, donc interrogée) | fonction de rappel | microsecondes, `0` en cas d'échec |
| `seek(fraction)` | Déplace la lecture | 0 → 1 | `SetPosition` si l'identifiant de piste est un chemin D-Bus valide, sinon `Seek` relatif (cas de Spotify) |
| `raise()` | Met la fenêtre du lecteur au premier plan | — | — |
| `destroy()` | Ménage | — | se désabonne du bus |

---

## `lib/notifications.js` — notifications

| Fonction | Rôle | Entrées | Sorties |
|---|---|---|---|
| `_addSource(source)` / `_removeSource(source)` | Suit chaque source de notifications du shell | source | — |
| `_onNotification(source, notification)` | Normalise une notification | source, notification | émet `notification` avec `{title, body, gicon, appName, timestamp, transient, notification}` |
| `_iconFor(source, notification)` | Retrouve l'icône | source, notification | `Gio.Icon` ou `null` (l'emplacement a changé selon les versions de GNOME) |
| `_syncBannerSuppression()` | Applique le réglage `hide-native-banners` | — | déplace le conteneur de bannières hors écran et force son opacité à zéro |
| `_restoreBanner()` | Remet les bannières natives en place | — | appelé à la désactivation |

**Choix de conception** : la machine à états du message tray n'est pas modifiée — elle continue
de tourner normalement, seules la position et l'opacité de son conteneur changent. Aucune
animation ne reste bloquée, et la zone cliquable suit la transformation.

---

## `lib/system.js` — volume et luminosité

| Fonction | Rôle | Entrées | Sorties |
|---|---|---|---|
| `_updateStream()` | Suit la sortie audio par défaut | — | émet `volume-changed` |
| `volume` (lecture/écriture) | Volume normalisé | 0 → 1 | applique et démute si besoin |
| `muted`, `toggleMute()` | Sourdine | — | — |
| `volumeIconName` | Icône correspondant au niveau | — | nom d'icône symbolique |
| `brightnessAvailable`, `brightness` | Luminosité de l'écran via `org.gnome.SettingsDaemon.Power.Screen` | 0 → 1 | absente sur les machines sans rétroéclairage pilotable |

---

## `lib/widgets.js` — briques d'interface

| Classe / fonction | Rôle |
|---|---|
| `AlbumArt(size)` | Pochette arrondie ; `setArt(url)` accepte un fichier local, repli sur une icône générique pour les pochettes distantes |
| `Equalizer(barCount)` | Barres animées ; `setPlaying(bool)` démarre ou fige l'animation |
| `MediaControls(media, options)` | Précédent / lecture-pause / suivant en icônes du thème ; `update(info)` change l'icône de lecture et grise ce que le lecteur ne sait pas faire ; partagé entre la pilule (petites icônes) et le panneau |
| `SliderRow(iconName)` | Icône + curseur ; signaux `value-changed` et `icon-clicked` ; `setValue()` ne réémet rien (pas de boucle) |
| `MediaCard(media)` | Carte du lecteur ; `update()` recopie l'état, `setPolling(bool)` rafraîchit la progression à 1 Hz |
| `NotificationRow(record)` | Entrée d'historique ; le clic active la notification puis émet `activated` |
| `makeNotificationIcon(record, size)` | Icône d'une notification, avec repli symbolique |

---

## `lib/utils.js` — compatibilité et formatage

| Fonction | Rôle |
|---|---|
| `setVertical(box, vertical)` | Oriente une `St.BoxLayout` (`orientation` en GNOME 48+, `vertical` avant) |
| `hbox(props)` / `vbox(props)` | Boîtes horizontales et verticales |
| `clamp(value, min, max)` | Borne une valeur |
| `toRgba(color, alpha)` | `#rrggbb` ou `rgb(…)` → `rgba(…)` utilisable par St |
| `formatClock(micros)` | Microsecondes MPRIS → `m:ss` |
| `formatNow()` | `{time, date}` dans la langue de la session |
| `formatAge(timestamp)` | « à l'instant », « il y a 5 min », « il y a 2 h » |
| `stripMarkup(text)` | Retire le balisage Pango des corps de notification |
| `TimeoutPool` | Minuteries GLib traçables : `add`, `addRepeating`, `remove`, `destroy` — rien ne survit à la désactivation |

---

## `prefs.js` — réglages

Quatre pages : **Position**, **Taille**, **Apparence**, **Comportement**, plus un bouton de
réinitialisation. Chaque ligne est liée à une clé GSettings par `Gio.Settings.bind()`, donc tout
changement est appliqué à chaud par l'île.

| Fonction | Rôle |
|---|---|
| `switchRow(settings, key, …)` | Ligne interrupteur |
| `spinRow(settings, key, …, min, max)` | Ligne numérique bornée |
| `scaleRow(settings, key, …, min, max, step)` | Ligne curseur pour les valeurs à virgule |
| `colorRow(settings, key, …)` | Sélecteur de couleur, stockée en `#rrggbb` |
| `positionRow(settings)` | Liste déroulante des six ancrages |

---

## Réglages disponibles (`schemas/`)

| Clé | Type | Défaut | Effet |
|---|---|---|---|
| `pill-width` / `pill-height` | entier | 150 / 30 | taille de la pilule au repos |
| `corner-radius` | entier | 15 | arrondi des coins |
| `position` | énum | `top-center` | l'un des six ancrages |
| `offset-x` / `offset-y` | entier | 0 / 2 | décalage depuis l'ancrage |
| `monitor` | entier | -1 | écran cible (-1 = principal) |
| `expanded-width` | entier | 400 | largeur du panneau |
| `expanded-max-height` | entier | 520 | hauteur maximale du panneau |
| `background-color` / `background-opacity` | chaîne / réel | `#000000` / 1.0 | fond de l'île |
| `text-color` | chaîne | `#ffffff` | couleur du texte |
| `border-width` / `border-color` | entier / chaîne | 0 / `#3c3c3c` | bordure |
| `animation-speed` | réel | 1.0 | diviseur des durées d'animation |
| `notification-timeout` | entier | 5 | durée d'affichage d'une notification |
| `compact-title-duration` | entier | 3 | secondes d'affichage du titre dans la pilule (0 = jamais) |
| `hide-native-banners` | booléen | vrai | masque les bannières GNOME |
| `show-notifications` / `show-media` / `show-brightness` | booléen | vrai | modules affichés |
| `hover-peek` | booléen | vrai | agrandissement au survol |
| `scroll-volume` | booléen | vrai | molette = volume |
| `hide-in-fullscreen` | booléen | vrai | masquage en plein écran |
| `auto-hide` | booléen | faux | masque la pilule au repos |
