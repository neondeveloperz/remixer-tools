# Remixer Tools

**Remixer Tools** is a powerful, cross-platform desktop application designed for DJs, producers, and audio engineers. It seamlessly combines high-quality audio acquisition with state-of-the-art AI stem separation into a unified, easy-to-use interface.

Built with **Tauri**, **React**, and **TypeScript**, Remixer Tools runs entirely locally on your machine, leveraging hardware acceleration to process audio quickly and securely without relying on cloud services.

## ✨ Features

- **Media Downloader**
  - Integrated `yt-dlp` for extracting high-quality audio directly from supported URLs.
  - Automatic conversion to professional formats (WAV, FLAC, MP3) via FFmpeg.
- **AI STEM Extractor**
  - Powered by industry-leading models including **Demucs v4 (6-stems)**, **UVR MDX-Net**, and **Kim Vocal 2 (RoFormer)**.
  - Isolate Vocals, Drums, Bass, Guitar, Piano, and other elements with unprecedented clarity.
  - Selectable output formats (FLAC, WAV, MP3, OGG).
- **Hardware Acceleration**
  - **macOS:** Automatic Metal Performance Shaders (MPS) and CoreML utilization for Apple Silicon.
  - **Windows:** Support for DirectML (AMD/Intel) and CUDA (NVIDIA) to drastically reduce processing time.
- **Zero-Configuration Environment**
  - No need to manually install Python or manage complex machine learning libraries.
  - The application automatically bootstraps a portable, standalone Python 3.11 environment in the background to safely manage its AI dependencies (`torch`, `onnxruntime`, `audio-separator`).

## 🚀 Getting Started

### Prerequisites

To build and run the application from source, you will need:
- [Node.js](https://nodejs.org/) & [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/tools/install)
- macOS/Linux build tools (`xcode-select --install` or `build-essential`)
- Windows build tools (Visual Studio C++ Build Tools)

### Installation & Development

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/remixer-tools.git
   cd remixer-tools
   ```

2. Install frontend dependencies:
   ```bash
   bun install
   ```

3. Start the development server with Tauri:
   ```bash
   bun tauri dev
   ```

*Note: On first run, the application will automatically download the necessary dependencies (`yt-dlp`, `ffmpeg`, and the isolated Python environment). Please allow a few minutes for this initial setup to complete.*

## 🛠 Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend:** Rust (Tauri), standard UNIX/Windows process interop
- **AI / Audio:** [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/), [audio-separator](https://github.com/nomadkaraoke/python-audio-separator), PyTorch

## 🤝 Contributing

Contributions are welcome! If you have suggestions for new features or find a bug, please open an issue or submit a pull request. 

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
