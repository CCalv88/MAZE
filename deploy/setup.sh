#!/usr/bin/env bash
# Installs or updates MAZE on the stegopets droplet. Safe to re-run. Run as root
# (deploy.ps1 uploads everything to /tmp/maze-release first and then runs this).
# Layout, mirroring sima / 9-5 / areudum / white-room:
#   /opt/maze/           server.js, core.js, the game (index.html, css/, js/), node_modules  -> systemd "maze" on 127.0.0.1:3700
#   /var/lib/maze/       mazes/<code>.json, every maze that has been shared or hosted
#   Caddy: handle /maze/* { uri strip_prefix /maze; reverse_proxy 127.0.0.1:3700 } with its own CSP
#   Homepage: a "Maze" tab after the White Room tab in /var/www/stegomon/index.html
set -euo pipefail
SRC=/tmp/maze-release
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
APP=/opt/maze

echo "--- app ---"
id -u maze >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin maze
mkdir -p "$APP" /var/lib/maze/mazes
if [ -f "$APP/server.js" ]; then tar -czf "/opt/maze-backup-$STAMP.tar.gz" -C "$APP" --exclude=node_modules .; fi
rm -rf "$APP/js" "$APP/css"
cp "$SRC"/{server.js,core.js,index.html,package.json,package-lock.json} "$APP/"
cp -r "$SRC/js" "$SRC/css" "$APP/"
(cd "$APP" && npm ci --omit=dev --silent)
chown -R root:maze "$APP"
chmod -R g+rX,o-rwx "$APP"
chown -R maze:maze /var/lib/maze
chmod 750 /var/lib/maze
cp "$SRC/deploy/maze.service" /etc/systemd/system/maze.service
systemctl daemon-reload
systemctl enable maze >/dev/null 2>&1 || true
systemctl restart maze
sleep 1.5
echo "service: $(systemctl is-active maze)"
printf 'health: '; curl --fail --silent http://127.0.0.1:3700/health; echo

echo "--- caddy ---"
CADDY=/etc/caddy/Caddyfile
if ! grep -q 'handle /maze/\*' "$CADDY"; then
  cp "$CADDY" "$CADDY.bak-$STAMP-pre-maze"
  python3 - "$CADDY" "$SRC/deploy/caddy-maze.conf" <<'PY'
import sys
path, blockpath = sys.argv[1], sys.argv[2]
s = open(path).read(); block = open(blockpath).read()
anchor = "\thandle /fridge-api/* {"
assert anchor in s, "fridge-api anchor not found"
s = s.replace(anchor, block.rstrip("\n") + "\n\n" + anchor, 1)
# The block above carries its own CSP, so the site-wide one must not also apply.
lines = s.splitlines()
for i, line in enumerate(lines):
    if "@notfrog not path" in line and " /maze " not in line + " ":
        lines[i] += " /maze /maze/*"
open(path, "w").write("\n".join(lines) + "\n")
print("caddyfile patched (backup kept)")
PY
  if caddy validate --config "$CADDY" >/dev/null; then
    systemctl reload caddy && echo "caddy reloaded"
  else
    cp "$CADDY.bak-$STAMP-pre-maze" "$CADDY"
    echo "caddyfile invalid: restored backup" >&2
    exit 1
  fi
else
  echo "caddy already has the maze block"
fi

echo "--- nav tab ---"
INDEX=/var/www/stegomon/index.html
if ! grep -q 'id="mazeLink"' "$INDEX"; then
  cp "$INDEX" "$INDEX.bak-$STAMP-pre-maze-tab"
  python3 - "$INDEX" <<'PY'
import sys
path = sys.argv[1]
s = open(path, encoding="utf-8").read()
anchor = None
for candidate in ('id="whiteRoomLink"', 'id="areudumLink"', 'id="nineFiveLink"', 'id="simaLink"'):
    if candidate in s:
        anchor = candidate
        break
assert anchor, "no existing game tab found to anchor on"
i = s.find(anchor)
end = s.find("</a>", i) + len("</a>")
line_start = s.rfind("\n", 0, i) + 1
prefix = s[line_start:i]
indent = prefix[: len(prefix) - len(prefix.lstrip())]
tab = '<a class="text-button top-nav-button" id="mazeLink" href="/maze/" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; justify-content: center; text-decoration: none;">Maze \U0001F5DD️</a>'
s = s[:end] + "\n" + indent + tab + s[end:]
open(path, "w", encoding="utf-8").write(s)
print("nav tab added after " + anchor + " (backup kept)")
PY
  chown www-data:www-data "$INDEX"
else
  echo "nav tab already present"
fi

echo "--- live checks ---"
sleep 1
for u in https://stegopets.com/maze/ https://stegopets.com/maze/health https://stegopets.com/maze/js/sim.js https://stegopets.com/ https://stegopets.com/925/ https://stegopets.com/sima/ https://stegopets.com/areudum/ https://stegopets.com/white-room/ https://stegopets.com/fridge-friends/; do
  printf '%s -> ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "$u"
done
curl -sI https://stegopets.com/maze/ | grep -i -E '^content-security-policy|^content-type' | cut -c1-160
grep -c 'id="mazeLink"' "$INDEX" | sed 's/^/nav tab count: /'
