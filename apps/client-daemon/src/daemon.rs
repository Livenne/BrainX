use crate::auth::{default_workspace_path, save_config, ClientConfig, CAPABILITIES};
use crate::logging::log_event;
use crate::model::{ModelClient, ModelConfig, ModelStreamEvent};
use crate::protocol::{
    ExecutionRequest, ExecutionResultPayload, ExecutionStreamEventPayload, RegisterDaemonRequest,
    RegisterDaemonResponse,
};
use crate::tools::{ToolRuntimeState, WorkspaceTools};
use anyhow::{Context, Error, Result};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
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
    post_skill_inventory(&client, server_url, &daemon.id, &tools).await;
    for request in requests {
        let result = execute_request(&client, server_url, &daemon.id, &tools, &request, None).await;
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
        post_skill_inventory(&client, server_url, &daemon.id, &tools).await;
        for request in requests {
            let result = execute_request(&client, server_url, &daemon.id, &tools, &request, None).await;
            post_result(&client, server_url, &daemon.id, &result).await?;
        }
        sleep(poll_interval).await;
    }
}

pub async fn run_loop_with_config(
    config_path: PathBuf,
    mut config: ClientConfig,
    poll_interval: Duration,
) -> Result<()> {
    let client = Client::new();
    let mut daemon_id = match config.daemon_id.clone() {
        Some(daemon_id) if !daemon_id.is_empty() => daemon_id,
        _ => {
            let daemon = register(&client, &config.server_url, "w_core", &config.device_name).await?;
            config.daemon_id = Some(daemon.id.clone());
            save_config(config_path.clone(), &config)?;
            daemon.id
        }
    };
    let tool_runtime = ToolRuntimeState::default();
    loop {
        let requests = match poll_requests(&client, &config.server_url, &daemon_id).await {
            Ok(requests) => requests,
            Err(error) if is_http_status(&error, StatusCode::NOT_FOUND) => {
                log_event(
                    "warn",
                    "daemon.registration.stale",
                    json!({"daemonId": &daemon_id, "reason": "server did not recognize daemon id"}),
                );
                let daemon = register(&client, &config.server_url, "w_core", &config.device_name).await?;
                daemon_id = daemon.id.clone();
                config.daemon_id = Some(daemon.id);
                save_config(config_path.clone(), &config)?;
                Vec::new()
            }
            Err(error) => return Err(error),
        };
        log_event(
            "info",
            "daemon.poll.completed",
            json!({"daemonId": &daemon_id, "requestCount": requests.len()}),
        );
        for request in requests {
            let workspace_root = request
                .input
                .get("currentWorkspace")
                .and_then(|value| value.as_str())
                .map(PathBuf::from)
                .unwrap_or(default_workspace_path()?);
            let tools = WorkspaceTools::new_with_state(&workspace_root, tool_runtime.clone());
            post_skill_inventory(&client, &config.server_url, &daemon_id, &tools).await;
            let result = execute_request(&client, &config.server_url, &daemon_id, &tools, &request, Some(&config)).await;
            post_result(&client, &config.server_url, &daemon_id, &result).await?;
        }
        sleep(poll_interval).await;
    }
}

