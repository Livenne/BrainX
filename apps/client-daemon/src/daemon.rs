use crate::auth::{sync_workspaces, ClientConfig, CAPABILITIES};
use crate::logging::log_event;
use crate::model::{ModelClient, ModelConfig};
use crate::protocol::{
    ExecutionRequest, ExecutionResultPayload, RegisterDaemonRequest, RegisterDaemonResponse,
};
use crate::tools::WorkspaceTools;
use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::time::sleep;

pub async fn run_once(
    server_url: &str,
    workspace_id: &str,
    device_name: &str,
    workspace_root: &Path,
) -> Result<()> {
    let client = Client::new();
    let daemon = register(&client, server_url, workspace_id, device_name).await?;
    let requests = poll_requests(&client, server_url, &daemon.id).await?;
    log_event(
        "info",
        "daemon.poll.completed",
        json!({"daemonId": &daemon.id, "workspaceId": workspace_id, "requestCount": requests.len()}),
    );
    let tools = WorkspaceTools::new(workspace_root);
    for request in requests {
        let result = execute_request(&tools, &request, None).await;
        post_result(&client, server_url, &daemon.id, &result).await?;
    }
    Ok(())
}

pub async fn run_loop(
    server_url: &str,
    workspace_id: &str,
    device_name: &str,
    workspace_root: &Path,
    poll_interval: Duration,
) -> Result<()> {
    let client = Client::new();
    let daemon = register(&client, server_url, workspace_id, device_name).await?;
    let tools = WorkspaceTools::new(workspace_root);
    loop {
        let requests = poll_requests(&client, server_url, &daemon.id).await?;
        log_event(
            "info",
            "daemon.poll.completed",
            json!({"daemonId": &daemon.id, "workspaceId": workspace_id, "requestCount": requests.len()}),
        );
        for request in requests {
            let result = execute_request(&tools, &request, None).await;
            post_result(&client, server_url, &daemon.id, &result).await?;
        }
        sleep(poll_interval).await;
    }
}

pub async fn run_loop_with_config(
    config: &ClientConfig,
    workspace_root: &Path,
    poll_interval: Duration,
) -> Result<()> {
    let client = Client::new();
    let daemon_id = config.require_daemon_id()?.to_string();
    sync_workspaces(config).await?;
    loop {
        let requests = poll_requests_with_token(
            &client,
            &config.server_url,
            &daemon_id,
            config.session_token.as_deref(),
        )
        .await?;
        log_event(
            "info",
            "daemon.poll.completed",
            json!({"daemonId": &daemon_id, "workspaceId": &config.active_workspace_id, "requestCount": requests.len()}),
        );
        for request in requests {
            let request_workspace_root = workspace_root_for_request(config, workspace_root, &request.workspace_id);
            let tools = WorkspaceTools::new(&request_workspace_root);
            let result = execute_request(&tools, &request, Some(config)).await;
            post_result_with_token(
                &client,
                &config.server_url,
                &daemon_id,
                &result,
                config.session_token.as_deref(),
            )
            .await?;
        }
        sleep(poll_interval).await;
    }
}

fn workspace_root_for_request(config: &ClientConfig, fallback_root: &Path, workspace_id: &str) -> PathBuf {
    config
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .map(|workspace| PathBuf::from(&workspace.path))
        .unwrap_or_else(|| fallback_root.to_path_buf())
}

async fn register(
    client: &Client,
    server_url: &str,
    workspace_id: &str,
    device_name: &str,
) -> Result<RegisterDaemonResponse> {
    let url = format!("{}/api/v1/client-daemons/register", server_url.trim_end_matches('/'));
    let daemon: RegisterDaemonResponse = client
        .post(url)
        .json(&RegisterDaemonRequest {
            workspace_id,
            device_name,
            capabilities: CAPABILITIES.to_vec(),
        })
        .send()
        .await
        .context("failed to register daemon")?
        .error_for_status()
        .context("server rejected daemon registration")?
        .json()
        .await
        .context("failed to decode daemon registration")?;
    log_event(
        "info",
        "daemon.registered",
        json!({"daemonId": &daemon.id, "workspaceId": workspace_id, "deviceName": device_name}),
    );
    Ok(daemon)
}

