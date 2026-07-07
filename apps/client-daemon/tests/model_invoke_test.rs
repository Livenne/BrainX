use brainx_client_daemon::auth::{ClientConfig, ClientModelConfig};
use brainx_client_daemon::model::{build_anthropic_messages_payload, build_openai_chat_payload, ModelClient, ModelConfig};
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn model_invoke_posts_openai_request_and_normalizes_tool_calls() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl_1",
            "model": "stepfun-ai/step-3.7-flash",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_read_files",
                        "type": "function",
                        "function": {
                            "name": "read_files",
                            "arguments": "{\"files\":[{\"path\":\"apps/browser/package.json\"}]}"
                        }
                    }]
                }
            }],
            "usage": {"prompt_tokens": 21, "completion_tokens": 7, "total_tokens": 28}
        })))
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        api_key: "test-api-key".to_string(),
        model: "stepfun-ai/step-3.7-flash".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });
    let result = client
        .invoke(&json!({
            "phase": "tool_selection",
            "messages": [
                {"role": "system", "content": "Use tools when needed."},
                {"role": "user", "content": "Read workspace files."}
            ],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "read_files",
                    "description": "Read files.",
                    "parameters": {"type": "object", "properties": {"files": {"type": "array"}}, "required": ["files"]}
                }
            }]
        }))
        .await
        .expect("model invoke should succeed");

    assert_eq!(result["message"]["role"], "assistant");
    assert_eq!(result["message"]["toolCalls"][0]["id"], "call_read_files");
    assert_eq!(result["message"]["toolCalls"][0]["name"], "read_files");
    assert_eq!(result["message"]["toolCalls"][0]["arguments"], json!({"files": [{"path": "apps/browser/package.json"}]}));
    assert_eq!(result["model"], "stepfun-ai/step-3.7-flash");
    assert_eq!(result["usage"]["total_tokens"], 28);

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].headers.get("authorization").unwrap().to_str().unwrap(),
        "Bearer test-api-key"
    );
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["model"], "stepfun-ai/step-3.7-flash");
    assert_eq!(body["messages"][1]["content"], "Read workspace files.");
    assert_eq!(body["tools"][0]["function"]["name"], "read_files");
}

#[tokio::test]
async fn model_invoke_reports_provider_status_and_body_on_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({
            "error": {"message": "invalid tool schema"}
        })))
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        api_key: "test-api-key".to_string(),
        model: "stepfun-ai/step-3.7-flash".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });

    let error = client
        .invoke(&json!({
            "messages": [{"role": "user", "content": "hello"}],
            "tools": []
        }))
        .await
        .expect_err("provider errors should be preserved");

    let message = error.to_string();
    assert!(message.contains("HTTP 400"));
    assert!(message.contains("invalid tool schema"));
    assert!(!message.contains("test-api-key"));
}


#[test]
fn model_config_requires_local_nvidia_api_key() {
    let result = ModelConfig::from_env_values(None, None, None);

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("NVIDIA_API_KEY"));
}

#[test]
fn model_config_uses_stepfun_flash_as_default_model() {
    let config = ModelConfig::from_env_values(Some("test-api-key".to_string()), None, None)
        .expect("api key should be enough for default model config");

    assert_eq!(config.model, "stepfun-ai/step-3.7-flash");
    assert_eq!(config.protocol, "openai");
}

#[test]
fn model_config_selects_named_model_from_client_config() {
    let config = ClientConfig {
        server_url: "http://localhost:8080".to_string(),
        username: None,
        session_token: None,
        active_workspace_id: "w_core".to_string(),
        workspaces: vec![],
        device_name: "devbox".to_string(),
        daemon_id: None,
        active_model: "fast".to_string(),
        models: vec![
            ClientModelConfig {
                name: "fast".to_string(),
                model: "stepfun-ai/step-3.7-flash".to_string(),
                base_url: "https://integrate.api.nvidia.com/v1".to_string(),
                api_key: "literal:test-key".to_string(),
                protocol: "openai".to_string(),
                context_window: Some(128000),
            },
            ClientModelConfig {
                name: "anthropic-main".to_string(),
                model: "claude-test".to_string(),
                base_url: "https://api.anthropic.com/v1".to_string(),
                api_key: "literal:anthropic-key".to_string(),
                protocol: "anthropic".to_string(),
                context_window: Some(200000),
            },
        ],
    };

    let selected = ModelConfig::from_client_config(&config, Some("anthropic-main")).unwrap();

    assert_eq!(selected.api_key, "anthropic-key");
    assert_eq!(selected.model, "claude-test");
    assert_eq!(selected.base_url, "https://api.anthropic.com/v1");
    assert_eq!(selected.protocol, "anthropic");
}

