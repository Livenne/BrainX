use crate::protocol::{
    AuthRequest, AuthResponse, BindCodeResponse, ClientDaemonResponse, CreateBindCodeRequest, UnbindDaemonRequest,
    SyncWorkspaceItem, SyncWorkspacesRequest,
};
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const CAPABILITIES: &[&str] = &[
    "model.invoke",
    "tool.invoke",
    "get_env",
    "read_files",
    "search_workspace",
    "web_search",
    "apply_patch",
    "write_file",
    "run_command",
    "background_start",
    "background_read",
    "background_stop",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientWorkspaceConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientModelConfig {
    pub name: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub protocol: String,
    pub context_window: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub server_url: String,
    pub username: Option<String>,
    pub session_token: Option<String>,
    #[serde(default = "default_workspace_id")]
    pub active_workspace_id: String,
    #[serde(default = "default_workspaces")]
    pub workspaces: Vec<ClientWorkspaceConfig>,
    pub device_name: String,
    pub daemon_id: Option<String>,
    #[serde(default = "default_active_model")]
    pub active_model: String,
    #[serde(default = "default_models")]
    pub models: Vec<ClientModelConfig>,
}

impl ClientConfig {
    pub fn new(server_url: impl Into<String>, device_name: impl Into<String>) -> Self {
        Self {
            server_url: server_url.into(),
            username: None,
            session_token: None,
            active_workspace_id: "w_core".to_string(),
            workspaces: default_workspaces(),
            device_name: device_name.into(),
            daemon_id: None,
            active_model: default_active_model(),
            models: default_models(),
        }
    }

    pub fn require_session_token(&self) -> Result<&str> {
        self.session_token
            .as_deref()
            .filter(|token| !token.is_empty())
            .ok_or_else(|| anyhow!("brainx login is required before this command"))
    }

    pub fn require_daemon_id(&self) -> Result<&str> {
        self.daemon_id
            .as_deref()
            .filter(|daemon_id| !daemon_id.is_empty())
            .ok_or_else(|| anyhow!("client is not bound; run brainx bind first"))
    }

    pub fn active_workspace(&self) -> Result<&ClientWorkspaceConfig> {
        self.workspaces
            .iter()
            .find(|workspace| workspace.id == self.active_workspace_id)
            .ok_or_else(|| anyhow!("active workspace '{}' is not configured", self.active_workspace_id))
    }

    pub fn default_workspace(&self) -> Option<&ClientWorkspaceConfig> {
        self.workspaces.iter().find(|workspace| workspace.default)
    }

    pub fn active_model_config(&self) -> Result<&ClientModelConfig> {
        self.models
            .iter()
            .find(|model| model.name == self.active_model)
            .ok_or_else(|| anyhow!("active model '{}' is not configured", self.active_model))
    }

    pub fn model_config(&self, name: Option<&str>) -> Result<&ClientModelConfig> {
        let selected = name.filter(|value| !value.trim().is_empty()).unwrap_or(&self.active_model);
        self.models
            .iter()
            .find(|model| model.name == selected)
            .ok_or_else(|| anyhow!("model '{selected}' is not configured"))
    }

    pub fn add_workspace(&mut self, id: impl Into<String>, name: impl Into<String>, path: impl Into<String>) -> Result<()> {
        let id = id.into();
        if self.workspaces.iter().any(|workspace| workspace.id == id) {
            return Err(anyhow!("workspace id already exists: {id}"));
        }
        self.workspaces.push(ClientWorkspaceConfig {
            id,
            name: name.into(),
            path: path.into(),
            default: false,
        });
        Ok(())
    }

    pub fn remove_workspace(&mut self, id: &str, confirm: bool) -> Result<()> {
        if !confirm {
            return Err(anyhow!("workspace remove requires explicit confirmation"));
        }
        let workspace = self
            .workspaces
            .iter()
            .find(|workspace| workspace.id == id)
            .ok_or_else(|| anyhow!("workspace not found: {id}"))?;
        if workspace.default {
            return Err(anyhow!("default workspace cannot be removed"));
        }
        self.workspaces.retain(|workspace| workspace.id != id);
        if self.active_workspace_id == id {
            self.active_workspace_id = self
                .default_workspace()
                .or_else(|| self.workspaces.first())
                .map(|workspace| workspace.id.clone())
                .unwrap_or_else(|| "w_core".to_string());
        }
        Ok(())
    }
}

fn default_active_model() -> String {
    "nvidia-step".to_string()
}

fn default_workspace_id() -> String {
    "w_core".to_string()
}

fn default_workspaces() -> Vec<ClientWorkspaceConfig> {
    vec![ClientWorkspaceConfig {
        id: "w_core".to_string(),
        name: "Brainx Local".to_string(),
        path: default_workspace_path(),
        default: true,
    }]
}

fn default_models() -> Vec<ClientModelConfig> {
    vec![ClientModelConfig {
        name: default_active_model(),
        model: "stepfun-ai/step-3.7-flash".to_string(),
        base_url: "https://integrate.api.nvidia.com/v1".to_string(),
        api_key: "env:NVIDIA_API_KEY".to_string(),
        protocol: "openai".to_string(),
        context_window: Some(128000),
    }]
}

fn default_workspace_path() -> String {
    std::env::var("HOME")
        .map(|home| PathBuf::from(home).join(".brainx").join("workspace").to_string_lossy().to_string())
        .unwrap_or_else(|_| ".brainx/workspace".to_string())
}

pub fn default_config_path() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME is required to locate brainx client config")?;
    Ok(PathBuf::from(home).join(".brainx").join("config.json"))
}