async fn poll_requests(client: &Client, server_url: &str, daemon_id: &str) -> Result<Vec<ExecutionRequest>> {
    poll_requests_with_token(client, server_url, daemon_id, None).await
}

async fn poll_requests_with_token(
    client: &Client,
    server_url: &str,
    daemon_id: &str,
    token: Option<&str>,
) -> Result<Vec<ExecutionRequest>> {
    let url = format!(
        "{}/api/v1/client-daemons/{daemon_id}/execution-requests",
        server_url.trim_end_matches('/')
    );
    let mut request = client.get(url);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    request
        .send()
        .await
        .context("failed to poll execution requests")?
        .error_for_status()
        .context("server rejected execution request poll")?
        .json()
        .await
        .context("failed to decode execution requests")
}

async fn execute_request(tools: &WorkspaceTools, request: &ExecutionRequest, config: Option<&ClientConfig>) -> ExecutionResultPayload {
    let started = Instant::now();
    log_event(
        "info",
        "execution.started",
        json!({
            "runId": &request.run_id,
            "executionId": &request.execution_id,
            "toolName": &request.tool_name,
            "riskTier": &request.risk_tier
        }),
    );
    let result = if request.tool_name == "model.invoke" {
        execute_model_request(request, config).await
    } else {
        match tools.execute(&request.tool_name, &request.input) {
            Ok(data) => ExecutionResultPayload::completed(
                &request.execution_id,
                format!("{} completed", request.tool_name),
                data,
            ),
            Err(error) => ExecutionResultPayload::failed(
                &request.execution_id,
                format!("{} failed", request.tool_name),
                error.to_string(),
            ),
        }
    };
    log_event(
        if result.status == "completed" { "info" } else { "error" },
        if result.status == "completed" {
            "execution.completed"
        } else {
            "execution.failed"
        },
        json!({
            "runId": &request.run_id,
            "executionId": &request.execution_id,
            "toolName": &request.tool_name,
            "status": &result.status,
            "summary": &result.summary,
            "durationMs": started.elapsed().as_millis()
        }),
    );
    result
}

async fn execute_model_request(request: &ExecutionRequest, config: Option<&ClientConfig>) -> ExecutionResultPayload {
    let result = async {
        let model_name = request.input.get("modelName").and_then(|value| value.as_str());
        let model_config = match config {
            Some(config) => ModelConfig::from_client_config(config, model_name)?,
            None => ModelConfig::from_env()?,
        };
        let client = ModelClient::new(model_config);
        client.invoke(&request.input).await
    }
    .await;

    match result {
        Ok(data) => ExecutionResultPayload::completed(
            &request.execution_id,
            "model.invoke completed",
            data,
        ),
        Err(error) => ExecutionResultPayload::failed(
            &request.execution_id,
            "model.invoke failed",
            error.to_string(),
        ),
    }
}

async fn post_result(
    client: &Client,
    server_url: &str,
    daemon_id: &str,
    result: &ExecutionResultPayload,
) -> Result<()> {
    post_result_with_token(client, server_url, daemon_id, result, None).await
}

async fn post_result_with_token(
    client: &Client,
    server_url: &str,
    daemon_id: &str,
    result: &ExecutionResultPayload,
    token: Option<&str>,
) -> Result<()> {
    let url = format!(
        "{}/api/v1/client-daemons/{daemon_id}/execution-results",
        server_url.trim_end_matches('/')
    );
    let mut request = client.post(url).json(result);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    request
        .send()
        .await
        .context("failed to post execution result")?
        .error_for_status()
        .context("server rejected execution result")?;
    Ok(())
}
