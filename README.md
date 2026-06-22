<p align="center">
  <img src="packaging/linux/rattin.svg" alt="Rattin" width="160" height="160"/>
</p>
<h1 align="center">Rattin</h1>

<p align="center">
  <strong>Open-source desktop media center.</strong><br>
  Browse. Click. Watch. No downloads. No waiting.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/desktop-linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux" />
  <img src="https://img.shields.io/badge/desktop-windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/remote-phone-34A853?style=for-the-badge&logo=android&logoColor=white" alt="Remote" />
</p>

<img width="1918" height="1077" alt="image" src="https://github.com/user-attachments/assets/e1f1aa65-a8d1-494e-8259-a894b198bde7" />

---

## Why Rattin

Rattin is a single desktop app for browsing, clicking, and watching — without waiting, without
accounts, without telemetry. It plays every format through libmpv, keeps your history local,
and stays out of your way.

🎬 Every codec, every container, every format — played natively through libmpv with hardware decoding<br>
⏩ Smart seeking in incomplete files — jump anywhere, even before it's downloaded<br>
🍿 One-tap binge mode — auto-skip intros and credits, auto-advance to the next episode, and keep your audio/subtitle picks across a whole show (AniSkip + IntroDB, plus credits learned from your own watching)<br>
🔍 TMDB discovery — trending, genres, search, trailers, cast<br>
📱 Phone remote via QR scan — no app install, just point your camera<br>
🔒 No account, no database, no cloud, no telemetry — nothing leaves your machine<br>
⚡ Optional private cache — instant playback, full seeking, no peer exposure

### :mag: Discovery

- **Full movie & TV browser** - Trending, new releases, top rated, genres, cast, trailers
- **Signed add-ons** - Install add-ons from the Rattin registry to extend what Rattin can do.
- **Watch history** - Tracks where you left off across movies and TV episodes, resumes automatically
- **Saved list** - Save movies and shows for later from any detail page
- **Quality at a glance** - Resolution, codec, and audio format parsed from every result

### :zap: Player

- **Every format natively** - MKV, AVI, HEVC, AV1, HDR, Dolby Vision — zero transcoding, powered by libmpv
- **Hardware decoding** - VAAPI, NVDEC, VideoToolbox — your GPU does the work
- **Seek anywhere** - Even in files that haven't fully downloaded yet
- **Skip intro** *(WIP)* - Detects TV show intros via audio fingerprinting
- **Subtitles** - Embedded and external, with language detection and resizable text (SRT, ASS, SSA, VTT)
- **Multiple audio tracks** - Switch languages and surround formats on the fly
- **Source switching** - Swap between sources mid-playback if one is slow
- **Mini player** - Keep watching while browsing other content

### :iphone: Phone Remote

- **Scan a QR code** from the player to pair your phone
- **Full control** - Play, pause, seek, volume, subtitles, audio tracks
- **Browse from your phone** - Search and start content from the couch
- **Real-time sync** - Player and remote stay in lockstep
- **Binge mode** - One tap enables auto-skip intros and credits, auto-advance to the next episode, and persistent audio/subtitle tracks for the rest of the show. Intro and credit markers come from AniSkip and IntroDB, with outros also learned from your own watching when no public data exists.

### :shield: Privacy

- **No built-in tracking** - No signup, no analytics, no telemetry, no phone-home. The only external calls are TMDB (metadata) and the Rattin add-on registry.

---

## Install

### :desktop_computer: Linux

One command:

```bash
curl -fsSL "https://raw.githubusercontent.com/narzaut/rattin-public/main/install/install-native.sh" | bash
```

Downloads the AppImage, creates a desktop entry, and opens the firewall port for phone remote. Shows up in your app launcher as "Rattin".

To update, rerun the same command. To uninstall: add `--uninstall`.

You can also grab the AppImage directly from the [latest release](https://github.com/narzaut/rattin-public/releases/latest) and run it manually.

### :window: Windows

Download the installer or portable ZIP from the [latest release](https://github.com/narzaut/rattin-public/releases/latest):

- **Rattin-x64-Setup.exe** — installer with Start Menu and desktop shortcuts
- **Rattin-x64-Portable.zip** — extract and run, no install needed

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 9630) |

---

<details>
<summary><h2>Technical Details</h2></summary>

### Architecture

```
               +-------------------+
               |    Qt6 Window     |
               |  +-------------+  |
               |  |   libmpv    |  |
               |  |   (video)   |  |
               |  +-------------+  |
               |  | QML Controls|  |
               |  +-------------+  |
               |  | WebEngine   |  |
               |  | (React App) |  |
               |  +------+------+  |
               +---------+---------+
                         |
             -------------+-------------
                    Express API
             ---------------------------
                |           |           |
          +-----+-----+ +--+---+ +-----+------+
          | WebTorrent| |ffmpeg| |TMDB + Plugin|
          +-----------+ +------+ +-------------+
```

The React app runs inside Qt's WebEngineView. When a video plays, React sends the stream URL to mpv via QWebChannel. mpv renders the video in an OpenGL framebuffer object layered above the webview, with a QML controls overlay on top. Every format plays natively — no transcoding needed.

### How Streaming Works

| Scenario | Strategy |
|----------|----------|
| Complete file on disk | Direct HTTP range requests to mpv |
| Incomplete file | WebTorrent stream + piece prioritization to mpv |
| Seeking in incomplete file | Keyframe index + prioritize pieces at target |

### Native Shell

~500 lines of C++/QML:

| File | What it does |
|------|-------------|
| `shell/main.cpp` | Spawns Express server on port 9630, creates QML engine, wires up the mpv bridge |
| `shell/main.qml` | Layout: WebEngineView (z:2) + MpvObject (z:3) + QML controls (z:4) + QWebChannel |
| `shell/mpvobject.cpp` | QQuickFramebufferObject wrapping libmpv with OpenGL rendering |
| `shell/mpvbridge.cpp` | C++ slots callable from JS: play, pause, seek, volume, subtitle/audio track, stop |

### Phone Remote

The phone remote uses Server-Sent Events (SSE) for real-time communication:

1. PC creates an RC session and generates a QR code containing `http://<lan-ip>:9630/api/rc/auth?session=X&token=Y`
2. Phone scans QR, authenticates once, receives session cookies, and connects to the SSE stream
3. PC reports playback state every second; phone sends commands via POST
4. Commands route through the mpv bridge (play/pause/seek/volume/subtitles)

The app binds to `0.0.0.0` so phones on the same LAN can reach it. Firewall port 9630 is opened by the install script.

Non-local API access is now scoped to an authenticated paired remote session. Browsing and playback-control routes are available to the phone after pairing, while config and media-stream endpoints stay local-only on the desktop.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, React Router 7, Vite 6 |
| Backend | Express 5, Node.js 20+ |
| Torrents | WebTorrent |
| Native Shell | Qt6, libmpv, QWebChannel, CMake |
| Intro Detection | Chromaprint (fpcalc) + AniSkip API |
| Metadata | TMDB API |
| Remote | Server-Sent Events + QR (uqr) |

### Development

```bash
npm run dev     # Vite dev server with hot reload (port 5173)
npm start       # Backend (port 9630, proxied by Vite)
```

</details>

---

<p align="center">GPL-3.0 License</p>
