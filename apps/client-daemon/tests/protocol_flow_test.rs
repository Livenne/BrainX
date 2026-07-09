use brainx_client_daemon::auth::{load_config, ClientConfig};
use brainx_client_daemon::daemon::{run_loop_with_config, run_once};
use brainx_client_daemon::protocol::{ExecutionRequest, RegisterDaemonResponse};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

static ENV_LOCK: Mutex<()> = Mutex::new(());

#[tokio::test]
async fn run_loop_with_config_reregisters_when_saved_daemon_is_missing() {
    let server = MockServer::start().await;
    let config_dir = tempfile::tempdir().unwrap();
    let config_path = config_dir.path().join("config.json");
    let mut config = ClientConfig::new(server.uri(), "devbox");
    config.daemon_id = Some("stale_daemon".to_string());
    config.client_token = Some("stale-token".to_string());

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response("fresh_daemon")))
        .expect(1)
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/fresh_daemon/execution-requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(Vec::<ExecutionRequest>::new()))
        .mount(&server)
        .await;

    let outcome = tokio::time::timeout(
        Duration::from_millis(250),
        run_loop_with_config(config_path.clone(), config, Duration::from_millis(25)),
    )
    .await;

    assert!(outcome.is_err(), "daemon should keep polling after re-registering instead of exiting");
    let saved = load_config(config_path).unwrap();
    assert_eq!(saved.daemon_id.as_deref(), Some("fresh_daemon"));
    assert_eq!(saved.client_token.as_deref(), Some("token-fresh_daemon"));
}

#[tokio::test]
async fn run_loop_with_config_refreshes_saved_daemon_registration_on_startup() {
    let server = MockServer::start().await;
    let config_dir = tempfile::tempdir().unwrap();
    let config_path = config_dir.path().join("config.json");
    let mut config = ClientConfig::new(server.uri(), "Livenne");
    config.installation_id = "install-existing".to_string();
    config.daemon_id = Some("existing_daemon".to_string());
    config.client_token = Some("old-token".to_string());

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response("existing_daemon")))
        .expect(1)
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/existing_daemon/execution-requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(Vec::<ExecutionRequest>::new()))
        .mount(&server)
        .await;

    let outcome = tokio::time::timeout(
        Duration::from_millis(180),
        run_loop_with_config(config_path.clone(), config, Duration::from_millis(25)),
    )
    .await;

    assert!(outcome.is_err(), "daemon should keep polling after refreshing registration");
    let saved = load_config(config_path).unwrap();
    assert_eq!(saved.daemon_id.as_deref(), Some("existing_daemon"));
    assert_eq!(saved.client_token.as_deref(), Some("token-existing_daemon"));

    let requests = server.received_requests().await.unwrap();
    let register_request = requests
        .iter()
        .find(|request| request.url.path() == "/api/v1/client-daemons/register")
        .expect("daemon should refresh registration on startup");
    let body: Value = serde_json::from_slice(&register_request.body).unwrap();
    assert_eq!(body["deviceName"], "Livenne");
    assert_eq!(body["installationId"], "install-existing");
    assert!(body["operatingSystem"].as_str().unwrap_or_default().contains("Linux"));
}

#[tokio::test]
async fn run_loop_with_config_keeps_running_while_daemon_waits_for_binding() {
    let server = MockServer::start().await;
    let config_dir = tempfile::tempdir().unwrap();
    let config_path = config_dir.path().join("config.json");
    let config = ClientConfig::new(server.uri(), "devbox");

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response("daemon_1")))
        .expect(1)
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-requests"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({
            "error": {
                "code": "auth.forbidden",
                "message": "Client daemon is not bound."
            }
        })))
        .mount(&server)
        .await;

    let outcome = tokio::time::timeout(
        Duration::from_millis(180),
        run_loop_with_config(config_path.clone(), config, Duration::from_millis(25)),
    )
    .await;

    assert!(outcome.is_err(), "daemon should wait for browser binding instead of exiting on 403");
    let saved = load_config(config_path).unwrap();
    assert_eq!(saved.daemon_id.as_deref(), Some("daemon_1"));
    assert_eq!(saved.client_token.as_deref(), Some("token-daemon_1"));
}

#[tokio::test]
async fn run_once_polls_executes_and_posts_result() {
    let server = MockServer::start().await;
    let workspace = tempfile::tempdir().unwrap();

    let register_response = register_response("daemon_1");
    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response))
        .mount(&server)
        .await;

    let request = ExecutionRequest {
        execution_id: "exec_1".to_string(),
        workspace_id: "workspace_1".to_string(),
        client_daemon_id: String::new(),
        agent_id: "agent_1".to_string(),
        branch_id: "branch_1".to_string(),
        run_id: "run_1".to_string(),
        tool_name: "get_environment".to_string(),
        input: json!({}),
        risk_tier: "read".to_string(),
        idempotency_key: "idem_1".to_string(),
    };
    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(vec![request]))
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-results"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let result = run_once(&server.uri(), "workspace_1", "devbox", workspace.path()).await;

    assert!(result.is_ok());
}

