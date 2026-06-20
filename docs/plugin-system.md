# Plugin System

Rattin uses a plugin system to separate content search from the main application. Plugins are standalone Node.js processes that the main app spawns and communicates with via HTTP.

## Architecture

```
┌─────────────────────────────────────┐
│           Rattin App                │
│  (Qt + React + Express + mpv)       │
│                                     │
│  routes/search.ts ──┐               │
│  routes/plugins.ts ─┤               │
│                     ▼               │
│            PluginRegistry           │
│  (lib/plugins/registry.ts)          │
│                     │               │
│                     │ HTTP (localhost)
│                     ▼               │
│  ┌──────────────────────────────┐   │
│  │      Plugin Process          │   │
│  │  (rattin-sources.js)         │   │
│  │                              │   │
│  │  /health  /search            │   │
│  │  /search-batch               │   │
│  │  /availability               │   │
│  │                              │   │
│  │  ┌─────┬─────┬─────┬──────┐ │   │
│  │  │ TPB │EZTV │ YTS │Torren│ │   │
│  │  │     │     │     │ tio  │ │   │
│  │  └─────┴─────┴─────┴──────┘ │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

## How It Works

1. **Plugin discovery**: On startup, the app fetches `plugin-index.json` from the CDN (with local fallback)
2. **Installation**: User clicks "Install" → app downloads the plugin `.js` and `.sig` files
3. **Signature verification**: The app verifies the Ed25519 signature against the hardcoded public key
4. **Spawning**: The app spawns the plugin as a child process with `RATTIN_PLUGIN_PORT=0` and `RATTIN_PLUGIN_SECRET=<random>`
5. **Communication**: The plugin reports its port via stdout (`{"port": 12345}`), and the app sends HTTP requests with `Authorization: Bearer <secret>`
6. **Search proxy**: When the user searches, the main app forwards the query to the plugin via `/search` or `/search-batch`
7. **Restart on crash**: If the plugin process exits unexpectedly, the registry restarts it with exponential backoff

## Plugin API

Plugins must implement these HTTP endpoints:

### `GET /health`

Returns plugin metadata:

```json
{
  "id": "rattin-sources",
  "name": "Content Sources",
  "version": "1.0.0",
  "apiVersion": 1
}
```

### `POST /search`

Accepts a search query and returns results:

```json
// Request
{
  "query": "The Matrix 1999",
  "type": "movie",
  "imdbId": "tt0133093"
}

// Response
[
  {
    "infoHash": "abc123...",
    "name": "The.Matrix.1999.1080p.BluRay.x264-GROUP",
    "size": 8589934592,
    "seeders": 150,
    "leechers": 10,
    "source": "yts",
    "languages": ["🇬🇧"],
    "hasSubs": false,
    "multiAudio": false,
    "foreignOnly": false
  }
]
```

### `POST /search-batch`

Accepts multiple queries for parallel execution:

```json
// Request
{
  "queries": [
    { "query": "Show S01E01", "type": "tv", "season": 1, "episode": 1 },
    { "query": "Show S01", "type": "tv", "season": 1 }
  ]
}

// Response (array of result arrays)
[[...], [...]]
```

### `POST /availability`

Checks if items are available for streaming:

```json
// Request
{
  "items": [
    { "title": "The Matrix", "year": 1999, "type": "movie" }
  ]
}

