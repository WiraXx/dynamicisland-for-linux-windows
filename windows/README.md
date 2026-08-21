# Dynamic Island pour Windows

La même île, pour Windows 10 et 11.

> **Ce n'est pas un portage du code Linux.** La version GNOME est une extension qui s'exécute
> *à l'intérieur* du compositeur GNOME ; rien de ce code ne peut tourner sur Windows. Ce dossier
> contient donc une seconde application, écrite en C# / WPF, qui reproduit le même produit avec
> les API de Windows. Les deux partagent un design et des réglages de même nom, pas une ligne de
> code.

---

## Récupérer le programme

Chaque envoi de code déclenche une compilation sur GitHub :

1. Onglet **Actions** du dépôt → dernier passage de **Compilation Windows** ;
2. section **Artifacts** en bas → **DynamicIsland-windows-x64** ;
3. décompresse, lance `DynamicIsland.exe`.

L'exécutable est **autonome** : il n'y a ni installateur ni .NET à installer.

Pour qu'il démarre avec Windows : clic droit sur la pilule → **Démarrer avec Windows** (une clé
est écrite dans `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, rien n'est installé
ailleurs).

### Compiler soi-même

```powershell
dotnet run --project windows\DynamicIsland\DynamicIsland.csproj
```

Il faut le [SDK .NET 8](https://dotnet.microsoft.com/download/dotnet/8.0).

---

## Utilisation

| Geste | Effet |
|---|---|
| **Clic gauche** sur la pilule | Déplie le panneau |
| **Clic ailleurs**, **Échap**, ou clic sur le fond du panneau | Le referme |
| **Clic droit** sur la pilule | Menu : réglages, démarrage automatique, quitter |
| **Molette** sur la pilule | Règle le volume |
| **Glisser un fichier sur la pilule** | Le pose dans l'étagère |
| **Glisser une ligne de l'étagère** vers une fenêtre | Y dépose le fichier |
| **Glissement latéral** sur une notification | La supprime |
| Double-clic sur l'icône près de l'horloge | Ouvre le panneau |

### Ce que l'île fait

- **Lecteur** — pochette, titre, artiste, précédent / lecture-pause / suivant et barre de
  progression, par les contrôles de transport de Windows (SMTC) : la même source que la petite
  fenêtre de lecture du système, donc Spotify, Firefox, Chrome, VLC, Groove… tout y passe. Au
  repos, la pilule montre la pochette et les trois boutons ; le titre n'apparaît que quelques
  secondes au changement de morceau.
- **Volume** — curseur dans le panneau, molette sur la pilule, et affichage du niveau dans l'île
  à chaque changement.
- **Luminosité** — curseur dans le panneau, sur les machines dont l'écran est pilotable (WMI).
  Masqué sur les ordinateurs de bureau.
- **Étagère à fichiers** — glisse un fichier sur la pilule, il y reste ; tu peux ensuite le
  reglisser vers n'importe quelle fenêtre, l'ouvrir, ou le passer à une application épinglée.
- **Raccourcis d'applications** — épingle des programmes dans les réglages. Si des fichiers sont
  sélectionnés dans l'étagère, ils sont passés en arguments à l'application lancée : de quoi
  envoyer un fichier avec LocalSend en deux clics.
- **Notifications** — voir la réserve ci-dessous.

---

## Deux réserves, à connaître avant de râler

**Les notifications demandent une autorisation que Windows n'accorde pas toujours.**
Lire les notifications des autres applications passe par `UserNotificationListener`, que Windows
réserve en principe aux applications empaquetées (MSIX). Pour un simple `.exe`, l'autorisation
est souvent refusée. L'île le détecte au démarrage et l'écrit dans le panneau, à la place de la
liste, plutôt que de rester vide sans explication. Si c'est ton cas, vérifie d'abord
**Paramètres → Confidentialité et sécurité → Notifications**.

**Windows garde sa propre pastille de volume.**
Contrairement à GNOME, où l'on peut détourner proprement l'affichage du système, Windows ne
laisse pas remplacer la sienne (en haut à gauche de l'écran). Tu verras donc les deux : la
pastille Windows et celle de l'île. *Réglages → Afficher le volume dans l'île* coupe la nôtre si
ça te dérange.

---

## Réglages

Clic droit sur la pilule → **Réglages**, ou l'icône engrenage dans le panneau.

Position (ancrage, décalages, écran), taille (pilule, arrondi, panneau), apparence (couleurs en
hexadécimal, opacité, bordure, vitesse des animations), comportement (notifications, lecteur,
luminosité, volume, étagère, masquage au repos, démarrage avec Windows) et applications épinglées.

Tout est appliqué **immédiatement**, sans redémarrer le programme. Les réglages sont enregistrés
dans `%APPDATA%\DynamicIsland\settings.json`.

---

## Structure

```
windows/DynamicIsland/
├── Program.cs             point d'entrée, instance unique
├── AppSettings.cs         réglages JSON
├── Native.cs              style de fenêtre et interop CoreAudio
├── Services/
│   ├── MediaService.cs         lecteur, via SMTC
│   ├── AudioService.cs         volume, via CoreAudio
│   ├── BrightnessService.cs    luminosité, via WMI
│   ├── NotificationService.cs  notifications, via UserNotificationListener
│   ├── ShelfService.cs         étagère à fichiers
│   └── ShortcutService.cs      lancement d'applications et démarrage auto
└── UI/
    ├── IslandWindow.cs    la pilule : états, animations, glisser-déposer
    ├── SettingsWindow.cs  fenêtre de réglages
    └── Theme.cs           fabrique d'éléments et jauge maison
```

L'interface est construite **en C#, sans XAML** : pas de balisage à garder en phase avec le code,
et un rendu sombre sans avoir à redéfinir les gabarits WPF.
