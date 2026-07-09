use crate::protocol::{BindCodeResponse, UnbindDaemonRequest};
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

pub const CAPABILITIES: &[&str] = &["model.invoke", "agent.loop"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientProviderConfig {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchConfig {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    #[serde(default = "default_web_search_timeout_seconds")]
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LegacyClientModelConfig {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub protocol: String,
    #[allow(dead_code)]
    pub model: String,
    #[allow(dead_code)]
    pub context_window: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub server_url: String,
    pub device_name: String,
    #[serde(default = "new_installation_id")]
    pub installation_id: String,
    pub daemon_id: Option<String>,
    #[serde(default)]
    pub client_token: Option<String>,
    #[serde(default = "default_providers")]
    pub providers: Vec<ClientProviderConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_search: Option<WebSearchConfig>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub model_context_windows: HashMap<String, u32>,
}

impl<'de> Deserialize<'de> for ClientConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RawClientConfig {
            server_url: String,
            device_name: String,
            #[serde(default = "new_installation_id")]
            installation_id: String,
            daemon_id: Option<String>,
            #[serde(default)]
            client_token: Option<String>,
            #[serde(default)]
            providers: Vec<ClientProviderConfig>,
            #[serde(default)]
            models: Vec<LegacyClientModelConfig>,
            #[serde(default)]
            web_search: Option<WebSearchConfig>,
            #[serde(default)]
            model_context_windows: HashMap<String, u32>,
        }

        let raw = RawClientConfig::deserialize(deserializer)?;
        let providers = if raw.providers.is_empty() && !raw.models.is_empty() {
            legacy_models_to_providers(raw.models)
        } else if raw.providers.is_empty() {
            default_providers()
        } else {
            raw.providers
        };
        Ok(Self {
            server_url: raw.server_url,
            device_name: raw.device_name,
            installation_id: raw.installation_id,
            daemon_id: raw.daemon_id,
            client_token: raw.client_token,
            providers,
            web_search: raw.web_search,
            model_context_windows: raw.model_context_windows,
        })
    }
}

impl ClientConfig {
    pub fn new(server_url: impl Into<String>, device_name: impl Into<String>) -> Self {
        Self {
            server_url: server_url.into(),
            device_name: device_name.into(),
            installation_id: new_installation_id(),
            daemon_id: None,
            client_token: None,
            providers: default_providers(),
            web_search: None,
            model_context_windows: HashMap::new(),
        }
    }

    pub fn require_daemon_id(&self) -> Result<&str> {
        self.daemon_id
            .as_deref()
            .filter(|daemon_id| !daemon_id.is_empty())
            .ok_or_else(|| anyhow!("brainx start is required before this command"))
    }

    pub fn require_client_token(&self) -> Result<&str> {
        self.client_token
            .as_deref()
            .filter(|token| !token.is_empty())
            .ok_or_else(|| anyhow!("brainx start is required before this command"))
    }

    pub fn provider_config(&self, name: &str) -> Result<&ClientProviderConfig> {
        let selected = name.trim();
        if selected.is_empty() {
            return Err(anyhow!("provider name is required"));
        }
        self.providers
            .iter()
            .find(|provider| provider.name == selected)
            .ok_or_else(|| anyhow!("provider '{selected}' is not configured"))
    }

    pub fn add_provider(&mut self, provider: ClientProviderConfig) -> Result<()> {
        validate_provider(&provider)?;
        if self.providers.iter().any(|existing| existing.name == provider.name) {
            return Err(anyhow!("provider name already exists: {}", provider.name));
        }
        self.providers.push(provider);
        Ok(())
    }

    pub fn remove_provider(&mut self, name: &str) -> Result<()> {
        let before = self.providers.len();
        self.providers.retain(|provider| provider.name != name);
        if self.providers.len() == before {
            return Err(anyhow!("provider not found: {name}"));
        }
        Ok(())
    }
}

fn default_web_search_timeout_seconds() -> u64 {
    20
}

fn validate_provider(provider: &ClientProviderConfig) -> Result<()> {
    if provider.name.trim().is_empty() {
        return Err(anyhow!("provider name is required"));
    }
    if provider.name.contains(':') {
        return Err(anyhow!("provider name must not contain ':'"));
    }
    if provider.base_url.trim().is_empty() {
        return Err(anyhow!("provider baseUrl is required"));
    }
    if provider.api_key.trim().is_empty() {
        return Err(anyhow!("provider apiKey is required"));
    }
    if !matches!(provider.protocol.as_str(), "openai" | "anthropic") {
        return Err(anyhow!("provider protocol must be openai or anthropic"));
    }
    Ok(())
}

fn new_installation_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("install-{timestamp}-{}", std::process::id())
}

fn default_providers() -> Vec<ClientProviderConfig> {
    vec![
        ClientProviderConfig {
            name: "primary".to_string(),
            base_url: "https://api.primary-model.example/v1".to_string(),
            api_key: "env:BRAINX_MODEL_API_KEY".to_string(),
            protocol: "openai".to_string(),
        },
        ClientProviderConfig {
            name: "secondary".to_string(),
            base_url: "https://api.secondary-model.example/v1".to_string(),
            api_key: "env:BRAINX_SECONDARY_MODEL_API_KEY".to_string(),
            protocol: "openai".to_string(),
        },
    ]
}

fn legacy_models_to_providers(models: Vec<LegacyClientModelConfig>) -> Vec<ClientProviderConfig> {
    let mut providers = Vec::new();
    for model in models {
        if providers.iter().any(|provider: &ClientProviderConfig| provider.name == model.name) {
            continue;
        }
        providers.push(ClientProviderConfig {
            name: model.name,
            base_url: model.base_url,
            api_key: model.api_key,
            protocol: model.protocol,
        });
    }
    providers
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
        let mut config = load_config(path.clone())?;
        if config.device_name.trim().is_empty() || config.device_name == "local-dev" {
            config.device_name = device_name.to_string();
            save_config(path, &config)?;
        }
        return Ok(config);
    }
    let config = ClientConfig::new(server_url, device_name);
    save_config(path, &config)?;
    Ok(config)
}

pub fn default_device_name() -> String {
    hostname_from_command()
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "brainx-client".to_string())
}

pub fn resolve_device_name(device_name: Option<String>) -> String {
    device_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && !is_placeholder_device_name(value))
        .unwrap_or_else(default_device_name)
}

pub fn resolve_secret_value(value: &str, usage: &str) -> Result<String> {
    if let Some(name) = value.strip_prefix("env:") {
        return std::env::var(name).with_context(|| format!("{name} is required for {usage}"));
    }
    if let Some(literal) = value.strip_prefix("literal:") {
        return Ok(literal.to_string());
    }
    if value.trim().is_empty() {
        return Err(anyhow!("{usage} secret must not be empty"));
    }
    Ok(value.to_string())
}

fn is_placeholder_device_name(device_name: &str) -> bool {
    device_name.eq_ignore_ascii_case("local-dev")
}

fn hostname_from_command() -> Option<String> {
    let output = Command::new("hostname").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let hostname = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!hostname.is_empty()).then_some(hostname)
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
    let client_token = config.require_client_token()?;
    let url = format!(
        "{}/api/v1/client-daemons/{daemon_id}/unbind",
        config.server_url.trim_end_matches('/')
    );
    client
        .post(url)
        .bearer_auth(client_token)
        .json(&UnbindDaemonRequest { confirm })
        .send()
        .await
        .context("failed to send unbind request")?
        .error_for_status()
        .context("server rejected unbind request")?;
    Ok(())
}