pub fn load_config(path: PathBuf) -> Result<ClientConfig> {
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read config {}", path.display()))?;
    serde_json::from_str(&content).with_context(|| format!("failed to parse config {}", path.display()))
}

pub fn save_config(path: PathBuf, config: &ClientConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("failed to create config directory {}", parent.display()))?;
    }
    for workspace in &config.workspaces {
        fs::create_dir_all(&workspace.path)
            .with_context(|| format!("failed to create workspace directory {}", workspace.path))?;
    }
    let content = serde_json::to_string_pretty(config)?;
    fs::write(&path, content).with_context(|| format!("failed to write config {}", path.display()))
}

pub async fn login(server_url: &str, username: &str, password: &str) -> Result<ClientConfig> {
    let client = Client::new();
    let url = format!("{}/api/v1/auth/login", server_url.trim_end_matches('/'));
    let response: AuthResponse = client
        .post(url)
        .json(&AuthRequest { username, password })
        .send()
        .await
        .context("failed to send login request")?
        .error_for_status()
        .context("server rejected login")?
        .json()
        .await
        .context("failed to decode login response")?;

    let mut config = ClientConfig::new(server_url, "local-dev");
    config.username = Some(response.user.username);
    config.session_token = Some(response.token);
    Ok(config)
}

pub async fn logout(config: &ClientConfig) -> Result<ClientConfig> {
    let client = Client::new();
    let token = config.require_session_token()?;
    let url = format!("{}/api/v1/auth/logout", config.server_url.trim_end_matches('/'));
    client
        .post(url)
        .bearer_auth(token)
        .send()
        .await
        .context("failed to send logout request")?
        .error_for_status()
        .context("server rejected logout")?;

    let mut cleared = config.clone();
    cleared.username = None;
    cleared.session_token = None;
    cleared.daemon_id = None;
    Ok(cleared)
}

pub async fn bind_code(config: &ClientConfig, password: &str) -> Result<BindCodeResponse> {
    let client = Client::new();
    let token = config.require_session_token()?;
    let url = format!("{}/api/v1/client-daemons/bind-codes", config.server_url.trim_end_matches('/'));
    client
        .post(url)
        .bearer_auth(token)
        .json(&CreateBindCodeRequest {
            workspace_id: &config.active_workspace_id,
            device_name: &config.device_name,
            password,
            capabilities: CAPABILITIES.to_vec(),
        })
        .send()
        .await
        .context("failed to send bind request")?
        .error_for_status()
        .context("server rejected bind request")?
        .json()
        .await
        .context("failed to decode bind code response")
}

pub async fn sync_bound_daemon(config: &ClientConfig) -> Result<ClientConfig> {
    let client = Client::new();
    let token = config.require_session_token()?;
    let url = format!("{}/api/v1/client-daemons", config.server_url.trim_end_matches('/'));
    let daemons: Vec<ClientDaemonResponse> = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .context("failed to load bound clients")?
        .error_for_status()
        .context("server rejected bound client lookup")?
        .json()
        .await
        .context("failed to decode bound clients")?;

    let matches: Vec<_> = daemons
        .into_iter()
        .filter(|daemon| daemon.workspace_id == config.active_workspace_id)
        .filter(|daemon| daemon.device_name == config.device_name)
        .filter(|daemon| daemon.status == "active")
        .collect();

    if matches.is_empty() {
        return Err(anyhow!(
            "No active bound client found for workspace '{}' and device '{}'. Run brainx bind and complete it in the browser first.",
            config.active_workspace_id,
            config.device_name
        ));
    }
    if matches.len() > 1 {
        return Err(anyhow!(
            "Multiple active bound clients found for workspace '{}' and device '{}'. Unbind duplicate devices before starting.",
            config.active_workspace_id,
            config.device_name
        ));
    }

    let mut synced = config.clone();
    synced.daemon_id = Some(matches[0].id.clone());
    sync_workspaces(&synced).await?;
    Ok(synced)
}

pub async fn sync_workspaces(config: &ClientConfig) -> Result<()> {
    let client = Client::new();
    let token = config.require_session_token()?;
    let daemon_id = config.require_daemon_id()?;
    let url = format!(
        "{}/api/v1/client-daemons/{daemon_id}/workspaces",
        config.server_url.trim_end_matches('/')
    );
    let workspaces = config
        .workspaces
        .iter()
        .map(|workspace| SyncWorkspaceItem {
            id: &workspace.id,
            name: &workspace.name,
            path: &workspace.path,
            default_workspace: workspace.default,
        })
        .collect();
    client
        .put(url)
        .bearer_auth(token)
        .json(&SyncWorkspacesRequest { workspaces })
        .send()
        .await
        .context("failed to sync workspaces")?
        .error_for_status()
        .context("server rejected workspace sync")?;
    Ok(())
}

pub async fn unbind(config: &ClientConfig, confirm: bool) -> Result<()> {
    if !confirm {
        return Err(anyhow!("unbind requires explicit confirmation"));
    }
    let client = Client::new();
    let token = config.require_session_token()?;
    let daemon_id = config.require_daemon_id()?;
    let url = format!(
        "{}/api/v1/client-daemons/{daemon_id}/unbind",
        config.server_url.trim_end_matches('/')
    );
    client
        .post(url)
        .bearer_auth(token)
        .json(&UnbindDaemonRequest { confirm })
        .send()
        .await
        .context("failed to send unbind request")?
        .error_for_status()
        .context("server rejected unbind request")?;
    Ok(())
}
