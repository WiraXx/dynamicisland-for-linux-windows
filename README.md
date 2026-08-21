# Dynamic Island

Une **Dynamic Island** à la façon d'iOS, pour **GNOME** et pour **Windows**.

| Plateforme | Où | Comment |
|---|---|---|
| **Linux (GNOME 45 → 49)** | ce dossier | extension GNOME Shell, `./install.sh` |
| **Windows 10 / 11** | [`windows/`](windows/README.md) | application C# / WPF, exécutable autonome |

Ce sont **deux logiciels distincts** qui partagent un design, pas un code : l'extension GNOME
s'exécute à l'intérieur du compositeur et n'a aucun équivalent exécutable sur Windows. Chacune
utilise les API de son système — MPRIS d'un côté, SMTC de l'autre ; message tray d'un côté,
`UserNotificationListener` de l'autre.

Ce fichier documente la version **GNOME**. Pour Windows, voir [`windows/README.md`](windows/README.md).

---

Une pilule noire flotte en haut de l'écran. Elle ne fait rien tant qu'il ne se passe rien,
puis elle s'anime : une notification arrive et elle s'ouvre pour l'afficher, la musique démarre
et elle affiche la pochette avec un petit égaliseur, un clic et elle se déplie en panneau de
contrôle complet.

Tout est réglable : emplacement, taille, arrondi, couleurs, vitesse des animations.

---

## Installation

```bash
git clone https://github.com/WiraXx/dynamicisland-for-Linux.git
cd dynamicisland-for-Linux
./install.sh
```

Puis **déconnecte-toi et reconnecte-toi** (obligatoire sous Wayland ; sous X11 tu peux aussi
faire `Alt+F2`, taper `r`, Entrée).

C'est tout. L'extension est activée, et elle se relancera toute seule à chaque ouverture de
session : il n'y a aucun service à démarrer.

> Le script n'a pas besoin des droits administrateur : il installe dans ton dossier personnel
> (`~/.local/share/gnome-shell/extensions/`).

### Mise à jour

```bash
git pull && ./install.sh
```

### Désinstallation

```bash
./uninstall.sh
```

---

## Utilisation

| Geste | Effet |
|---|---|
| **Clic gauche** sur la pilule | Déplie le panneau de contrôle |
| **Clic n'importe où** (fond du panneau compris) ou **Échap** | Referme le panneau |
| **Glissement latéral** sur une notification | La supprime |
| **Clic droit** sur la pilule | Ouvre les réglages |
| **Molette** sur la pilule | Règle le volume |
| **Survol** | La pilule réagit légèrement |

### Ce que l'île sait faire

- **Notifications** — elles apparaissent *dans* la pilule, en haut de l'écran : l'île s'élargit,
  affiche l'icône de l'application, le titre et le message, puis se referme. Les bannières
  natives de GNOME sont masquées pour ne pas voir la notification deux fois.
- **Volume et luminosité** — la pastille grise que GNOME affiche en bas de l'écran est
  remplacée : appuie sur les touches de volume, de micro ou de luminosité et le réglage
  apparaît **dans l'île**, avec l'icône, la jauge et le pourcentage. La molette sur la pilule
  fait la même chose. L'OSD d'origine reprend la main si l'île est masquée (plein écran) ou si
  le panneau est déjà ouvert, pour ne jamais perdre l'information.
- **Musique** — dès qu'un lecteur joue (Spotify, Firefox, VLC, Rhythmbox… tout ce qui parle
  MPRIS), la pilule affiche la **pochette** et les boutons **précédent / lecture-pause /
  suivant**, sans changer de taille. Au changement de morceau, le titre s'affiche quelques
  secondes avec un égaliseur animé, puis la pilule se rétracte. Durée réglable, 0 pour ne
  jamais afficher le titre.