fn is_http_status(error: &Error, status: StatusCode) -> bool {
    error
        .chain()
        .filter_map(|cause| cause.downcast_ref::<reqwest::Error>())
        .any(|cause| cause.status() == Some(status))
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

async fn post_skill_inventory(client: &Client, server_url: &str, daemon_id: &str, tools: &WorkspaceTools) {
    let inventory = match tools.skill_inventory() {
        Ok(inventory) => inventory,
        Err(error) => {
            log_event(
                "warn",
                "skills.scan.failed",
                json!({"daemonId": daemon_id, "error": error.to_string()}),
            );
            return;
        }
    };
    let url = format!(
        "{}/api/v1/client-daemons/{daemon_id}/skills",
        server_url.trim_end_matches('/')
    );
    if let Err(error) = client
        .put(url)
        .json(&inventory)
        .send()
        .await
        .context("failed to sync skill inventory")
        .and_then(|response| response.error_for_status().context("server rejected skill inventory sync"))
    {
        log_event(
            "warn",
            "skills.sync.failed",
            json!({"daemonId": daemon_id, "error": error.to_string()}),
        );
    }
}

async fn execute_request(
    http: &Client,
    server_url: &str,
    daemon_id: &str,
    tools: &WorkspaceTools,
    request: &ExecutionRequest,
    config: Option<&ClientConfig>,
) -> ExecutionResultPayload {
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
        execute_model_request(http, server_url, daemon_id, tools, request, config).await
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

async fn execute_model_request(
    http: &Client,
    server_url: &str,
    daemon_id: &str,
    tools: &WorkspaceTools,
    request: &ExecutionRequest,
    config: Option<&ClientConfig>,
) -> ExecutionResultPayload {
    let result = async {
        let model_name = request.input.get("modelName").and_then(|value| value.as_str());
        let model_config = match config {
            Some(config) => ModelConfig::from_client_config(config, model_name)?,
            None => ModelConfig::from_env()?,
        };
        let request_tools = tools
            .clone()
            .with_active_model_info(model_config.name.clone(), model_config.model.clone());
        let client = ModelClient::new(model_config);
        let reporter = StreamReporter::new(http.clone(), server_url, daemon_id, request);
        run_local_agent_loop(&request_tools, &client, &request.input, reporter).await
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

async fn run_local_agent_loop(
    tools: &WorkspaceTools,
    client: &ModelClient,
    input: &Value,
    stream_reporter: StreamReporter,
) -> Result<Value> {
    let mut request_input = input.clone();
    let mut messages = request_input
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .context("model.invoke requires input.messages")?;
    inject_local_context_messages(&mut messages, tools.local_context_messages());

    loop {
        request_input["messages"] = Value::Array(messages.clone());
        let reporter = stream_reporter.clone();
        let response = client
            .invoke_streaming(&request_input, move |event| {
                let reporter = reporter.clone();
                async move { reporter.post(event).await }
            })
            .await?;
        let message = response.get("message").cloned().unwrap_or_else(|| json!({}));
        let tool_calls = message
            .get("toolCalls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        messages.push(assistant_message_from_model(&message, &tool_calls));

        if tool_calls.is_empty() {
            let mut final_response = response;
            final_response["messages"] = Value::Array(messages);
            return Ok(final_response);
        }

        for (index, tool_call) in tool_calls.iter().enumerate() {
            let tool_call_id = tool_call
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("call_{index}"));
            let tool_name = tool_call
                .get("name")
                .and_then(Value::as_str)
                .context("model tool call requires name")?;
            let arguments = tool_call.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let tool_result = match tools.execute(tool_name, &arguments) {
                Ok(data) => json!({ "ok": true, "result": data }),
                Err(error) => json!({ "ok": false, "error": error.to_string() }),
            };
            messages.push(json!({
                "role": "tool",
                "toolCallId": tool_call_id,
                "name": tool_name,
                "content": serde_json::to_string(&tool_result).unwrap_or_else(|_| "{\"ok\":false,\"error\":\"failed to encode tool result\"}".to_string())
            }));

            if tool_name == "ask_user"
                && tool_result
                    .get("result")
                    .and_then(|result| result.get("status"))
                    .and_then(Value::as_str)
                    == Some("waiting_for_user")
            {
                return Ok(json!({
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "toolCalls": []
                    },
                    "paused": true,
                    "pause": tool_result.get("result").cloned().unwrap_or_else(|| json!({})),
                    "messages": messages
                }));
            }
        }
    }
}

fn inject_local_context_messages(messages: &mut Vec<Value>, injected: Vec<Value>) {
    if injected.is_empty() {
        return;
    }
    let insert_at = messages
        .iter()
        .position(|message| message.get("role").and_then(Value::as_str) != Some("system"))
        .unwrap_or(messages.len());
    for (offset, message) in injected.into_iter().enumerate() {
        messages.insert(insert_at + offset, message);
    }
}

#[derive(Clone)]
struct StreamReporter {
    http: Client,
    server_url: String,
    daemon_id: String,
    execution_id: String,
    run_id: String,
    sequence: Arc<AtomicUsize>,
}

impl StreamReporter {
    fn new(http: Client, server_url: &str, daemon_id: &str, request: &ExecutionRequest) -> Self {
        Self {
            http,
            server_url: server_url.trim_end_matches('/').to_string(),
            daemon_id: daemon_id.to_string(),
            execution_id: request.execution_id.clone(),
            run_id: request.run_id.clone(),
            sequence: Arc::new(AtomicUsize::new(0)),
        }
    }

    async fn post(&self, event: ModelStreamEvent) -> Result<()> {
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let url = format!(
            "{}/api/v1/client-daemons/{}/execution-stream-events",
            self.server_url, self.daemon_id
        );
        let result = self
            .http
            .post(url)
            .json(&ExecutionStreamEventPayload {
                execution_id: self.execution_id.clone(),
                run_id: self.run_id.clone(),
                sequence,
                event_type: event.event_type.clone(),
                content_delta: event.content_delta.clone(),
                payload: event.payload.clone(),
            })
            .send()
            .await
            .context("failed to post execution stream event")?
            .error_for_status()
            .context("server rejected execution stream event");
        if let Err(error) = result {
            log_event(
                "warn",
                "execution.stream_event.failed",
                json!({
                    "executionId": &self.execution_id,
                    "runId": &self.run_id,
                    "sequence": sequence,
                    "error": error.to_string()
                }),
            );
        }
        Ok(())
    }
}

fn assistant_message_from_model(message: &Value, tool_calls: &[Value]) -> Value {
    let content = message.get("content").cloned().unwrap_or_else(|| json!(""));
    let mut assistant = json!({
        "role": "assistant",
        "content": content
    });
    if let Some(thinking) = message.get("thinking").and_then(Value::as_str).filter(|value| !value.is_empty()) {
        assistant["thinking"] = json!(thinking);
    }
    if !tool_calls.is_empty() {
        assistant["toolCalls"] = Value::Array(tool_calls.to_vec());
    }
    assistant
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