// Response
{
  "available": [0]
}
```

## SearchResult Fields

| Field | Type | Description |
|-------|------|-------------|
| `infoHash` | `string` | Torrent info hash (lowercase) |
| `name` | `string` | Torrent name |
| `size` | `number` | File size in bytes |
| `seeders` | `number` | Number of seeders |
| `leechers` | `number` | Number of leechers |
| `source` | `string` | Provider name (e.g., "tpb", "yts", "torrentio") |
| `seasonPack` | `boolean?` | Whether this is a full season pack |
| `fileIdx` | `number?` | File index within the torrent (for multi-file) |
| `languages` | `string[]?` | Language flag emojis (e.g., ["🇬🇧", "🇮🇹"]) |
| `hasSubs` | `boolean?` | Whether subtitles are available |
| `subLanguages` | `string[]?` | Subtitle languages (e.g., ["English", "Multi"]) |
| `multiAudio` | `boolean?` | Whether multiple audio tracks are available |
| `foreignOnly` | `boolean?` | Whether content is foreign-language only |

## Security

### Ed25519 Code Signing

- Plugins are signed with Ed25519 using Node's built-in `crypto` module
- The production public key is hardcoded in `lib/plugins/pubkey.ts`
- The private key is stored as a GitHub Actions secret (`PLUGIN_SIGNING_PRIVATE_KEY`)
- On install, the app verifies the signature before spawning the plugin
- Unsigned plugins can only be installed in developer mode

### Auth Token

- The app generates a random 32-byte hex secret on each spawn
- All HTTP requests to the plugin include `Authorization: Bearer <secret>`
- Requests without the correct token get a 403 response

## Development

### Local Development

To develop and test a plugin locally:

1. Build the plugin:
   ```bash
   cd rattin-plugins
   npm run build
   ```

2. Sign with the dev key (from `test/fixtures/dev-private-key.json`):
   ```bash
   node -e "
   const crypto = require('crypto');
   const fs = require('fs');
   const plugin = fs.readFileSync('dist/rattin-sources.js');
   const priv = crypto.createPrivateKey({
     key: Buffer.from('DEV_KEY_BASE64', 'base64'),
     format: 'der', type: 'pkcs8'
   });
   fs.writeFileSync('dist/rattin-sources.js.sig', crypto.sign(null, plugin, priv));
   "
   ```

3. Update `public/plugin-index.json` in the main repo to point to your local file:
   ```json
   [{
     "id": "rattin-sources",
     "downloadUrl": "file:///path/to/dist/rattin-sources.js",
     "sha256": "<computed hash>",
     "version": "1.0.0",
     ...
   }]
   ```

4. Start the app and install via Settings → Content Sources

### Developer Mode

Enable developer mode in Settings to install unsigned plugins from local files. This bypasses signature verification and is intended for development only.

## Release Process

1. Make changes in the `rattin-plugins` repo
2. Tag and push:
   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```
3. CI automatically:
   - Builds the plugin
   - Signs it with the production key
   - Computes SHA256
   - Deploys to Cloudflare Pages CDN
   - Creates a GitHub release with the SHA256
4. Update `public/plugin-index.json` in the main repo with the new version and SHA256

## CDN

The plugin is hosted on Cloudflare Pages at `https://rattin-plugins.pages.dev/`.

| File | URL |
|------|-----|
| Plugin index | `https://rattin-plugins.pages.dev/plugin-index.json` |
| Plugin binary | `https://rattin-plugins.pages.dev/plugins/rattin-sources/{version}.js` |
| Signature | `https://rattin-plugins.pages.dev/plugins/rattin-sources/{version}.js.sig` |

## Files Reference

### Main Repo (`rattin-public`)

| File | Purpose |
|------|---------|
| `lib/plugins/types.ts` | TypeScript interfaces for plugin API |
| `lib/plugins/pubkey.ts` | Production Ed25519 public key |
| `lib/plugins/signing.ts` | Signature verification utilities |
| `lib/plugins/registry.ts` | Plugin process manager (spawn, health, proxy) |
| `lib/plugins/plugin-paths.ts` | Plugin storage directory helpers |
| `routes/plugins.ts` | HTTP routes for plugin management |
| `public/plugin-index.json` | Bootstrap plugin index (fallback) |

### Plugin Repo (`rattin-plugins`)

| File | Purpose |
|------|---------|
| `src/index.ts` | HTTP server entry point |
| `src/types.ts` | Type definitions |
| `src/providers/tpb.ts` | The Pirate Bay search |
| `src/providers/eztv.ts` | EZTV search |
| `src/providers/yts.ts` | YTS search |
| `src/providers/torrentio.ts` | Torrentio search + metadata parsing |
| `src/providers/index.ts` | Multi-provider search orchestrator |
| `build.mjs` | esbuild bundler |
| `.github/workflows/release.yml` | CI: build → sign → deploy → release |