- **Panneau de contrôle** (au clic) :
  - heure et date ;
  - lecteur : pochette, titre, artiste, précédent / lecture-pause / suivant, barre de
    progression déplaçable (un clic sur la pochette met le lecteur au premier plan) ;
  - curseur de **volume** (l'icône coupe le son) ;
  - curseur de **luminosité** (masqué automatiquement sur les machines sans rétroéclairage
    pilotable) ;
  - les **raccourcis d'applications** que tu as épinglés (voir plus bas) ;
  - l'**étagère à fichiers** (voir plus bas) ;
  - les **5 dernières notifications** : un clic ouvre l'application, un **glissement sur le
    côté** supprime la notification, et les **boutons d'action** de l'application (« Répondre »,
    « Marquer comme lu »…) sont affichés sous le message. Bouton « Tout effacer » pour la liste.

### Étagère à fichiers

Copie un fichier (`Ctrl+C` dans les Fichiers) : il se pose dans l'île. Ensuite, sur chaque ligne :

- un clic sur la ligne le **sélectionne** (pour l'envoyer à une application épinglée) ;
- le bouton **copier** le remet dans le presse-papier, prêt à être collé ailleurs ;
- le bouton **ouvrir** le lance avec l'application par défaut ;
- la croix le retire de l'étagère.

L'étagère garde les 8 derniers fichiers et survit à la fermeture de session.

> **Pourquoi copier et pas glisser-déposer ?** GNOME Shell ne peut pas être la cible d'un dépôt
> de fichier. Son gestionnaire de glisser-déposer (`js/ui/xdndHandler.js`) suit la position du
> curseur pendant un glissement, mais aucune donnée ne lui est transmise et aucun dépôt ne lui
> est délivré : seule une fenêtre peut recevoir un fichier. Le presse-papier transporte
> exactement la même chose (une liste d'URI), d'où ce choix.

### Raccourcis d'applications

Épingle des applications dans *Réglages → Raccourcis*. Leurs icônes apparaissent dans le panneau.

Si des fichiers sont **sélectionnés dans l'étagère**, ils sont passés à l'application lancée :
copier un fichier, cliquer dessus dans l'île, cliquer sur **LocalSend** — et le partage part avec
le fichier déjà chargé.

---

## Réglages

```bash
gnome-extensions prefs dynamicisland@wiraxx.github.io
```

ou clic droit sur la pilule, ou l'application **Extensions**.

Les changements sont appliqués **immédiatement** : tu peux garder la fenêtre de réglages
ouverte et regarder la pilule bouger pendant que tu ajustes.

| Page | Réglages |
|---|---|
| **Position** | Ancrage (6 bords), décalage horizontal et vertical, écran cible |
| **Taille** | Largeur et hauteur de la pilule, arrondi des coins, largeur et hauteur maximale du panneau |
| **Apparence** | Couleur de fond, opacité, couleur du texte, bordure, vitesse des animations, réaction au survol |
| **Raccourcis** | Applications épinglées (ajout, ordre, retrait), étagère à fichiers |
| **Comportement** | Notifications (durée, boutons d'action, masquage des bannières GNOME), volume et luminosité dans l'île, lecteur, durée du titre dans la pilule, molette-volume, masquage en plein écran, masquage au repos |

Un bouton **Réinitialiser** en bas de la page « Comportement » remet tout d'origine.

### Réglages utiles

- **La pilule cache l'horloge de la barre GNOME** : c'est normal, elle se place par-dessus
  comme une encoche. Baisse-la avec *Décalage vertical*, ou déplace l'horloge avec une
  extension du type « Just Perfection ».
- **La pilule est trop grande / trop petite** : *Taille → Pilule au repos*. Pour une pilule
  parfaitement arrondie, mets l'arrondi à la moitié de la hauteur (hauteur 30 → arrondi 15).
- **Tu ne veux la voir que quand il se passe quelque chose** : *Comportement → Masquer au repos*.
- **Le titre du morceau élargit la pilule trop longtemps** : *Comportement → Titre du morceau
  dans la pilule*, mets 0 pour n'avoir que la pochette et les boutons.

---

## Dépannage

**La pilule n'apparaît pas.**
Vérifie que l'extension est bien active :

```bash
gnome-extensions info dynamicisland@wiraxx.github.io
```

Si l'état est `INACTIVE` ou `ERROR`, regarde le journal :

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Le plus souvent, il manque une déconnexion/reconnexion après l'installation.

**Les notifications s'affichent en double.**
Active *Comportement → Masquer les bannières GNOME*.

**Le volume s'affiche encore en bas de l'écran.**
C'est le repli prévu : l'île était masquée (plein écran, ou *Masquer au repos*), ou le panneau
était ouvert. Sinon, vérifie *Comportement → Volume et luminosité dans l'île*.

**Répondre directement depuis la notification ?**
GNOME n'implémente pas la réponse en ligne du protocole de notifications — ni en 48, ni en 49 :
le shell ne reçoit jamais de canal de réponse de la part de l'application. Ce qui est affiché,
ce sont les **actions** que l'application joint elle-même à sa notification ; le « Répondre »
d'une messagerie ouvre donc la conversation dans l'application.

**Les fichiers copiés n'arrivent pas tout seuls dans l'étagère.**
La surveillance du presse-papier n'a pas pu se mettre en place sur ta version. Le bouton coller
de la section « Fichiers » les ajoute à la demande, et *Raccourcis → Attraper les fichiers
copiés* contrôle l'automatisme.

**Le curseur de luminosité est absent.**
C'est voulu : ta machine n'expose pas de rétroéclairage pilotable (cas des ordinateurs de bureau).

**Rien ne s'affiche pour la musique.**
Le lecteur doit exposer une interface MPRIS. Vérifie avec :

```bash
busctl --user list | grep mpris
```

---

## Compatibilité

- GNOME Shell **45 à 49** (Zorin OS 18, Ubuntu 23.10+, Fedora 39+, Debian 13…).
- **Wayland** et **X11**.
- Si ta version de GNOME est plus récente que celles déclarées, `install.sh` l'ajoute
  automatiquement au lieu de refuser l'installation.

## Structure du projet

```
dynamicisland@wiraxx.github.io/
├── extension.js          point d'entrée (enable / disable)
├── prefs.js              fenêtre de réglages
├── stylesheet.css        mise en forme
├── lib/
│   ├── island.js         l'île : géométrie, états, animations
│   ├── widgets.js        pochette, égaliseur, carte média, curseurs, notifications
│   ├── mediaPlayer.js    client MPRIS
│   ├── notifications.js  capture des notifications du shell
│   ├── system.js         volume et luminosité
│   └── utils.js          helpers et compatibilité entre versions de GNOME
└── schemas/              réglages GSettings
```

`specs.md` détaille chaque fonction du logiciel.

## Licence

MIT — voir [LICENSE](LICENSE).