#[tokio::test]
async fn run_once_syncs_skill_inventory_after_skill_apply() {
    let server = MockServer::start().await;
    let workspace = tempfile::tempdir().unwrap();
    let target = workspace
        .path()
        .join(".agents/skills/new-skill/SKILL.md");

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response("daemon_1")))
        .mount(&server)
        .await;

    Mock::given(method("PUT"))
        .and(path("/api/v1/client-daemons/daemon_1/skills"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(vec![ExecutionRequest {
            execution_id: "exec_skill_apply".to_string(),
            workspace_id: "workspace_1".to_string(),
            client_daemon_id: String::new(),
            agent_id: "agent_1".to_string(),
            branch_id: "branch_1".to_string(),
            run_id: "run_1".to_string(),
            tool_name: "skill.apply".to_string(),
            input: json!({
                "path": target,
                "content": "---\nname: new-skill\ndescription: New skill\n---\n# New Skill\n"
            }),
            risk_tier: "write".to_string(),
            idempotency_key: "idem_skill_apply".to_string(),
        }]))
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-results"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let result = run_once(&server.uri(), "workspace_1", "devbox", workspace.path()).await;

    assert!(result.is_ok());
    let requests = server.received_requests().await.unwrap();
    let skill_syncs: Vec<_> = requests
        .iter()
        .filter(|request| request.url.path() == "/api/v1/client-daemons/daemon_1/skills")
        .collect();
    assert_eq!(skill_syncs.len(), 2, "daemon should sync before and after skill.apply");
    assert!(skill_syncs.iter().any(|request| {
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        body["project"]
            .as_array()
            .map(|skills| skills.iter().any(|skill| skill["name"] == "new-skill"))
            .unwrap_or(false)
    }));
}

#[tokio::test]
async fn run_once_executes_model_invoke_with_local_nvidia_key() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let server = MockServer::start().await;
    let model_server = MockServer::start().await;
    let workspace = tempfile::tempdir().unwrap();

    std::env::set_var("NVIDIA_API_KEY", "test-api-key");
    std::env::set_var("BRAINX_NVIDIA_MODEL", "test-model");
    std::env::set_var("BRAINX_NVIDIA_BASE_URL", format!("{}/v1", model_server.uri()));

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": "test-model",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Workspace inspected.",
                    "tool_calls": []
                }
            }],
            "usage": {"total_tokens": 12}
        })))
        .expect(1)
        .mount(&model_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response("daemon_1")))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(vec![ExecutionRequest {
            execution_id: "exec_model".to_string(),
            workspace_id: "workspace_1".to_string(),
            client_daemon_id: String::new(),
            agent_id: "agent_1".to_string(),
            branch_id: "branch_1".to_string(),
            run_id: "run_1".to_string(),
            tool_name: "model.invoke".to_string(),
            input: json!({
                "phase": "tool_selection",
                "messages": [{"role": "user", "content": "Inspect workspace."}],
                "tools": []
            }),
            risk_tier: "network".to_string(),
            idempotency_key: "idem_model".to_string(),
        }]))
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-results"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let result = run_once(&server.uri(), "workspace_1", "devbox", workspace.path()).await;

    std::env::remove_var("NVIDIA_API_KEY");
    std::env::remove_var("BRAINX_NVIDIA_MODEL");
    std::env::remove_var("BRAINX_NVIDIA_BASE_URL");

    assert!(result.is_ok());
    let requests = server.received_requests().await.unwrap();
    let posted_result = requests
        .iter()
        .find(|request| request.url.path() == "/api/v1/client-daemons/daemon_1/execution-results")
        .expect("daemon should post execution result");
    let body: Value = serde_json::from_slice(&posted_result.body).unwrap();
    assert_eq!(body["executionId"], "exec_model");
    assert_eq!(body["status"], "completed");
    assert_eq!(body["data"]["message"]["content"], "Workspace inspected.");
    assert_eq!(body["data"]["model"], "test-model");
}

