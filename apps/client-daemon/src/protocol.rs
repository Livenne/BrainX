use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest<'a> {
    pub username: &'a str,
    pub password: &'a str,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserView {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub token: String,
    pub user: UserView,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBindCodeRequest<'a> {
    pub workspace_id: &'a str,
    pub device_name: &'a str,
    pub password: &'a str,
    pub capabilities: Vec<&'a str>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindCodeResponse {
    pub code: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDaemonResponse {
    pub id: String,
    pub workspace_id: String,
    pub user_id: Option<String>,
    pub device_name: String,
    pub status: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub bound_at: Option<String>,
    pub last_heartbeat_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnbindDaemonRequest {
    pub confirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncWorkspacesRequest<'a> {
    pub workspaces: Vec<SyncWorkspaceItem<'a>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncWorkspaceItem<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub path: &'a str,
    #[serde(rename = "default")]
    pub default_workspace: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterDaemonRequest<'a> {
    pub workspace_id: &'a str,
    pub device_name: &'a str,
    pub capabilities: Vec<&'a str>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterDaemonResponse {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    pub execution_id: String,
    pub workspace_id: String,
    pub agent_id: String,
    pub branch_id: String,
    pub run_id: String,
    pub tool_name: String,
    #[serde(default)]
    pub input: Value,
    pub risk_tier: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResultPayload {
    pub execution_id: String,
    pub status: String,
    pub summary: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionStreamEventPayload {
    pub execution_id: String,
    pub run_id: String,
    pub sequence: usize,
    #[serde(rename = "type")]
    pub event_type: String,
    pub content_delta: String,
    pub payload: Value,
}

impl ExecutionResultPayload {
    pub fn completed(execution_id: impl Into<String>, summary: impl Into<String>, data: Value) -> Self {
        Self {
            execution_id: execution_id.into(),
            status: "completed".to_string(),
            summary: summary.into(),
            data,
        }
    }

    pub fn failed(execution_id: impl Into<String>, summary: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            execution_id: execution_id.into(),
            status: "failed".to_string(),
            summary: summary.into(),
            data: serde_json::json!({ "error": message.into() }),
        }
    }
}
