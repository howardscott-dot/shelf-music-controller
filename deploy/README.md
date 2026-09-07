# SHELF on a Proxmox LXC

Use a Debian 12 or 13 LXC with 1 vCPU, 1 GB RAM, 8 GB storage, and a bridged LAN address. SHELF must be able to reach both Jellyfin and the WiiM directly over the local network.

## 1. Prepare the LXC

Install Node.js 22 LTS and the transfer prerequisites from the LXC console:

```sh
apt-get update
apt-get install -y ca-certificates curl gnupg rsync
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs
node --version
```

The final command should report Node.js 20 or newer.

Assign the LXC a DHCP reservation or static address. Do not expose port 8787 through the internet-facing router.

## 2. Copy SHELF into the LXC

From another machine, copy the project without its generated dependencies:

```sh
rsync -av \
  --exclude node_modules --exclude dist --exclude .cache --exclude .data --exclude .git --exclude .env \
  "/path/to/shelf/" root@SHELF_LXC_IP:/opt/shelf/
```

Create the private configuration inside the LXC; never copy a development `.env` or `.data` directory into a deployment:

```sh
ssh root@SHELF_LXC_IP
cd /opt/shelf
cp .env.example .env
# Edit .env with addresses and credentials for this server.
chmod 600 .env
```

Confirm that `JELLYFIN_URL` and `WIIM_HOST` are LAN addresses reachable from the LXC.

## 3. Install the service

Inside the LXC:

```sh
cd /opt/shelf
chmod +x deploy/install-lxc.sh
./deploy/install-lxc.sh
```

The installer builds the React interface, serves it from the Fastify backend, creates a restricted `shelf` system user, and installs an automatically restarting systemd service.

Open `http://SHELF_LXC_IP:8787/` from the iPad or any machine on the LAN.

## Operations

```sh
systemctl status shelf
journalctl -u shelf -f
systemctl restart shelf
```

To update SHELF, use the same `rsync` command. Its `.env`, `.data` and `.cache` exclusions preserve the server configuration, account connection and artwork cache. Then rerun `/opt/shelf/deploy/install-lxc.sh`; the installer restarts the service.

If the page is unreachable, allow inbound TCP port 8787 in the Proxmox firewall for the trusted LAN only.

## Optional Spotify Premium connection

1. Create a **SHELF** app in the [Spotify dashboard](https://developer.spotify.com/dashboard), select Web API and register `http://127.0.0.1:8787/api/spotify/callback` exactly. Add the intended Spotify user to the app's user allowlist if required.
2. Set `SPOTIFY_CLIENT_ID` in `/opt/shelf/.env`. **No Client Secret is required**: SHELF uses authorization-code PKCE. Keep the default `SPOTIFY_REDIRECT_URI` for loopback setup. Restart `shelf.service`.
3. Spotify does not accept plain HTTP LAN addresses as callbacks. For one-time connection, use a temporary SSH tunnel from a computer to this LXC. Stop any local SHELF process using port 8787 first. With an authorized LXC SSH account:

   ```sh
   ssh -N -L 127.0.0.1:8787:127.0.0.1:8787 USER@SHELF_LXC_IP
   ```

   If access is through an authorized Proxmox administration account instead, forward through the host to the LXC's LAN address:

   ```sh
   ssh -N -L 127.0.0.1:8787:SHELF_LXC_IP:8787 USER@PROXMOX_HOST
   ```

4. On that same computer, open `http://127.0.0.1:8787/`, choose Spotify and connect. Start and finish sign-in in the same browser so the anti-forgery cookie is retained. The tunnel ensures the connection is saved on the server, not on the development computer.
5. Choose Spotify again, open **Devices**, and select the WiiM. If absent, use the normal Spotify app to play to the WiiM first, then refresh devices in SHELF.
6. Close the tunnel and revoke any temporary SSH access. The development computer can now be switched off. Open the server's normal LAN address from the playback interface. Spotify's refresh token remains server-side in a mode-0600 file and renews access automatically; an expired or revoked grant requires reconnecting.

Alternatively, use an HTTPS callback on a trusted private hostname with a valid certificate. Register the exact URL and set `SPOTIFY_REDIRECT_URI` accordingly; no public port forwarding is needed. Do not use `http://shelf.local` as Spotify's callback.

All trusted-LAN users of this SHELF instance share the connected Spotify account and selected speaker. **Disconnect account** removes the local connection for everyone, not any saved Spotify albums; you can also revoke SHELF in your Spotify account's apps settings. Back up `.data` as private credentials, separately from source code. Keep `SHELF_DATA_DIR=.data` with the supplied systemd sandbox (custom paths require matching write permissions).