#[test]
fn openai_adapter_preserves_standard_tool_call_and_tool_result_messages() {
    let payload = build_openai_chat_payload(
        "test-model",
        &json!({
            "messages": [
                {"role": "system", "content": "Use tools when needed."},
                {"role": "user", "content": "Read package."},
                {
                    "role": "assistant",
                    "content": "",
                    "toolCalls": [{
                        "id": "call_read",
                        "name": "read_files",
                        "arguments": {"files": [{"path": "apps/browser/package.json"}]}
                    }]
                },
                {
                    "role": "tool",
                    "toolCallId": "call_read",
                    "name": "read_files",
                    "content": "{\"content\":\"package\"}"
                }
            ],
            "tools": []
        }),
    )
    .expect("payload should be valid");

    assert_eq!(payload["model"], "test-model");
    assert_eq!(payload["messages"][2]["role"], "assistant");
    assert_eq!(payload["messages"][2]["tool_calls"][0]["id"], "call_read");
    assert_eq!(payload["messages"][2]["tool_calls"][0]["type"], "function");
    assert_eq!(payload["messages"][2]["tool_calls"][0]["function"]["name"], "read_files");
    assert_eq!(
        payload["messages"][2]["tool_calls"][0]["function"]["arguments"],
        "{\"files\":[{\"path\":\"apps/browser/package.json\"}]}"
    );
    assert_eq!(payload["messages"][3]["role"], "tool");
    assert_eq!(payload["messages"][3]["tool_call_id"], "call_read");
}

#[test]
fn openai_adapter_accepts_standard_nested_tool_calls_from_server_context() {
    let payload = build_openai_chat_payload(
        "test-model",
        &json!({
            "messages": [
                {"role": "system", "content": "Use tools when needed."},
                {"role": "user", "content": "Inspect environment."},
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call_env",
                        "type": "function",
                        "function": {
                            "name": "get_env",
                            "arguments": "{}"
                        }
                    }]
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_env",
                    "name": "get_env",
                    "content": "{\"workspaceRoot\":\"/home/Livenne/code/brainx\"}"
                }
            ],
            "tools": []
        }),
    )
    .expect("standard server context should build an OpenAI payload");

    assert_eq!(payload["messages"][2]["tool_calls"][0]["id"], "call_env");
    assert_eq!(payload["messages"][2]["tool_calls"][0]["function"]["name"], "get_env");
    assert_eq!(payload["messages"][2]["tool_calls"][0]["function"]["arguments"], "{}");
    assert_eq!(payload["messages"][3]["tool_call_id"], "call_env");
}

#[test]
fn anthropic_adapter_uses_system_tool_use_and_tool_result_blocks() {
    let payload = build_anthropic_messages_payload(
        "claude-test",
        &json!({
            "messages": [
                {"role": "system", "content": "Use tools when needed."},
                {"role": "user", "content": "Read package."},
                {
                    "role": "assistant",
                    "content": "",
                    "toolCalls": [{
                        "id": "call_read",
                        "name": "read_files",
                        "arguments": {"files": [{"path": "apps/browser/package.json"}]}
                    }]
                },
                {
                    "role": "tool",
                    "toolCallId": "call_read",
                    "name": "read_files",
                    "content": "{\"content\":\"package\"}"
                }
            ],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "read_files",
                    "description": "Read files.",
                    "parameters": {"type": "object", "properties": {"files": {"type": "array"}}, "required": ["files"]}
                }
            }]
        }),
    )
    .expect("payload should be valid");

    assert_eq!(payload["model"], "claude-test");
    assert_eq!(payload["system"], "Use tools when needed.");
    assert_eq!(payload["messages"][0]["role"], "user");
    assert_eq!(payload["messages"][1]["role"], "assistant");
    assert_eq!(payload["messages"][1]["content"][0]["type"], "tool_use");
    assert_eq!(payload["messages"][1]["content"][0]["id"], "call_read");
    assert_eq!(payload["messages"][1]["content"][0]["name"], "read_files");
    assert_eq!(payload["messages"][1]["content"][0]["input"]["files"][0]["path"], "apps/browser/package.json");
    assert_eq!(payload["messages"][2]["role"], "user");
    assert_eq!(payload["messages"][2]["content"][0]["type"], "tool_result");
    assert_eq!(payload["messages"][2]["content"][0]["tool_use_id"], "call_read");
    assert_eq!(payload["tools"][0]["name"], "read_files");
    assert_eq!(payload["tools"][0]["input_schema"]["required"][0], "files");
}

#[test]
fn anthropic_adapter_accepts_standard_nested_tool_calls_from_server_context() {
    let payload = build_anthropic_messages_payload(
        "claude-test",
        &json!({
            "messages": [
                {"role": "system", "content": "Use tools when needed."},
                {"role": "user", "content": "Inspect environment."},
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call_env",
                        "type": "function",
                        "function": {
                            "name": "get_env",
                            "arguments": "{}"
                        }
                    }]
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_env",
                    "name": "get_env",
                    "content": "{\"workspaceRoot\":\"/home/Livenne/code/brainx\"}"
                }
            ],
            "tools": []
        }),
    )
    .expect("standard server context should build an Anthropic payload");

    assert_eq!(payload["messages"][1]["role"], "assistant");
    assert_eq!(payload["messages"][1]["content"][0]["type"], "tool_use");
    assert_eq!(payload["messages"][1]["content"][0]["id"], "call_env");
    assert_eq!(payload["messages"][1]["content"][0]["name"], "get_env");
    assert_eq!(payload["messages"][2]["content"][0]["tool_use_id"], "call_env");
}
