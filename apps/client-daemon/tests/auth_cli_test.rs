use brainx_client_daemon::auth::{
    bind_code, default_config_path, default_workspace_path, unbind, ClientConfig, ClientModelConfig,
};
use serde_json::json;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[test]
fn default_paths_use_standard_brainx_app_directory() {
    let config_path = default_config_path().unwrap();
    let workspace_path = default_workspace_path().unwrap();

    assert!(config_path.ends_with(".brainx/config.json"));
    assert!(workspace_path.ends_with(".brainx/workspace"));
}

#[test]
fn client_config_has_models_without_workspace_list_or_login_identity() {
    let config = ClientConfig::new("http://localhost:8080", "devbox");

    assert_eq!(config.server_url, "http://localhost:8080");
    assert_eq!(config.device_name, "devbox");
    assert_eq!(config.daemon_id, None);
    assert_eq!(config.active_model, "nvidia-step");
    assert_eq!(config.active_model_config().unwrap().protocol, "openai");
    assert_eq!(config.models.len(), 2);
    let gpt_model = config.model_config(Some("gpt-5.5")).unwrap();
    assert_eq!(gpt_model.model, "gpt-5.5");
    assert_eq!(gpt_model.base_url, "https://api.shangan9.cc.cd/v1");
    assert_eq!(gpt_model.api_key, "env:SHANGAN_API_KEY");
    assert_eq!(gpt_model.protocol, "openai");
    let serialized = serde_json::to_value(&config).unwrap();
    assert!(serialized.get("workspaces").is_none());
    assert!(serialized.get("username").is_none());
    assert!(serialized.get("sessionToken").is_none());
}

#[test]
fn client_config_rejects_duplicate_model_names() {
    let mut config = ClientConfig::new("http://localhost:8080", "devbox");

    let result = config.add_model(model("nvidia-step"));

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("model name already exists"));
}

#[test]
fn client_config_removes_non_active_model_but_keeps_active_model() {
    let mut config = ClientConfig::new("http://localhost:8080", "devbox");
    config.add_model(model("backup")).unwrap();

    config.remove_model("backup").unwrap();
    let active_result = config.remove_model("nvidia-step");

    assert!(config.model_config(Some("backup")).is_err());
    assert!(active_result.is_err());
    assert!(active_result.unwrap_err().to_string().contains("active model"));
}

#[tokio::test]
async fn bind_code_requires_running_daemon_and_posts_without_user_auth() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/cd_1/bind-code"))
        .and(body_json(json!({})))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "code": "BX-ABCD-2345",
            "expiresAt": "2026-07-07T12:00:00Z"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let mut config = ClientConfig::new(server.uri(), "devbox");
    let missing_daemon = bind_code(&config).await;
    config.daemon_id = Some("cd_1".to_string());
    let result = bind_code(&config).await.unwrap();

    assert!(missing_daemon.unwrap_err().to_string().contains("brainx start"));
    assert_eq!(result.code, "BX-ABCD-2345");
}

#[tokio::test]
async fn unbind_posts_without_user_auth_and_requires_confirmation() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/client-daemons/cd_1/unbind"))
        .and(body_json(json!({"confirm": true})))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let mut config = ClientConfig::new(server.uri(), "devbox");
    config.daemon_id = Some("cd_1".to_string());

    let rejected = unbind(&config, false).await;
    unbind(&config, true).await.unwrap();

    assert!(rejected.unwrap_err().to_string().contains("confirmation"));
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
