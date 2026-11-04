use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub item: String,
    pub progress: u8,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct AppSettings {
    pub download_dir: String,
    pub filename_template: Option<String>,
    // Downloader defaults
    pub default_format: Option<String>,
    pub default_quality: Option<String>,
    pub max_concurrent_downloads: Option<u32>,
    pub auto_analyze_audio: Option<bool>,
    // STEM Extractor defaults
    pub default_stem_model: Option<String>,
    pub default_stem_format: Option<String>,
    pub default_overlap: Option<String>,
    pub enable_gpu_acceleration: Option<bool>,
    pub low_memory_mode: Option<bool>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            filename_template: Some("%(title)s.%(ext)s".to_string()),
            default_format: Some("mp3_meta".to_string()),
            default_quality: Some("best".to_string()),
            max_concurrent_downloads: Some(2),
            auto_analyze_audio: Some(true),
            default_stem_model: Some("htdemucs.yaml".to_string()),
            default_stem_format: Some("FLAC".to_string()),
            default_overlap: Some("4".to_string()),
            enable_gpu_acceleration: Some(true),
            low_memory_mode: Some(true),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StorageDirs {
    pub base_dir: String,
    pub library_dir: String,
    pub extractor_dir: String,
    pub stems_dir: String,
    pub midi_dir: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StorageFileItem {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_time: u64,
    pub category: String, // "download" | "stem"
    pub extension: String,
    pub stem_type: Option<String>,
    pub parent_group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StemExtractResult {
    pub success: bool,
    pub input_file: String,
    pub output_files: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledModel {
    pub filename: String,
    pub size_bytes: u64,
    pub modified_time: u64,
    pub is_custom: bool,
    pub custom_name: Option<String>,
    pub custom_type: Option<String>,
    pub custom_stems: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CustomModelMetadata {
    pub filename: String,
    pub friendly_name: String,
    pub model_type: String,
    pub stems: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelDownloadProgress {
    pub filename: String,
    pub log: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelDownloadDone {
    pub filename: String,
    pub success: bool,
    pub error: Option<String>,
}