#[tokio::test]
async fn run_once_executes_model_tool_calls_locally_until_final_answer() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let server = MockServer::start().await;
    let model_server = MockServer::start().await;
    let workspace = tempfile::tempdir().unwrap();
    std::fs::write(workspace.path().join("README.md"), "brainx workspace\n").unwrap();

    std::env::set_var("NVIDIA_API_KEY", "test-api-key");
    std::env::set_var("BRAINX_NVIDIA_MODEL", "test-model");
    std::env::set_var("BRAINX_NVIDIA_BASE_URL", format!("{}/v1", model_server.uri()));

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(|request: &wiremock::Request| {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            !body["messages"]
                .as_array()
                .unwrap()
                .iter()
                .any(|message| message["role"] == "tool")
        })
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": "test-model",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_list",
                        "type": "function",
                        "function": {
                            "name": "list_directory",
                            "arguments": "{\"path\":\".\",\"recursive\":false}"
                        }
                    }]
                }
            }],
            "usage": {"total_tokens": 10}
        })))
        .expect(1)
        .mount(&model_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(|request: &wiremock::Request| {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            body["messages"]
                .as_array()
                .unwrap()
                .iter()
                .any(|message| {
                    message["role"] == "tool"
                        && message["tool_call_id"] == "call_list"
                        && message["content"].as_str().unwrap_or_default().contains("README.md")
                })
        })
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": "test-model",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "README.md is present.",
                    "tool_calls": []
                }
            }],
            "usage": {"total_tokens": 18}
        })))
        .expect(1)
        .mount(&model_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response("daemon_1")))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(vec![ExecutionRequest {
            execution_id: "exec_model_loop".to_string(),
            workspace_id: "workspace_1".to_string(),
            client_daemon_id: String::new(),
            agent_id: "agent_1".to_string(),
            branch_id: "branch_1".to_string(),
            run_id: "run_1".to_string(),
            tool_name: "model.invoke".to_string(),
            input: json!({
                "messages": [{"role": "user", "content": "List the current directory."}]
            }),
            risk_tier: "network".to_string(),
            idempotency_key: "idem_model_loop".to_string(),
        }]))
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-results"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let result = run_once(&server.uri(), "workspace_1", "devbox", workspace.path()).await;

    std::env::remove_var("NVIDIA_API_KEY");
    std::env::remove_var("BRAINX_NVIDIA_MODEL");
    std::env::remove_var("BRAINX_NVIDIA_BASE_URL");

    assert!(result.is_ok());
    let requests = server.received_requests().await.unwrap();
    let posted_result = requests
        .iter()
        .find(|request| request.url.path() == "/api/v1/client-daemons/daemon_1/execution-results")
        .expect("daemon should post execution result");
    let body: Value = serde_json::from_slice(&posted_result.body).unwrap();
    assert_eq!(body["status"], "completed");
    assert_eq!(body["data"]["message"]["content"], "README.md is present.");
    assert!(body["data"]["messages"].to_string().contains("call_list"));
}

#[tokio::test]
async fn run_once_rejects_streamed_empty_tool_name_before_tool_execution() {
    let _env_guard = ENV_LOCK.lock().unwrap();
    let server = MockServer::start().await;
    let model_server = MockServer::start().await;
    let workspace = tempfile::tempdir().unwrap();

    std::env::set_var("NVIDIA_API_KEY", "test-api-key");
    std::env::set_var("BRAINX_NVIDIA_MODEL", "test-model");
    std::env::set_var("BRAINX_NVIDIA_BASE_URL", format!("{}/v1", model_server.uri()));

    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    concat!(
                        "data: {\"model\":\"test-model\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_empty\",\"type\":\"function\",\"function\":{\"name\":\"\",\"arguments\":\"{}\"}}]}}]}\n\n",
                        "data: [DONE]\n\n"
                    )
                ),
        )
        .expect(1)
        .mount(&model_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response("daemon_1")))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(vec![ExecutionRequest {
            execution_id: "exec_empty_tool".to_string(),
            workspace_id: "workspace_1".to_string(),
            client_daemon_id: String::new(),
            agent_id: "agent_1".to_string(),
            branch_id: "branch_1".to_string(),
            run_id: "run_empty_tool".to_string(),
            tool_name: "model.invoke".to_string(),
            input: json!({
                "messages": [{"role": "user", "content": "call a blank tool"}],
                "tools": []
            }),
            risk_tier: "network".to_string(),
            idempotency_key: "idem_empty_tool".to_string(),
        }]))
        .mount(&server)
        .await;

    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-results"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let result = run_once(&server.uri(), "workspace_1", "devbox", workspace.path()).await;

    std::env::remove_var("NVIDIA_API_KEY");
    std::env::remove_var("BRAINX_NVIDIA_MODEL");
    std::env::remove_var("BRAINX_NVIDIA_BASE_URL");

    assert!(result.is_ok());
    let requests = server.received_requests().await.unwrap();
    let posted_result = requests
        .iter()
        .find(|request| request.url.path() == "/api/v1/client-daemons/daemon_1/execution-results")
        .expect("daemon should post failed execution result");
    let body: Value = serde_json::from_slice(&posted_result.body).unwrap();
    assert_eq!(body["executionId"], "exec_empty_tool");
    assert_eq!(body["status"], "failed");
    assert_eq!(body["summary"], "model.invoke failed");
    let error = body["data"]["error"].as_str().unwrap_or_default();
    assert!(error.contains("tool call is missing a function name"));
    assert!(!error.contains("unsupported tool: "));
}

fn register_response(id: &str) -> RegisterDaemonResponse {
    RegisterDaemonResponse {
        id: id.to_string(),
        workspace_id: Some("w_core".to_string()),
        user_id: None,
        installation_id: Some("install-test".to_string()),
        client_token: format!("token-{id}"),
        device_name: Some("devbox".to_string()),
        status: "active".to_string(),
        capabilities: vec!["model.invoke".to_string(), "agent.loop".to_string()],
        bound_at: None,
        last_heartbeat_at: None,
    }
}
