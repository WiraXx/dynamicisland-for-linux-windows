#!/usr/bin/env bash
#
# Retire complètement la Dynamic Island.

set -euo pipefail

UUID="dynamicisland@wiraxx.github.io"
TARGET_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

say() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }

if command -v gnome-extensions >/dev/null 2>&1; then
    say "Désactivation"
    gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
fi

if [ -d "$TARGET_DIR" ]; then
    say "Suppression de ${TARGET_DIR}"
    rm -rf "$TARGET_DIR"
else
    say "Rien à supprimer : l'extension n'est pas installée."
fi

read -r -p "Supprimer aussi les réglages enregistrés ? [o/N] " answer
case "${answer}" in
    [oOyY]*)
        dconf reset -f /org/gnome/shell/extensions/dynamicisland/ 2>/dev/null || true
        say "Réglages effacés."
        ;;
    *)
        say "Réglages conservés."
        ;;
esac

say "Terminé. Déconnecte-toi et reconnecte-toi pour finir le nettoyage."
