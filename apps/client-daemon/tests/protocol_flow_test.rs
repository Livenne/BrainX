use brainx_client_daemon::daemon::run_once;
use brainx_client_daemon::protocol::{ExecutionRequest, RegisterDaemonResponse};
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn run_once_polls_executes_and_posts_result() {
    let server = MockServer::start().await;
    let workspace = tempfile::tempdir().unwrap();

    let register_response = RegisterDaemonResponse {
        id: "daemon_1".to_string(),
        status: "active".to_string(),
    };
    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/register"))
        .respond_with(ResponseTemplate::new(200).set_body_json(register_response))
        .mount(&server)
        .await;

    let request = ExecutionRequest {
        execution_id: "exec_1".to_string(),
        workspace_id: "workspace_1".to_string(),
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
async fn run_once_executes_model_invoke_with_local_nvidia_key() {
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
        .respond_with(ResponseTemplate::new(200).set_body_json(RegisterDaemonResponse {
            id: "daemon_1".to_string(),
            status: "active".to_string(),
        }))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons/daemon_1/execution-requests"))
        .respond_with(ResponseTemplate::new(200).set_body_json(vec![ExecutionRequest {
            execution_id: "exec_model".to_string(),
            workspace_id: "workspace_1".to_string(),
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
