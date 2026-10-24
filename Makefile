# SPDX-License-Identifier: Apache-2.0
#
# luci-app-balancer — Multi-WAN load balancing for LuCI.
# Standalone package. Drop this directory into an OpenWrt 25.12+ build tree
# as package/luci-app-balancer and compile it. No luci.mk required.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-balancer
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=whoisGray

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-balancer
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Multi-WAN Balancer
  PKGARCH:=all
  DEPENDS:=+mwan3 +luci-base +rpcd +rpcd-mod-ucode +ucode
endef

define Package/luci-app-balancer/description
  A calm LuCI front end for mwan3. Add Wi-Fi networks and physical ports as
  internet sources, give each one a weight, and send traffic through all of
  them. Reset to Default restores the original single-WAN policy.
endef

define Package/luci-app-balancer/conffiles
/etc/config/balancer
endef

define Build/Compile
endef

define Package/luci-app-balancer/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./root/usr/sbin/balancerctl $(1)/usr/sbin/balancerctl

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/balancer $(1)/etc/config/balancer

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/99-luci-app-balancer $(1)/etc/uci-defaults/99-luci-app-balancer

	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./root/usr/share/rpcd/ucode/luci.balancer $(1)/usr/share/rpcd/ucode/luci.balancer

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-balancer.json $(1)/usr/share/rpcd/acl.d/luci-app-balancer.json

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-balancer.json $(1)/usr/share/luci/menu.d/luci-app-balancer.json

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/balancer
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/balancer/overview.js $(1)/www/luci-static/resources/view/balancer/overview.js
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/balancer/log.js $(1)/www/luci-static/resources/view/balancer/log.js
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/balancer/balancer.css $(1)/www/luci-static/resources/view/balancer/balancer.css
endef

define Package/luci-app-balancer/postinst
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
	rm -rf /tmp/luci-indexcache /tmp/luci-indexcache.* /tmp/luci-modulecache
	if [ -x /etc/init.d/rpcd ]; then
		/etc/init.d/rpcd reload
	fi
fi
exit 0
endef

define Package/luci-app-balancer/prerm
#!/bin/sh
# Removing the app puts the WAN policy back when Balancer had taken it over.
if [ -z "$${IPKG_INSTROOT}" ] && [ -x /usr/sbin/balancerctl ]; then
	/usr/sbin/balancerctl reset >/dev/null 2>&1 || true
fi
exit 0
endef

$(eval $(call BuildPackage,luci-app-balancer))
