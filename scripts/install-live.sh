#!/bin/sh
# Copy luci-app-balancer onto a running OpenWrt 25.12+ router.
# This does not apply a balance policy and does not reload Wi-Fi.
#
#   ROUTER=root@192.168.100.1 sh scripts/install-live.sh
#
# Dropbear on OpenWrt has no sftp server, so scp needs -O.

set -e
cd "$(dirname "$0")/.."

ROUTER="${ROUTER:-root@192.168.100.1}"
SCP="${SCP:-scp -O}"
SSH="${SSH:-ssh}"

$SSH "$ROUTER" 'mkdir -p \
	/usr/sbin \
	/etc/uci-defaults \
	/usr/share/rpcd/ucode \
	/usr/share/rpcd/acl.d \
	/usr/share/luci/menu.d \
	/www/luci-static/resources/view/balancer'

$SCP root/usr/sbin/balancerctl "$ROUTER:/usr/sbin/balancerctl"
$SCP root/etc/uci-defaults/99-luci-app-balancer "$ROUTER:/etc/uci-defaults/99-luci-app-balancer"
$SCP root/usr/share/rpcd/ucode/luci.balancer "$ROUTER:/usr/share/rpcd/ucode/luci.balancer"
$SCP root/usr/share/rpcd/acl.d/luci-app-balancer.json "$ROUTER:/usr/share/rpcd/acl.d/luci-app-balancer.json"
$SCP root/usr/share/luci/menu.d/luci-app-balancer.json "$ROUTER:/usr/share/luci/menu.d/luci-app-balancer.json"
$SCP htdocs/luci-static/resources/view/balancer/overview.js "$ROUTER:/www/luci-static/resources/view/balancer/overview.js"
$SCP htdocs/luci-static/resources/view/balancer/log.js "$ROUTER:/www/luci-static/resources/view/balancer/log.js"
$SCP htdocs/luci-static/resources/view/balancer/balancer.css "$ROUTER:/www/luci-static/resources/view/balancer/balancer.css"

# Keep an existing config. Passwords live in that file.
$SSH "$ROUTER" 'test -s /etc/config/balancer' || $SCP root/etc/config/balancer "$ROUTER:/etc/config/balancer"

$SSH "$ROUTER" 'chmod 755 /usr/sbin/balancerctl /etc/uci-defaults/99-luci-app-balancer
chmod 600 /etc/config/balancer
sh /etc/uci-defaults/99-luci-app-balancer
rm -rf /tmp/luci-indexcache /tmp/luci-indexcache.* /tmp/luci-modulecache
/etc/init.d/rpcd reload
echo "--- selfcheck ---"
/usr/sbin/balancerctl selfcheck
echo "--- status ---"
/usr/sbin/balancerctl status
'
