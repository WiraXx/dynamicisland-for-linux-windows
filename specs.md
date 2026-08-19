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
| `OSD` | volume, micro, luminosité… | icône + jauge + pourcentage, pendant 1,5 s |
| `EXPANDED` | clic sur la pilule | panneau de contrôle complet |

### Fonctions

| Fonction | Rôle | Entrées | Sorties |
|---|---|---|---|
| `_buildViews()` | Construit les trois vues et les empile dans l'île | — | — |
| `_updateShelf()` | Reconstruit la section « Fichiers » | — | lignes cliquables, section masquée si `show-shelf` est faux |
| `_pasteIntoShelf()` | Ajoute les fichiers du presse-papier à la demande | — | confirmation dans le titre de la section |
| `_onShelfChanged()` | L'étagère a bougé | — | met le panneau à jour, ou signale la prise dans la pilule si elle est repliée |
| `_dismissNotification(record)` | Supprime une notification glissée sur le côté | enregistrement | la détruit aussi côté shell |
| `_restartNotificationTimer()` | (Re)lance la disparition de la bannière | — | suspendu tant que la souris survole l'île, pour laisser cliquer une action |
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
| `_installOsdHook()` / `_removeOsdHook()` | Remplace `Main.osdWindowManager.show()` le temps de la session de l'extension | — | tout OSD du shell est dérouté vers l'île ; la méthode d'origine est rendue telle quelle à la désactivation |
| `_shouldHandleOsd()` | Décide qui affiche l'OSD | — | faux si le réglage est coupé, si l'île est masquée ou si le panneau est ouvert : l'OSD natif reprend alors la main |
| `_showOsd(icon, label, level, maxLevel)` | Affiche l'OSD dans la pilule | paramètres bruts du shell | rétraction automatique après 1,5 s |
| `_showVolumeOsd()` | Retour visuel de la molette, que gnome-settings-daemon n'annonce pas | — | — |
| `_grabInput()` / `_releaseGrab()` | Focus clavier le temps du panneau | — | permet `Échap` |
| `_addCatcher()` / `_removeCatcher()` | Calque transparent glissé sous l'île pendant que le panneau est ouvert | — | un clic n'importe où ailleurs referme, même sans focus clavier ; retiré à la fermeture, au masquage en plein écran et à la destruction |
| `_onKeyPress(event)` | Clavier sur l'île | événement | `Échap` referme le panneau |
| `_onCapturedEvent(event)` | Filtre les événements pendant que le panneau est ouvert | événement | ferme sur `Échap` ou sur un clic hors de l'île |
| `_onDestroy()` | Ménage | — | déconnecte tout, détruit les trois modules |

---

## `lib/shelf.js` — étagère à fichiers

GNOME Shell ne peut pas recevoir un fichier déposé : `js/ui/xdndHandler.js` ne suit que la
position du curseur pendant un glissement (`dnd-enter`, `dnd-position-change`, `dnd-leave`), sans
transfert de données ni délivrance du dépôt — seule une fenêtre peut être destinataire. L'étagère
passe donc par le presse-papier, qui transporte la même liste d'URI.

