# Contributing to SHELF

Contributions are welcome. Keep changes focused, preserve the touch-first shelf interaction, and never add real account credentials, personal library exports, recordings or home-network details.

## Development

1. Copy `.env.example` to `.env` and add credentials for a dedicated, least-privilege Jellyfin user.
2. Install dependencies with `npm install`.
3. Run the application with `npm run dev`.
4. Before submitting a change, run `npm run typecheck`, `npm test` and `npm run build`.

Tests must use obviously fictional credentials and addresses. New integrations should keep access tokens on the server and should not expose private account responses to the browser.

