use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub item: String,
    pub progress: u8,
}

#[derive(Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub download_dir: String,
    pub filename_template: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StorageDirs {
    pub base_dir: String,
    pub library_dir: String,
    pub extractor_dir: String,
    pub stems_dir: String,
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
