use crate::protocol::{BindCodeResponse, UnbindDaemonRequest};
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const CAPABILITIES: &[&str] = &["model.invoke", "agent.loop"];

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
            device_name: device_name.into(),
            daemon_id: None,
            active_model: default_active_model(),
            models: default_models(),
        }
    }

    pub fn require_daemon_id(&self) -> Result<&str> {
        self.daemon_id
            .as_deref()
            .filter(|daemon_id| !daemon_id.is_empty())
            .ok_or_else(|| anyhow!("brainx start is required before this command"))
    }

    pub fn active_model_config(&self) -> Result<&ClientModelConfig> {
        self.model_config(Some(&self.active_model))
    }

    pub fn model_config(&self, name: Option<&str>) -> Result<&ClientModelConfig> {
        let selected = name.filter(|value| !value.trim().is_empty()).unwrap_or(&self.active_model);
        self.models
            .iter()
            .find(|model| model.name == selected)
            .ok_or_else(|| anyhow!("model '{selected}' is not configured"))
    }

    pub fn add_model(&mut self, model: ClientModelConfig) -> Result<()> {
        validate_model(&model)?;
        if self.models.iter().any(|existing| existing.name == model.name) {
            return Err(anyhow!("model name already exists: {}", model.name));
        }
        self.models.push(model);
        Ok(())
    }

    pub fn remove_model(&mut self, name: &str) -> Result<()> {
        if name == self.active_model {
            return Err(anyhow!("cannot remove active model: {name}"));
        }
        let before = self.models.len();
        self.models.retain(|model| model.name != name);
        if self.models.len() == before {
            return Err(anyhow!("model not found: {name}"));
        }
        Ok(())
    }
}

fn validate_model(model: &ClientModelConfig) -> Result<()> {
    if model.name.trim().is_empty() {
        return Err(anyhow!("model name is required"));
    }
    if model.model.trim().is_empty() {
        return Err(anyhow!("model id is required"));
    }
    if model.base_url.trim().is_empty() {
        return Err(anyhow!("model baseUrl is required"));
    }
    if model.api_key.trim().is_empty() {
        return Err(anyhow!("model apiKey is required"));
    }
    if !matches!(model.protocol.as_str(), "openai" | "anthropic") {
        return Err(anyhow!("model protocol must be openai or anthropic"));
    }
    Ok(())
}

fn default_active_model() -> String {
    "nvidia-step".to_string()
}

fn default_models() -> Vec<ClientModelConfig> {
    vec![
        ClientModelConfig {
            name: default_active_model(),
            model: "stepfun-ai/step-3.7-flash".to_string(),
            base_url: "https://integrate.api.nvidia.com/v1".to_string(),
            api_key: "env:NVIDIA_API_KEY".to_string(),
            protocol: "openai".to_string(),
            context_window: Some(128000),
        },
        ClientModelConfig {
            name: "gpt-5.5".to_string(),
            model: "gpt-5.5".to_string(),
            base_url: "https://api.shangan9.cc.cd/v1".to_string(),
            api_key: "env:SHANGAN_API_KEY".to_string(),
            protocol: "openai".to_string(),
            context_window: None,
        },
    ]
}

pub fn default_workspace_path() -> Result<PathBuf> {
    Ok(default_state_dir()?.join("workspace"))
}

pub fn default_config_path() -> Result<PathBuf> {
    Ok(default_state_dir()?.join("config.json"))
}

pub fn default_state_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .context("HOME or USERPROFILE is required to locate brainx client config")?;
    Ok(PathBuf::from(home).join(".brainx"))
}

pub fn load_config(path: PathBuf) -> Result<ClientConfig> {
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read config {}", path.display()))?;
    serde_json::from_str(&content).with_context(|| format!("failed to parse config {}", path.display()))
}

pub fn load_or_create_config(path: PathBuf, server_url: &str, device_name: &str) -> Result<ClientConfig> {
    if path.exists() {
        return load_config(path);
    }
    let config = ClientConfig::new(server_url, device_name);
    save_config(path, &config)?;
    Ok(config)
}

pub fn save_config(path: PathBuf, config: &ClientConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("failed to create config directory {}", parent.display()))?;
    }
    fs::create_dir_all(default_workspace_path()?)
        .context("failed to create default brainx workspace")?;
    let content = serde_json::to_string_pretty(config)?;
    fs::write(&path, content).with_context(|| format!("failed to write config {}", path.display()))
}

pub async fn bind_code(config: &ClientConfig) -> Result<BindCodeResponse> {
    let client = Client::new();
    let daemon_id = config.require_daemon_id()?;
    let url = format!(
        "{}/api/v1/client-daemons/{daemon_id}/bind-code",
        config.server_url.trim_end_matches('/')
    );
    client
        .post(url)
        .json(&serde_json::json!({}))
        .send()
        .await
        .context("failed to send bind request")?
        .error_for_status()
        .context("server rejected bind request")?
        .json()
        .await
        .context("failed to decode bind code response")
}

pub async fn unbind(config: &ClientConfig, confirm: bool) -> Result<()> {
    if !confirm {
        return Err(anyhow!("unbind requires explicit confirmation"));
    }
    let client = Client::new();
    let daemon_id = config.require_daemon_id()?;
    let url = format!(
        "{}/api/v1/client-daemons/{daemon_id}/unbind",
        config.server_url.trim_end_matches('/')
    );
    client
        .post(url)
        .json(&UnbindDaemonRequest { confirm })
        .send()
        .await
        .context("failed to send unbind request")?
        .error_for_status()
        .context("server rejected unbind request")?;
    Ok(())
}
