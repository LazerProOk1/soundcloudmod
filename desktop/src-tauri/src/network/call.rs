/// Call feature stub — call-client crate removed.
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CallStatus {
    Disabled,
}

pub struct CallState {
    _config_path: PathBuf,
    status: Mutex<CallStatus>,
}

impl CallState {
    pub fn init(app_data_dir: PathBuf, _runtime: tokio::runtime::Handle) -> Arc<Self> {
        Arc::new(Self {
            _config_path: app_data_dir.join("call_enabled.json"),
            status: Mutex::new(CallStatus::Disabled),
        })
    }
}

pub fn maybe_autostart(_app: &AppHandle, _state: Arc<CallState>) {
    // call feature disabled
}

pub fn manage_state(app: &AppHandle, state: Arc<CallState>) {
    app.manage(state);
}

#[tauri::command]
pub async fn call_set_enabled(
    _enabled: bool,
    _app: AppHandle,
    state: State<'_, Arc<CallState>>,
) -> Result<CallStatus, String> {
    Ok(state.inner().status.lock().await.clone())
}

#[tauri::command]
pub fn call_is_enabled(_state: State<'_, Arc<CallState>>) -> bool {
    false
}

#[tauri::command]
pub async fn call_status(state: State<'_, Arc<CallState>>) -> Result<CallStatus, String> {
    Ok(state.inner().status.lock().await.clone())
}
