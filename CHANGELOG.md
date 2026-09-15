# Changelog

## 🚀 What's New in v0.3.0

This major update introduces the **AI Model Store**, a brand new **Global Stem Player UI**, theme customization (Light & Dark modes), and extensive cross-platform performance enhancements for macOS and Windows!

### ✨ Features & Enhancements
- **AI Model Store:** A built-in marketplace and manager for AI separation models. Easily browse, search, and download state-of-the-art models (Demucs, RoFormer, MDX-Net, VR Arch) with detailed descriptions, architecture tags, and download sizes directly inside the app.
- **Global Stem Player:** Redesigned the music player into a sleek, persistent bottom bar (Spotify-style) accessible across all pages with multi-track volume and mute/solo controls.
- **Auto-Play & Media Keys:** Loading or playing tracks now auto-starts playback smoothly, with support for native keyboard media keys and headset controls (Play/Pause).
- **Theme Switching (Light / Dark Mode):** Added an intuitive theme toggle in the header and Settings page, featuring a refined default light theme alongside the sleek dark mode.
- **Drag and Drop (STEM Extractor):** Quickly load audio files (MP3, WAV, FLAC, M4A, OGG) by dragging and dropping them directly into the STEM Extractor workspace.
- **Apple Silicon & Hardware Acceleration:** Automated PyTorch MPS and CoreML environment configurations for optimized AI inference on Apple Silicon (M-series chips).
- **Automated macOS Tooling:** Integrated automatic download and configuration of `ffprobe` alongside `ffmpeg` on macOS during initial setup.
- **Window Resizing & Tab State Preservation:** Enabled window resizing with responsive layout adaptation, and preserved screen states when switching between sidebar tabs.

### 🛠 Fixes & Stability
- **Audio Overlap Bug:** Fixed an issue where audio buffers could overlap when rapidly switching between tracks in the player.
- **Seek Bar Smoothing:** Implemented drag commit logic on the progress slider to eliminate stuttering during seeking.
- **Select Dropdown Positioning:** Corrected dropdown menu positioning across the app so options open cleanly below triggers without overlaying inputs.
- **Resilient File Downloader:** Enhanced downloads with explicit User-Agent headers, HTTP status verification, and fallback progress calculations for unknown content lengths.
- **Unix PATH Resolution:** Ensured app binaries and FFmpeg locations are correctly prepended to PATH on macOS and Linux systems.
- **Layout & Scroll Overlap:** Prevented the bottom player bar from clipping main content or navigation views.

---
See the assets below to download this version.
The Windows portable executable requires the Microsoft Edge WebView2 Runtime.

**Full Changelog**: https://github.com/neondeveloperz/remixer-tools/compare/v0.2.1...v0.3.0

## 🚀 What's New in v0.2.1

This minor update focuses on improving background process execution on Windows and enhancing setup transparency for a cleaner user experience!

### ✨ Features & Enhancements
- **Detailed Setup Logs:** The initial setup process now parses the `yt-dlp` update output to emit more detailed and informative logs, keeping you better informed about the installation progress.

### 🛠 Fixes & Stability
- **Windows Background Tasks:** Fixed an annoying issue on Windows where command prompt (CMD) windows would visibly pop up when the application was executing background tasks. These processes now run completely hidden.

---
See the assets below to download this version.
The Windows portable executable requires the Microsoft Edge WebView2 Runtime.

**Full Changelog**: https://github.com/neondeveloperz/remixer-tools/compare/v0.2.0...v0.2.1

## 🚀 What's New in v0.2.0

This update brings major quality-of-life improvements, cross-platform stability fixes, and a smoother user experience!

### ✨ Features & Enhancements
- **Auto-Download FFmpeg (macOS/Linux):** The application now automatically fetches the correct static `ffmpeg` binary for macOS (Intel/Apple Silicon) and Linux on the first run. No more manual Homebrew installations required!
- **Show Folders Button:** Added a handy "Show Folders" button in the Downloader UI to quickly open your download directory.
- **Quick Access Folders:** Completed downloads now display a folder icon alongside the remove button for instant access.
- **UI Lock During Setup:** The sidebar navigation is now visually dimmed and disabled while AI models or dependencies are being installed in the STEM Extractor to prevent accidental interruptions.
- **Improved Downloader UI:** The Pause button is now strictly hidden once a download completes or fails.

### 🛠 Fixes & Stability
- **Linux & macOS CI Builds:** Resolved GitHub Actions build failures by providing the correct `yt-dlp` binaries for Linux (`x86_64-unknown-linux-gnu`) and macOS Apple Silicon (`aarch64-apple-darwin`).
- **macOS PATH Corruption Fix:** Fixed a critical bug where the Windows path separator (`;`) was injected into the macOS/Linux PATH, causing a `FileNotFoundError` during extraction.
- **GitHub API Rate Limit (403):** The `yt-dlp` auto-updater now gracefully handles HTTP 403 (Rate Limit Exceeded) errors by skipping the update quietly instead of throwing errors in the UI.
- **Project Metadata:** Updated the application name and improved descriptions globally to `remixer-tools`.

---
See the assets below to download this version.
The Windows portable executable requires the Microsoft Edge WebView2 Runtime.

**Full Changelog**: https://github.com/neondeveloperz/remixer-tools/compare/v0.1.0...v0.2.0

## 🚀 What's New in v0.1.0

Welcome to the initial release of Remixer Tools! This version lays the foundation for a powerful, local-first audio workflow.

### ✨ Features
- **Media Downloader:** Built-in downloader powered by `yt-dlp` to easily fetch media from supported platforms.
- **STEM Extractor:** State-of-the-art AI audio separation running entirely locally with no cloud reliance.
- **Cross-Platform Core:** Fully supports macOS, Windows, and Linux with automated standalone Python environment bootstrapping.
- **Hardware Acceleration:** Configurable GPU support to dramatically speed up stem extraction times.
- **Advanced Audio Options:** Selectable output formats (WAV, FLAC, MP3), `htdemucs_6s` model support, and tunable overlap/segment sizes.
- **App Management:** Integrated settings panel with an automatic update checker.

### 🛠 Fixes & Stability
- **macOS Compatibility:** Resolved a critical PyTorch compatibility issue on macOS by intelligently disabling the `--use_autocast` flag.

---
See the assets below to download this version.