| Fonction | Rôle | Entrées | Sorties |
|---|---|---|---|
| `_watchClipboard()` | Écoute les changements du presse-papier | — | ajoute les fichiers copiés si `shelf-auto-capture` ; sans surveillance possible, seul le bouton coller agit |
| `captureClipboard(onDone)` | Lit le presse-papier à la demande | rappel | nombre de fichiers ajoutés |
| `_parseUriList(bytes)` | Analyse le `text/uri-list` | octets | URI `file://` existants seulement (la ligne « copy » de Nautilus est ignorée) |
| `addUris(uris)` | Ajoute en tête, sans doublon | liste d'URI | 8 fichiers au maximum, persistés dans `shelf-files` |
| `remove(uri)` / `clear()` / `pruneMissing()` | Retrait, vidage, nettoyage des fichiers disparus | — | émet `changed` |
| `toggleSelection(uri)` / `selectedUris` | Sélection passée aux applications épinglées | URI | — |
| `copyToClipboard(uri)` | Remet le fichier dans le presse-papier | URI | vrai si la copie a réussi |
| `open(uri)` | Ouvre avec l'application par défaut | URI | — |
| `describe(uri)` | Nom, icône et existence, pour l'affichage | URI | objet ; les fichiers disparus restent affichés en grisé |

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
| `makeIconButton(icon, callback, size, class)` | Bouton rond ne portant qu'une icône |
| `makeActionButtons(record, onActivated, max)` | Boutons d'action d'une notification, gère les deux formes d'API (GNOME 45 : objets simples ; 46+ : objets `Action`) |
| `ShelfRow(info, selected)` | Ligne de l'étagère : icône, nom, copier, ouvrir, retirer ; le clic bascule la sélection |
| `AppShortcuts(getSelectedUris)` | Rangée d'applications épinglées ; lance avec les fichiers sélectionnés via `launch_uris()`, sinon `activate()` |
| `OsdRow()` | Icône + jauge (`BarLevel`) + pourcentage ; `update(icon, label, level, maxLevel)` accepte les paramètres du shell tels quels, gère l'absence de jauge et la sur-amplification au-delà de 100 % |
| `MediaControls(media, options)` | Précédent / lecture-pause / suivant en icônes du thème ; `update(info)` change l'icône de lecture et grise ce que le lecteur ne sait pas faire ; partagé entre la pilule (petites icônes) et le panneau |
| `SliderRow(iconName)` | Icône + curseur ; signaux `value-changed` et `icon-clicked` ; `setValue()` ne réémet rien (pas de boucle) |
| `MediaCard(media)` | Carte du lecteur ; `update()` recopie l'état, `setPolling(bool)` rafraîchit la progression à 1 Hz |
| `NotificationRow(record, showActions)` | Entrée d'historique : le clic active la notification, un glissement latéral de 70 px la supprime (émet `dismissed`), et les actions de l'application sont affichées dessous |
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

Cinq pages : **Position**, **Taille**, **Apparence**, **Raccourcis**, **Comportement**, plus un bouton de
réinitialisation. Chaque ligne est liée à une clé GSettings par `Gio.Settings.bind()`, donc tout
changement est appliqué à chaud par l'île.

| Fonction | Rôle |
|---|---|
| `switchRow(settings, key, …)` | Ligne interrupteur |
| `spinRow(settings, key, …, min, max)` | Ligne numérique bornée |
| `scaleRow(settings, key, …, min, max, step)` | Ligne curseur pour les valeurs à virgule |
| `colorRow(settings, key, …)` | Sélecteur de couleur, stockée en `#rrggbb` |
| `positionRow(settings)` | Liste déroulante des six ancrages |
| `appShortcutsGroup(settings)` | Liste des applications épinglées, avec ajout, montée et retrait |
| `showAppChooser(parent, settings)` | Fenêtre de choix parmi les applications installées, avec recherche |

### Sur la réponse aux notifications

GNOME n'implémente pas la réponse en ligne du protocole freedesktop : ni `gnome-48` ni `gnome-49`
ne mentionnent `inline-reply`, et `GetCapabilities()` ne l'annonce pas. Le shell ne reçoit donc
jamais de canal de réponse d'une application. Ce que l'île peut offrir — et offre — ce sont les
**actions** jointes à la notification (`Notification.actions`), dont le « Répondre » des
messageries.

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
| `expanded-max-height` | entier | 640 | hauteur maximale du panneau |
| `background-color` / `background-opacity` | chaîne / réel | `#000000` / 1.0 | fond de l'île |
| `text-color` | chaîne | `#ffffff` | couleur du texte |
| `border-width` / `border-color` | entier / chaîne | 0 / `#3c3c3c` | bordure |
| `animation-speed` | réel | 1.0 | diviseur des durées d'animation |
| `notification-timeout` | entier | 5 | durée d'affichage d'une notification |
| `app-shortcuts` | liste | vide | identifiants `.desktop` des applications épinglées |
| `show-shelf` | booléen | vrai | affiche l'étagère à fichiers |
| `shelf-files` | liste | vide | fichiers posés dans l'étagère (état persistant) |
| `shelf-auto-capture` | booléen | vrai | attrape automatiquement les fichiers copiés |
| `show-notification-actions` | booléen | vrai | boutons d'action des notifications |
| `show-osd` | booléen | vrai | volume et luminosité affichés dans l'île plutôt qu'en bas de l'écran |
| `compact-title-duration` | entier | 3 | secondes d'affichage du titre dans la pilule (0 = jamais) |
| `hide-native-banners` | booléen | vrai | masque les bannières GNOME |
| `show-notifications` / `show-media` / `show-brightness` | booléen | vrai | modules affichés |
| `hover-peek` | booléen | vrai | agrandissement au survol |
| `scroll-volume` | booléen | vrai | molette = volume |
| `hide-in-fullscreen` | booléen | vrai | masquage en plein écran |
| `auto-hide` | booléen | faux | masque la pilule au repos |
