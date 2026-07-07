use brainx_client_daemon::auth::{
    bind_code, default_config_path, login, logout, sync_bound_daemon, sync_workspaces, unbind, ClientConfig,
    ClientModelConfig, ClientWorkspaceConfig,
};
use serde_json::json;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn login_returns_config_with_session_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/login"))
        .and(body_json(json!({"username":"user_a","password":"pw-a-12345"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "token": "token_a",
            "user": {"id": "u_1", "username": "user_a"}
        })))
        .expect(1)
        .mount(&server)
        .await;

    let config = login(&server.uri(), "user_a", "pw-a-12345").await.unwrap();

    assert_eq!(config.server_url, server.uri());
    assert_eq!(config.username.as_deref(), Some("user_a"));
    assert_eq!(config.session_token.as_deref(), Some("token_a"));
    assert_eq!(config.active_workspace_id, "w_core");
    assert_eq!(config.default_workspace().unwrap().path, default_workspace_path_for_test());
}

#[test]
fn default_config_path_uses_standard_config_json() {
    let path = default_config_path().unwrap();

    assert!(path.ends_with(".brainx/config.json"));
}

#[test]
fn client_config_keeps_default_workspace_and_models() {
    let mut config = ClientConfig::new("http://localhost:8080", "devbox");

    assert_eq!(config.active_workspace_id, "w_core");
    assert_eq!(config.default_workspace().unwrap().id, "w_core");
    assert!(config.remove_workspace("w_core", true).is_err());
    assert_eq!(config.active_model, "nvidia-step");
    assert_eq!(config.active_model_config().unwrap().protocol, "openai");
}

#[tokio::test]
async fn bind_code_requires_saved_session_and_posts_password_verification() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/bind-codes"))
        .and(header("authorization", "Bearer token_a"))
        .and(body_json(json!({
            "workspaceId": "w_core",
            "deviceName": "devbox",
            "password": "pw-a-12345",
            "capabilities": [
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
                "background_stop"
            ]
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "code": "BX-ABCD-2345",
            "expiresAt": "2026-07-06T12:00:00Z"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let config = ClientConfig {
        server_url: server.uri(),
        username: Some("user_a".to_string()),
        session_token: Some("token_a".to_string()),
        active_workspace_id: "w_core".to_string(),
        workspaces: vec![workspace("w_core", "Core", ".", false)],
        device_name: "devbox".to_string(),
        daemon_id: None,
        active_model: "nvidia-step".to_string(),
        models: vec![model("nvidia-step")],
    };

    let result = bind_code(&config, "pw-a-12345").await.unwrap();

    assert_eq!(result.code, "BX-ABCD-2345");
}

#[tokio::test]
async fn unbind_requires_explicit_confirmation() {
    let server = MockServer::start().await;
    let config = ClientConfig {
        server_url: server.uri(),
        username: Some("user_a".to_string()),
        session_token: Some("token_a".to_string()),
        active_workspace_id: "w_core".to_string(),
        workspaces: vec![workspace("w_core", "Core", ".", false)],
        device_name: "devbox".to_string(),
        daemon_id: Some("cd_1".to_string()),
        active_model: "nvidia-step".to_string(),
        models: vec![model("nvidia-step")],
    };

    let result = unbind(&config, false).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("confirmation"));
}

#[tokio::test]
async fn unbind_posts_confirmed_revoke_request() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/cd_1/unbind"))
        .and(header("authorization", "Bearer token_a"))
        .and(body_json(json!({"confirm": true})))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let config = ClientConfig {
        server_url: server.uri(),
        username: Some("user_a".to_string()),
        session_token: Some("token_a".to_string()),
        active_workspace_id: "w_core".to_string(),
        workspaces: vec![workspace("w_core", "Core", ".", false)],
        device_name: "devbox".to_string(),
        daemon_id: Some("cd_1".to_string()),
        active_model: "nvidia-step".to_string(),
        models: vec![model("nvidia-step")],
    };

    unbind(&config, true).await.unwrap();
}

#[tokio::test]
async fn logout_posts_auth_logout_and_clears_local_identity() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/logout"))
        .and(header("authorization", "Bearer token_a"))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let config = ClientConfig {
        server_url: server.uri(),
        username: Some("user_a".to_string()),
        session_token: Some("token_a".to_string()),
        active_workspace_id: "w_core".to_string(),
        workspaces: vec![workspace("w_core", "Core", "/workspace/brainx", false)],
        device_name: "devbox".to_string(),
        daemon_id: Some("cd_1".to_string()),
        active_model: "nvidia-step".to_string(),
        models: vec![model("nvidia-step")],
    };

    let cleared = logout(&config).await.unwrap();

    assert_eq!(cleared.server_url, config.server_url);
    assert_eq!(cleared.active_workspace_id, config.active_workspace_id);
    assert_eq!(cleared.active_workspace().unwrap().path, config.active_workspace().unwrap().path);
    assert_eq!(cleared.device_name, config.device_name);
    assert_eq!(cleared.username, None);
    assert_eq!(cleared.session_token, None);
    assert_eq!(cleared.daemon_id, None);
}

