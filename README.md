# openwrt-balancer

English · [فارسی](README.fa.md)

A LuCI app (`luci-app-balancer`) that makes multi-WAN load balancing easy to look at and easy to change. It sits on top of [mwan3](https://openwrt.org/docs/guide-user/network/wan/multiwan/mwan3). You add Wi-Fi networks and physical ports, give each one a weight, and the router shares new connections across them.

The page is a small set of cards: source, online or offline, and a weight slider. **Reset to Default** puts the original single-WAN policy back.

![Balancer on the Network page. Example sources: a WAN at 60 percent and a Wi-Fi uplink at 40 percent.](docs/images/dashboard.png)

## Quick install on OpenWrt 25.12 LTS

The file on the GitHub release is the OpenWrt **25.12** package (apk, firewall4). It is architecture-independent (`noarch`), so the same apk installs on every 25.12 target.

`mwan3` has to be installed first if it is not already:

```sh
apk add mwan3
```

On the router, download the 1.0.0 release and install it:

```sh
wget -O /tmp/luci-app-balancer.apk \
  https://github.com/WhoisGray/openwrt-balancer/releases/download/v1.0.0/luci-app-balancer-1.0.0-r1.apk
apk add --allow-untrusted /tmp/luci-app-balancer.apk
```

Then open **Network → Balancer**:

`http://<router>/cgi-bin/luci/admin/network/balancer`

If the menu entry is missing, log out of LuCI and back in.

Newer builds are on the [releases page](https://github.com/WhoisGray/openwrt-balancer/releases). Pick the `.apk` asset. To install whichever release is marked latest:

```sh
wget -q -O /tmp/balancer-release.json \
  https://api.github.com/repos/WhoisGray/openwrt-balancer/releases/latest
url=$(jsonfilter -i /tmp/balancer-release.json -e '@.assets[0].browser_download_url')
wget -O /tmp/luci-app-balancer.apk "$url"
apk add --allow-untrusted /tmp/luci-app-balancer.apk
```

Removing the package restores the original policy:

```sh
apk del luci-app-balancer
```

The install does not apply a balance and does not reload Wi-Fi. Nothing changes until you add a source and apply it.

## What you can do

- Add several Wi-Fi networks as WAN clients (station mode), each with a weight
- Use an existing interface (WAN, USB Ethernet, and so on) or a free physical port
- See every source, its share of the traffic, and whether it is online
- Move a weight slider and update mwan3 without reloading Wi-Fi
- Read a short log of what the app changed
- Restore the original mwan3 `balanced` policy with one confirmation

## Requirements

- OpenWrt 25.12 or newer (apk, firewall4)
- `mwan3` installed and the LuCI base UI
- `luci-app-mwan3` is useful for the advanced screens and is not required by this package

## How balancing works

mwan3 already has a policy named `balanced`. On a normal install the HTTPS rule and the default rules use that policy, so changing its member list changes how traffic is shared.

While Balancer is applied it owns **only** that member list:

- Every enabled source becomes one mwan3 member
- Members use the **same metric** and **different weights**, which is load balancing
- Different metrics would be failover, and this app does not do that
- The weight slider is the share. Two sources at 10 and 10 each take half. A source at 30 next to one at 10 takes about three quarters

The first time you apply, Balancer stores the previous `balanced` member list inside `/etc/config/balancer`. Reset writes that list back. Stock sections such as `wan`, `lan`, and `wan_m1_w3` are left in place. Objects this app creates are marked `option balancer '1'` and are the only ones it deletes.

Wi-Fi passwords are stored in `/etc/config/balancer` (mode `600`) and copied into the wireless config when you apply. They are not written to the log or the status page.

## Safety

- Adding a Wi-Fi source runs `wifi reload`. Wireless clients drop for a few seconds.
- Adding a port can reload the network. The WAN address comes back from DHCP.
- A port that belongs to the LAN bridge is removed from the bridge only after you tick the confirmation. Reset puts it back.
- The LAN bridge itself (`br-lan`) cannot be turned into a WAN.
- Apply is refused when every source is disabled, so the policy is never emptied by accident.
- Uninstalling the package runs the same restore as **Reset to Default**.

If this router is your only path to the network, add the working WAN as a source before you rely on a new Wi-Fi uplink.

## Using the app

1. Install the package and open **Network → Balancer**.
2. **Add Wi-Fi** for a hotspot or a second ISP, or **Add interface** for a port that already has internet.
3. Set a weight. The card shows that weight and its percent of the total.
4. The badge turns **Online** when the link has an IPv4 address or mwan3 tracking says it is up.
5. Drag the slider to change a share. The slider updates immediately; mwan3 restarts once you release it. Wi-Fi is not reloaded.
6. **Reset to Default** restores the original policy. Leave “Also forget saved sources” unticked if you want to apply the same list again later.

![Add Wi-Fi. Scan fills the name, band, and security. The password stays on the router.](docs/images/add-wifi.png)

The **Log** page shows the last lines from `/var/log/balancer.log`. Passwords are left out.

![Log of an apply and a weight change.](docs/images/log.png)

### Command line

`balancerctl` prints one JSON object. It is what the web UI calls.

```sh
balancerctl status
balancerctl log
balancerctl scan 5g
balancerctl apply
balancerctl reset
balancerctl reset 1          # restore WAN and delete saved sources
balancerctl set_weight s1ab2c 40
balancerctl enable s1ab2c 0
```

`save` reads a JSON file (the UI creates it). You normally add sources from the web page.

## Copy the files without an apk

From a checkout of this repository, on a computer that can reach the router:

```sh
ROUTER=root@192.168.1.1 sh scripts/install-live.sh
```

The script uses `scp -O` because OpenWrt’s Dropbear has no SFTP server. It reloads `rpcd` and the LuCI menu cache. It does not apply a policy and it does not reload Wi-Fi.

## Build an apk with the OpenWrt SDK

OpenWrt 25.12 packages are apk files, produced by the normal image build system.

1. Get the SDK or a full build tree that matches your target, for example `ipq40xx/chromium` for a Google WiFi (Gale).
2. Copy this repository into the tree:

   ```sh
   cp -a openwrt-balancer /path/to/openwrt/package/luci-app-balancer
   ```

3. Compile:

   ```sh
   cd /path/to/openwrt
   make package/luci-app-balancer/compile V=s
   ```

4. The package lands under `bin/packages/<arch>/base/` and is named like `luci-app-balancer-1.0.0-r1.apk`. `PKGARCH` is `all`, so the same apk installs on any arch.

5. Copy it to the router and install it:

   ```sh
   scp -O bin/packages/*/base/luci-app-balancer-*.apk root@192.168.1.1:/tmp/
   ssh root@192.168.1.1 'apk add --allow-untrusted /tmp/luci-app-balancer-*.apk'
   ```

## Files

| Path | Role |
| --- | --- |
| `Makefile` | OpenWrt package |
| `root/usr/sbin/balancerctl` | UCI, mwan3, network, and Wi-Fi changes |
| `root/usr/share/rpcd/ucode/luci.balancer` | LuCI ubus methods |
| `root/usr/share/rpcd/acl.d/luci-app-balancer.json` | ACL |
| `root/usr/share/luci/menu.d/luci-app-balancer.json` | Network → Balancer |
| `htdocs/.../overview.js` | Dashboard |
| `htdocs/.../log.js` | Log page |
| `htdocs/.../balancer.css` | Layout and motion |
| `root/etc/config/balancer` | Default config |
| `docs/images/` | Pictures used in this README |
| `README.fa.md` | This page in Persian |

## License

Apache License 2.0. See [LICENSE](LICENSE).
