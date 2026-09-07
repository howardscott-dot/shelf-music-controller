# Security

SHELF is designed for a trusted home network. Do not expose port 8787, the WiiM UPnP interface, Jellyfin credentials, or the local control API directly to the public internet.

## Private files

The following contain credentials or household data and must never be committed:

- `.env` and other local environment files
- `.data/`, including Spotify refresh tokens and personal crates
- `.cache/`, including generated artwork
- logs, recordings and local research material

Use `.env.example` as the public template. Store real tokens only in the deployment's private `.env`, with permissions restricted to its administrator.

## Reporting a vulnerability

Please avoid including real credentials, account data, private music-library metadata or home-network addresses in a public issue. Use GitHub's private vulnerability-reporting feature when it is enabled for the repository.

