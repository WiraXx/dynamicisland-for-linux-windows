#!/usr/bin/env bash
#
# Installe la Dynamic Island dans la session GNOME de l'utilisateur courant.
# Aucune permission root n'est nécessaire.

set -euo pipefail

UUID="dynamicisland@wiraxx.github.io"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$UUID"
TARGET_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m/!\\\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mErreur :\033[0m %s\n' "$1" >&2; exit 1; }

[ -d "$SOURCE_DIR" ] || die "dossier de l'extension introuvable : $SOURCE_DIR"

# --- 1. Vérification de l'environnement ------------------------------------

if ! command -v gnome-shell >/dev/null 2>&1; then
    die "GNOME Shell n'a pas été trouvé. Cette extension ne fonctionne que sous GNOME."
fi

SHELL_VERSION="$(gnome-shell --version | grep -oE '[0-9]+(\.[0-9]+)?' | head -n1)"
MAJOR="${SHELL_VERSION%%.*}"
say "GNOME Shell détecté : version ${SHELL_VERSION}"

if [ "$MAJOR" -lt 45 ] 2>/dev/null; then
    die "GNOME ${MAJOR} est trop ancien : cette extension demande GNOME 45 ou plus récent."
fi

# --- 2. Copie des fichiers -------------------------------------------------

say "Installation dans ${TARGET_DIR}"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -r "$SOURCE_DIR"/. "$TARGET_DIR"/

# --- 3. Déclaration de la version de GNOME ---------------------------------
# Le shell refuse de charger une extension qui ne mentionne pas sa version.

if ! grep -q "\"$MAJOR\"" "$TARGET_DIR/metadata.json"; then
    warn "GNOME ${MAJOR} n'était pas encore déclaré : ajout à metadata.json."
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$TARGET_DIR/metadata.json" "$MAJOR" <<'PY'
import json, sys
path, major = sys.argv[1], sys.argv[2]
with open(path) as handle:
    data = json.load(handle)
versions = data.get('shell-version', [])
if major not in versions:
    versions.append(major)
data['shell-version'] = versions
with open(path, 'w') as handle:
    json.dump(data, handle, indent=2, ensure_ascii=False)
    handle.write('\n')
PY
    else
        sed -i "s/\"shell-version\": \[/\"shell-version\": [\"$MAJOR\", /" "$TARGET_DIR/metadata.json"
    fi
fi

# --- 4. Compilation du schéma de réglages ----------------------------------

if command -v glib-compile-schemas >/dev/null 2>&1; then
    say "Compilation des réglages"
    glib-compile-schemas "$TARGET_DIR/schemas/"
else
    die "glib-compile-schemas est absent. Installe le paquet « libglib2.0-dev-bin » puis relance ce script."
fi

# --- 5. Activation ---------------------------------------------------------

enable_extension() {
    if gnome-extensions enable "$UUID" >/dev/null 2>&1; then
        return 0
    fi
    # Le shell n'a pas encore vu l'extension : on l'inscrit directement.
    local current new
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    case "$current" in
        *"'$UUID'"*) return 0 ;;
    esac
    case "$current" in
        "@as []"|"[]") new="['$UUID']" ;;
        *)             new="${current%]}, '$UUID']" ;;
    esac
    gsettings set org.gnome.shell enabled-extensions "$new"
}

say "Activation de l'extension"
enable_extension || warn "Activation automatique impossible : utilise l'application « Extensions »."

# --- 6. Rechargement du shell ----------------------------------------------

echo
say "Installation terminée."
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
    cat <<'MSG'

    Tu es sous Wayland : le shell ne peut pas être rechargé à chaud.
    Déconnecte-toi puis reconnecte-toi pour voir apparaître la pilule.

MSG
else
    cat <<'MSG'

    Tu es sous X11 : appuie sur Alt+F2, tape « r » puis Entrée
    pour recharger GNOME Shell (ou déconnecte-toi et reconnecte-toi).

MSG
fi

cat <<MSG
    Réglages (position, taille, couleurs) :
        gnome-extensions prefs ${UUID}

    Un clic droit sur la pilule ouvre aussi cette fenêtre.
MSG
