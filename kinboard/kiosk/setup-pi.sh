#!/usr/bin/env bash
# Turns a Raspberry Pi (Raspberry Pi OS Bookworm or newer, desktop edition) into a Kinboard wall display:
# boots straight into a full-screen Kinboard, never blanks the screen, and recovers after power cuts.
#
# Usage (on the Pi, as the normal desktop user, not root):
#   bash setup-pi.sh                 # asks for your family code
#   bash setup-pi.sh ABCD-EFGH-JKMN-PQRS
set -euo pipefail

APP_URL="${KINBOARD_URL:-https://d3athstroke25.github.io/github-slideshow/}"
CODE="${1:-}"
if [ -z "$CODE" ]; then
  read -rp "Family code from the Family tab (leave empty to set up on screen): " CODE
fi
CODE="$(echo "$CODE" | tr -cd 'A-Za-z0-9' | tr 'a-z' 'A-Z')"
URL="$APP_URL"
[ ${#CODE} -eq 16 ] && URL="${APP_URL}#join-${CODE}"

if [ "$(id -u)" -eq 0 ]; then echo "Run this as your normal user (it will use sudo when needed)."; exit 1; fi

BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
  sudo apt-get update && (sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser)
  BROWSER="$(command -v chromium || command -v chromium-browser)"
fi

echo "› Disabling screen blanking"
sudo raspi-config nonint do_blanking 1 || true

echo "› Writing the kiosk launcher"
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/kinboard-kiosk" <<LAUNCH
#!/usr/bin/env bash
# Clear the "Chromium didn't shut down correctly" bubble after a power cut.
PREFS="\$HOME/.config/chromium/Default/Preferences"
[ -f "\$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' "\$PREFS"
# Wait for the network so the first load works.
for i in \$(seq 1 30); do ping -c1 -W1 1.1.1.1 >/dev/null 2>&1 && break; sleep 2; done
exec "$BROWSER" --kiosk --app="$URL" \\
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
  --overscroll-history-navigation=0 --disable-pinch --check-for-update-interval=31536000 \\
  --password-store=basic --ozone-platform-hint=auto
LAUNCH
chmod +x "$HOME/.local/bin/kinboard-kiosk"

echo "› Starting it automatically at login"
# Raspberry Pi OS desktops (labwc, wayfire, X11) all run XDG autostart entries at login.
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/kinboard.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Kinboard
Exec=$HOME/.local/bin/kinboard-kiosk
X-GNOME-Autostart-enabled=true
DESK

echo "› Enabling desktop auto-login"
sudo raspi-config nonint do_boot_behaviour B4 || true

echo
echo "Done. Reboot with:  sudo reboot"
echo "Kinboard will open full screen. Then go to Family → Wall display and turn on Wall display mode and Night clock."
[ ${#CODE} -ne 16 ] && echo "No family code given: you'll be asked to join or create a family on screen."
exit 0
