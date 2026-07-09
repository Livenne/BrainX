use brainx_client_daemon::auth::{
    bind_code, default_config_path, default_device_name, default_workspace_path, resolve_device_name,
    unbind, ClientConfig, ClientProviderConfig,
};
use serde_json::json;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[test]
fn default_paths_use_standard_brainx_app_directory() {
    let config_path = default_config_path().unwrap();
    let workspace_path = default_workspace_path().unwrap();

    assert!(config_path.ends_with(".brainx/config.json"));
    assert!(workspace_path.ends_with(".brainx/workspace"));
}

#[test]
fn client_config_has_providers_without_workspace_list_or_login_identity() {
    let config = ClientConfig::new("http://localhost:8080", "devbox");

    assert_eq!(config.server_url, "http://localhost:8080");
    assert_eq!(config.device_name, "devbox");
    assert!(config.installation_id.starts_with("install-"));
    assert_eq!(config.daemon_id, None);
    assert_eq!(config.client_token, None);
    assert_eq!(config.providers.len(), 2);
    let primary = config.provider_config("primary").unwrap();
    assert_eq!(primary.base_url, "https://api.primary-model.example/v1");
    assert_eq!(primary.api_key, "env:BRAINX_MODEL_API_KEY");
    assert_eq!(primary.protocol, "openai");
    let secondary = config.provider_config("secondary").unwrap();
    assert_eq!(secondary.base_url, "https://api.secondary-model.example/v1");
    assert_eq!(secondary.api_key, "env:BRAINX_SECONDARY_MODEL_API_KEY");
    assert_eq!(secondary.protocol, "openai");
    let serialized = serde_json::to_value(&config).unwrap();
    assert!(serialized.get("workspaces").is_none());
    assert!(serialized.get("models").is_none());
    assert!(serialized.get("activeModel").is_none());
    assert!(serialized.get("username").is_none());
    assert!(serialized.get("sessionToken").is_none());
}

#[test]
fn resolve_device_name_treats_local_dev_as_placeholder() {
    assert_eq!(resolve_device_name(Some("devbox".to_string())), "devbox");
    assert_eq!(resolve_device_name(Some("local-dev".to_string())), default_device_name());
    assert_eq!(resolve_device_name(Some("  ".to_string())), default_device_name());
}

#[test]
fn client_config_rejects_duplicate_provider_names() {
    let mut config = ClientConfig::new("http://localhost:8080", "devbox");

    let result = config.add_provider(provider("primary"));

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("provider name already exists"));
}

#[test]
fn client_config_removes_provider_by_name() {
    let mut config = ClientConfig::new("http://localhost:8080", "devbox");
    config.add_provider(provider("backup")).unwrap();

    config.remove_provider("backup").unwrap();
    let missing_result = config.remove_provider("backup");

    assert!(config.provider_config("backup").is_err());
    assert!(missing_result.is_err());
    assert!(missing_result.unwrap_err().to_string().contains("provider not found"));
}

#[test]
fn client_config_migrates_legacy_models_to_unique_providers() {
    let legacy = r#"{
      "serverUrl":"http://localhost:8080",
      "deviceName":"devbox",
      "installationId":"install-test",
      "activeModel":"example-chat",
      "models":[
        {"name":"example-chat","model":"example-chat-model","baseUrl":"https://api.primary-model.example/v1","apiKey":"env:BRAINX_MODEL_API_KEY","protocol":"openai","contextWindow":128000},
        {"name":"example-reasoning-model","model":"example-reasoning-model","baseUrl":"https://api.secondary-model.example/v1","apiKey":"env:BRAINX_SECONDARY_MODEL_API_KEY","protocol":"openai"}
      ]
    }"#;

    let config: ClientConfig = serde_json::from_str(legacy).unwrap();

    assert_eq!(config.providers.len(), 2);
    assert!(config.provider_config("example-chat").is_ok());
    assert!(config.provider_config("example-reasoning-model").is_ok());
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
        .and(header("authorization", "Bearer client-token-1"))
        .and(body_json(json!({"confirm": true})))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({"accepted": true})))
        .expect(1)
        .mount(&server)
        .await;

    let mut config = ClientConfig::new(server.uri(), "devbox");
    config.daemon_id = Some("cd_1".to_string());
    config.client_token = Some("client-token-1".to_string());

    let rejected = unbind(&config, false).await;
    unbind(&config, true).await.unwrap();

    assert!(rejected.unwrap_err().to_string().contains("confirmation"));
}

fn provider(name: &str) -> ClientProviderConfig {
    ClientProviderConfig {
        name: name.to_string(),
        base_url: "https://api.primary-model.example/v1".to_string(),
        api_key: "env:BRAINX_MODEL_API_KEY".to_string(),
        protocol: "openai".to_string(),
    }
}
