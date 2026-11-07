<div align="center">

<img src="app-icon.png" alt="Remixer Tools" width="128" height="128" />

# Remixer Tools

**Download, separate, convert, and trim audio. All on your own machine.**

A cross-platform desktop toolkit for DJs, producers, and audio engineers.

[![Latest Release](https://img.shields.io/github/v/release/neondeveloperz/remixer-tools?style=for-the-badge&logo=github&color=8b5cf6)](https://github.com/neondeveloperz/remixer-tools/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/neondeveloperz/remixer-tools/total?style=for-the-badge&logo=download&color=22c55e)](https://github.com/neondeveloperz/remixer-tools/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-3b82f6?style=for-the-badge)](LICENSE)

![Windows](https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri_2-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)

[**📥 Download**](https://github.com/neondeveloperz/remixer-tools/releases/latest) •
[**✨ Features**](#-features) •
[**🚀 Build from Source**](#-building-from-source) •
[**📜 Changelog**](CHANGELOG.md) •
[**🐛 Report a Bug**](https://github.com/neondeveloperz/remixer-tools/issues)

</div>

---

> [!NOTE]
> 🔒 **100% local.** No cloud services, no uploads, no accounts. Your audio never leaves your computer.

## ✨ Features

| | Tool | What it does |
| :---: | --- | --- |
| 📥 | **Media Downloader** | Grab audio or video from YouTube, SoundCloud, Facebook, X/Twitter, and [every site yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md). |
| 🎚️ | **AI STEM Extractor** | Split songs into vocals, drums, bass, guitar, piano, and more with Demucs, MDX-Net, and RoFormer. |
| 🎛️ | **STEM Mixer** | Play stems together with per-track volume, mute, and solo, all in sync. |
| 🎹 | **MIDI Extractor** | Turn audio into `.mid` files with Basic Pitch and preview them in a piano roll. |
| ✂️ | **Audio Trimmer** | Cut out just the part you need, losslessly where possible. |
| 📚 | **Library & Model Store** | Manage everything you've made, and download or import AI models. |

### 📥 Media Downloader

- 🎵 **Lossless audio:** WAV, FLAC, ALAC, AIFF
- 🎧 **Compressed audio:** MP3, M4A, Opus, OGG, AAC (up to 320 kbps)
- 🎬 **Video:** MP4, MKV, WebM, MOV, up to 8K
- 🏷️ Metadata, chapters, and cover art embedded automatically
- 📃 **Playlists & Sets:** paste a YouTube playlist or SoundCloud set, untick the tracks you don't want (search, select matches, invert), confirm, and download them as a batch queue with configurable concurrency

### 🎚️ AI STEM Extractor

- 🧠 Models: **Demucs v4 (4/6-stem)**, **UVR MDX-Net**, **RoFormer** vocal models, or import your own PyTorch/ONNX model
- 💾 Output as FLAC, WAV, MP3, or OGG
- 🖱️ Drag-and-drop import, batch queue, and cancelable extraction

### 🎹 MIDI Extractor

- 🎼 Instrument presets (including **Piano Solo** with pedal-resonance cleanup)
- 🎯 Detection sensitivity: Clean / Balanced / High
- 🥁 Automatic BPM detection and beat-grid snapping
- 👀 Built-in piano roll preview, then drag the `.mid` into your DAW

### ✂️ Audio Trimmer

- 〰️ Pick a section on the waveform and preview it before saving
- ⚡ MP3, M4A, and OGG are cut **without re-encoding**; FLAC and WAV are cut **sample-accurately**
- 🛡️ The original file is never changed
- ➡️ **Send to STEM Extractor** to separate only that section, which is much faster than the whole song

### 🧰 Built-in Extras

- 🎼 **BPM & Key Detection:** tempo and key written into tags and filenames
- 🔄 **Auto-Update:** signed releases are installed in-app
- 🛠️ **Media Tools:** update yt-dlp and switch FFmpeg builds from Settings
- 🐍 **Zero-config AI environment:** a portable Python 3.11 setup is bootstrapped for you, with one-click **Repair**

## ⚡ Hardware Acceleration

| Hardware | Platform | Acceleration |
| --- | --- | :---: |
| NVIDIA GPU | Windows | ✅ CUDA |
| Apple Silicon | macOS | ✅ MPS |
| AMD / Intel GPU | Windows | ⚠️ CPU (works, expect several minutes per song) |

> [!TIP]
> Running out of GPU memory? Turn on **Low VRAM Memory Mode** in Settings.

## 📁 Where Files Go

Everything lives in one base folder (default: `Downloads/remixer-tools`), changeable in **Settings → Storage & Appearance**:

```text
remixer-tools/
├── library/   📥 downloads and trimmed files
├── stems/     🎚️ one folder per separated song
└── midi/      🎹 converted MIDI files
```

## ⚠️ First Launch

> [!WARNING]
> Remixer Tools is not code-signed yet, so your OS shows a warning the first time you open it.
> Only download the app from the official [GitHub Releases](https://github.com/neondeveloperz/remixer-tools/releases) page.

- 🪟 **Windows (SmartScreen):** click **More info → Run anyway**
- 🍎 **macOS (Gatekeeper):** right-click the app, choose **Open**, then confirm

On first launch the app downloads `yt-dlp`, `ffmpeg`/`ffprobe`, and the Python environment for the AI tools (a few GB). Give it a few minutes.

## 🚀 Building from Source

<details>
<summary><b>📋 Prerequisites</b></summary>

<br />

- [Bun](https://bun.sh/) (or [Node.js](https://nodejs.org/))
- [Rust](https://www.rust-lang.org/tools/install)
- Platform build tools:
  - **macOS:** `xcode-select --install`
  - **Linux:** `build-essential` + the [Tauri Linux dependencies](https://tauri.app/start/prerequisites/)
  - **Windows:** Visual Studio C++ Build Tools

</details>

```bash
git clone https://github.com/neondeveloperz/remixer-tools.git
cd remixer-tools
bun install
bun tauri dev
```

| Command | Description |
| --- | --- |
| `bun tauri dev` | 🔥 Run the app in development mode |
| `bun tauri build` | 📦 Build a production installer |
| `bun run typecheck` | 🔍 TypeScript check |
| `bun run lint` | 🧹 ESLint |

## 🛠 Tech Stack

| Layer | Technologies |
| --- | --- |
| 🖥️ **Frontend** | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| ⚙️ **Backend** | Rust, Tauri 2 |
| 🎧 **Audio / AI** | [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/), [audio-separator](https://github.com/nomadkaraoke/python-audio-separator), [Basic Pitch](https://github.com/spotify/basic-pitch), PyTorch |

## 🐛 Reporting Bugs

Open an [issue](https://github.com/neondeveloperz/remixer-tools/issues) and attach `Remixer Tools.log`.
In the app, go to **Get Help → Open Log Folder** to find it.

## 🤝 Contributing

Contributions are welcome! Open an issue for ideas or bugs, or send a pull request:

1. 🍴 Fork the project
2. 🌿 Create a feature branch: `git checkout -b feature/amazing-feature`
3. 💬 Commit with [Conventional Commits](https://www.conventionalcommits.org/) + Gitmoji, e.g. `✨ feat(downloader): ...`
4. 🚀 Push the branch and open a pull request

## 📄 License

Released under the [MIT License](LICENSE).

<div align="center">

<br />

**Made with 🎧 for DJs, producers, and remixers.**

⭐ If Remixer Tools helps you, consider giving the repo a star!

</div>