#[tokio::test]
async fn sync_bound_daemon_saves_matching_active_daemon() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons"))
        .and(header("authorization", "Bearer token_a"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {
                "id": "cd_other",
                "workspaceId": "w_core",
                "userId": "u_1",
                "deviceName": "other-device",
                "status": "active",
                "capabilities": ["model.invoke"]
            },
            {
                "id": "cd_1",
                "workspaceId": "w_core",
                "userId": "u_1",
                "deviceName": "devbox",
                "status": "active",
                "capabilities": ["model.invoke", "read_files"]
            }
        ])))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/api/v1/client-daemons/cd_1/workspaces"))
        .and(header("authorization", "Bearer token_a"))
        .and(body_json(json!({
            "workspaces": [
                {"id": "w_core", "name": "Core", "path": "/workspace/brainx", "default": false}
            ]
        })))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let config = ClientConfig {
        server_url: server.uri(),
        username: Some("user_a".to_string()),
        session_token: Some("token_a".to_string()),
        active_workspace_id: "w_core".to_string(),
        workspaces: vec![workspace("w_core", "Core", "/workspace/brainx", false)],
        device_name: "devbox".to_string(),
        daemon_id: None,
        active_model: "nvidia-step".to_string(),
        models: vec![model("nvidia-step")],
    };

    let synced = sync_bound_daemon(&config).await.unwrap();

    assert_eq!(synced.daemon_id.as_deref(), Some("cd_1"));
}

#[tokio::test]
async fn sync_bound_daemon_requires_one_matching_active_daemon() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/client-daemons"))
        .and(header("authorization", "Bearer token_a"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {
                "id": "cd_revoked",
                "workspaceId": "w_core",
                "userId": "u_1",
                "deviceName": "devbox",
                "status": "revoked",
                "capabilities": ["model.invoke"]
            }
        ])))
        .expect(1)
        .mount(&server)
        .await;

    let config = ClientConfig {
        server_url: server.uri(),
        username: Some("user_a".to_string()),
        session_token: Some("token_a".to_string()),
        active_workspace_id: "w_core".to_string(),
        workspaces: vec![workspace("w_core", "Core", "/workspace/brainx", false)],
        device_name: "devbox".to_string(),
        daemon_id: None,
        active_model: "nvidia-step".to_string(),
        models: vec![model("nvidia-step")],
    };

    let result = sync_bound_daemon(&config).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No active bound client"));
}

#[tokio::test]
async fn sync_workspaces_posts_local_workspace_config_for_bound_daemon() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/api/v1/client-daemons/cd_1/workspaces"))
        .and(header("authorization", "Bearer token_a"))
        .and(body_json(json!({
            "workspaces": [
                {"id": "w_core", "name": "Core", "path": "/workspace/core", "default": true},
                {"id": "w_project", "name": "Project", "path": "/workspace/project", "default": false}
            ]
        })))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let config = ClientConfig {
        server_url: server.uri(),
        username: Some("user_a".to_string()),
        session_token: Some("token_a".to_string()),
        active_workspace_id: "w_core".to_string(),
        workspaces: vec![
            workspace("w_core", "Core", "/workspace/core", true),
            workspace("w_project", "Project", "/workspace/project", false),
        ],
        device_name: "devbox".to_string(),
        daemon_id: Some("cd_1".to_string()),
        active_model: "nvidia-step".to_string(),
        models: vec![model("nvidia-step")],
    };

    sync_workspaces(&config).await.unwrap();
}

fn workspace(id: &str, name: &str, path: &str, is_default: bool) -> ClientWorkspaceConfig {
    ClientWorkspaceConfig {
        id: id.to_string(),
        name: name.to_string(),
        path: path.to_string(),
        default: is_default,
    }
}

fn model(name: &str) -> ClientModelConfig {
    ClientModelConfig {
        name: name.to_string(),
        model: "stepfun-ai/step-3.7-flash".to_string(),
        base_url: "https://integrate.api.nvidia.com/v1".to_string(),
        api_key: "env:NVIDIA_API_KEY".to_string(),
        protocol: "openai".to_string(),
        context_window: Some(128000),
    }
}

fn default_workspace_path_for_test() -> String {
    format!("{}/.brainx/workspace", std::env::var("HOME").unwrap())
}
