#!/bin/sh
# Local syntax checks. They do not talk to a router.
set -e
cd "$(dirname "$0")/.."
sh -n root/usr/sbin/balancerctl
sh -n root/etc/uci-defaults/99-luci-app-balancer
sh -n scripts/install-live.sh
python3 - << 'PY'
import json, pathlib
root = pathlib.Path('.')
for path in [
    root / 'root/usr/share/luci/menu.d/luci-app-balancer.json',
    root / 'root/usr/share/rpcd/acl.d/luci-app-balancer.json',
]:
    json.loads(path.read_text())
    print('json ok', path)
PY
if command -v node >/dev/null 2>&1; then
	# LuCI wraps each view in a function, which is what makes the top-level return legal.
	for f in htdocs/luci-static/resources/view/balancer/overview.js htdocs/luci-static/resources/view/balancer/log.js; do
		{ printf '%s\n' '(function(){'; cat "$f"; printf '%s\n' '})();'; } > /tmp/balancer-view-check.js
		node --check /tmp/balancer-view-check.js
		rm -f /tmp/balancer-view-check.js
	done
	echo 'js ok'
fi
echo 'check ok'
