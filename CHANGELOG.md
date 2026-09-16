# Changelog

## 🚀 What's New in v0.4.2
- **Bug Fixes:**
  - Fixed a TypeScript compilation error that broke CI pipelines due to an unused `openPath` import in `library-dashboard.tsx`.

## 🚀 What's New in v0.4.1
- **BPM & Key Detection:** 
  - Automatically analyzes imported and downloaded audio files using `librosa` (in an isolated Python environment).
  - Calculates the track's tempo (BPM) and musical key (via Krumhansl-Schmuckler profiles) and appends this data to the filename seamlessly.
- **App Sidebar Grouping:**
  - Redesigned the navigation sidebar to group menus logically into **"Studio Tools"** and **"Library & Assets"** for better UX.
- **Backend Architecture Refactor:**
  - Split the monolithic `lib.rs` file into modular components (`models.rs`, `settings.rs`, `storage.rs`, `downloader.rs`, `extractor.rs`, `ai_models.rs`, and `analyzer.rs`), improving maintainability and development speed.
## 🚀 What's New in v0.4.0

This release introduces the all-new **History & Library Dashboard** for centralized media management, automatic partitioned file storage, one-click stem group playback in the DAW STEM Mixer Studio, and seamless integration between YouTube downloads and AI stem extraction!

### ✨ Features & Enhancements
- **History & Library Dashboard:**
  - **Partitioned Storage Architecture:** All media files are cleanly segregated into dedicated subdirectories (`~/downloads/remixer-tools/library` for downloaded videos/audio and `~/downloads/remixer-tools/extractor` for separated stems), while retaining the ability to customize the base directory in Settings.
  - **Song-Grouped Stem Collections:** Automatically organizes separated stems (Vocals, Drums, Bass, Other, etc.) by parent song title with full storage size metrics and modification timestamps.
  - **1-Click "Play in DAW Mixer":** Load all stems of any separated song directly into the STEM Mixer Studio in sample-accurate Web Audio synchronization with a single click.
  - **Real-Time Interactive Playback Controls:** Individual songs and stems feature live Play / Pause / Resume toggles that reflect player status without reloading audio buffers from scratch.
  - **Batch & Stem Operations:** Delete individual stem files or delete entire stem groups at once with confirmation prompts, and open directory locations directly in File Explorer.
  - **Multi-Key YouTube Metadata Indexing:** Matches local media against downloaded history to display video titles and YouTube thumbnails reliably across files.
  - **Real-Time Event Refresh & Smart Polling:** Automatically refreshes the library view when downloads or extractions complete in the background.
  - **Global Media Filters & Search:** Instant search by song title, artist, or stem type, plus filtering by Media Type (Audio / Video) and sorting by Date, Name, and File Size.
  - **Direct "Separate STEMs" Pipeline:** Send any downloaded song directly to the STEM Extractor with the input path pre-filled.

---
See the assets below to download this version.
The Windows portable executable requires the Microsoft Edge WebView2 Runtime.

**Full Changelog**: https://github.com/neondeveloperz/remixer-tools/compare/v0.3.1...v0.4.0

## 🚀 What's New in v0.3.1

This update brings **massive RAM & memory optimizations** to the STEM Extractor engine, introduces the dedicated **STEM Mixer Studio** powered by the Web Audio API for drift-free multi-track audio playback, and provides seamless post-separation workflow integration!

### ✨ Features & Enhancements
- **STEM Extractor RAM & Memory Optimization:**
  - **Memory Saver Mode:** Added a one-click Memory Saver toggle (enabled by default) that optimizes segment sizes and overrides model configs to prevent memory spikes.
  - **DirectML Acceleration & Memory Patch:** Automatically applies DirectML patches on Windows to eliminate memory leaks and crashes on AMD, Intel, and NVIDIA GPUs.
  - **Demucs RAM Spikes Fixed:** Prevented Demucs shift-multiplication and aligned segment duration to seconds rather than FFT frames, cutting Demucs RAM usage by up to 75%.
  - **PyTorch Memory Fragmentation Guard:** Configured `expandable_segments:True` and enforced batch size 1 across all architectures.
  - **Thread Explosion Prevention:** Restricted CPU thread pools across BLAS/MKL/OpenMP runtimes to prevent CPU exhaustion on multi-core systems.
- **STEM Mixer Studio & High-Precision Audio Engine:**
  - **Dedicated Studio Page:** Separated the STEM mixer into its own full-page workspace (`STEM Mixer Studio`) accessible directly from the sidebar.
  - **Auto-Open on Extraction:** Seamlessly navigates to the STEM Mixer Studio with newly separated stems loaded automatically once extraction finishes.
  - **Web Audio Synchronization Engine:** Hardware-clock synchronized multi-track playback ensuring vocal, drums, bass, and instrument stems stay in lockstep without audio drift.
  - **DAW-Style Track Mixer:** Professional track channel strips featuring real-time interactive waveforms, volume faders, dB meters, pan controls, and individual Solo / Mute states.
  - **Manual Stem Import:** Directly import multiple external stem audio files into the studio at any time.
- **Sleek Bottom STEM Player:** Polished floating player with a dedicated Master Volume slider, Spotify-style hover progress bar, and dead-centered transport controls.

### 🛠 Fixes & Stability
- **Audio Desynchronization & Solo/Mute Bugs:** Replaced fragmented HTML5 audio elements with unified Web Audio API nodes, fixing playback sync issues and solo functionality across heterogeneous models.
- **Title Tag Resilient Stem Parsing:** Robust regex detection that cleanly handles song titles with parentheses (e.g. `(Live)`, `(Remix)`, `(Official Audio)`) without key or name collisions.
- **Drag-and-Drop Reliability:** Improved audio file drag-and-drop feedback in the STEM Extractor.

---
See the assets below to download this version.
The Windows portable executable requires the Microsoft Edge WebView2 Runtime.

**Full Changelog**: https://github.com/neondeveloperz/remixer-tools/compare/v0.3.0...v0.3.1

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
