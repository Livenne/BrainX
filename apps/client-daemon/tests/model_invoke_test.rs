use brainx_client_daemon::auth::{ClientConfig, ClientProviderConfig};
use brainx_client_daemon::model::{
    build_anthropic_messages_payload, build_openai_chat_payload, discover_provider_models, ModelClient, ModelConfig,
};
use brainx_client_daemon::tools::default_tool_schemas;
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn model_discovery_lists_openai_compatible_provider_models() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": [
                {"id": "stepfun-ai/step-3.7-flash", "context_window": 128000},
                {"id": "openai/gpt-test"}
            ]
        })))
        .mount(&server)
        .await;
    let provider = ClientProviderConfig {
        name: "nvidia".to_string(),
        base_url: format!("{}/v1", server.uri()),
        api_key: "literal:test-api-key".to_string(),
        protocol: "openai".to_string(),
    };

    let overrides = Default::default();
    let models = discover_provider_models(&provider, &overrides).await.unwrap();

    assert_eq!(models.len(), 2);
    assert_eq!(models[0].key, "nvidia:stepfun-ai/step-3.7-flash");
    assert_eq!(models[0].provider_name, "nvidia");
    assert_eq!(models[0].model, "stepfun-ai/step-3.7-flash");
    assert_eq!(models[0].protocol, "openai");
    assert_eq!(models[0].context_window, Some(128000));
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests[0].headers.get("authorization").unwrap().to_str().unwrap(),
        "Bearer test-api-key"
    );
}

#[tokio::test]
async fn model_discovery_applies_configured_context_window_overrides() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": [
                {"id": "stepfun-ai/step-3.7-flash"},
                {"id": "gpt-5.5", "context_window": 128000}
            ]
        })))
        .mount(&server)
        .await;
    let provider = ClientProviderConfig {
        name: "nvidia".to_string(),
        base_url: format!("{}/v1", server.uri()),
        api_key: "literal:test-api-key".to_string(),
        protocol: "openai".to_string(),
    };
    let overrides = [
        ("nvidia:stepfun-ai/step-3.7-flash".to_string(), 256_000),
        ("nvidia:gpt-5.5".to_string(), 1_050_000),
    ]
    .into_iter()
    .collect();

    let models = discover_provider_models(&provider, &overrides).await.unwrap();

    assert_eq!(models[0].context_window, Some(256_000));
    assert_eq!(models[1].context_window, Some(1_050_000));
}

#[tokio::test]
async fn model_discovery_lists_anthropic_provider_models() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": [
                {"id": "claude-test", "max_input_tokens": 200000}
            ]
        })))
        .mount(&server)
        .await;
    let provider = ClientProviderConfig {
        name: "anthropic".to_string(),
        base_url: format!("{}/v1", server.uri()),
        api_key: "literal:anthropic-key".to_string(),
        protocol: "anthropic".to_string(),
    };

    let overrides = Default::default();
    let models = discover_provider_models(&provider, &overrides).await.unwrap();

    assert_eq!(models[0].key, "anthropic:claude-test");
    assert_eq!(models[0].context_window, Some(200000));
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests[0].headers.get("x-api-key").unwrap().to_str().unwrap(), "anthropic-key");
}

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
        name: "test-openai".to_string(),
        provider_name: "test".to_string(),
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
async fn model_invoke_accepts_openai_tool_call_argument_variants() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl_1",
            "model": "gpt-5.5",
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_object_args",
                            "type": "function",
                            "function": {
                                "name": "read_files",
                                "arguments": {"files": [{"path": "README.md"}]}
                            }
                        },
                        {
                            "id": "call_root_args",
                            "type": "function",
                            "name": "search_workspace",
                            "arguments": {"query": "toolcall"}
                        }
                    ]
                }
            }],
            "usage": {"total_tokens": 12}
        })))
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "gpt-5.5".to_string(),
        provider_name: "gpt".to_string(),
        api_key: "test-api-key".to_string(),
        model: "gpt-5.5".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });
    let result = client
        .invoke(&json!({
            "messages": [{"role": "user", "content": "inspect"}],
            "tools": []
        }))
        .await
        .expect("variant tool calls should normalize");

    assert_eq!(result["message"]["toolCalls"][0]["name"], "read_files");
    assert_eq!(result["message"]["toolCalls"][0]["arguments"], json!({"files": [{"path": "README.md"}]}));
    assert_eq!(result["message"]["toolCalls"][1]["name"], "search_workspace");
    assert_eq!(result["message"]["toolCalls"][1]["arguments"], json!({"query": "toolcall"}));
}

#[tokio::test]
async fn model_invoke_normalizes_gpt55_structured_content_tool_calls() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl_gpt55_tool",
            "model": "gpt-5.5",
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_call",
                        "id": "call_env",
                        "function_name": "get_env",
                        "arguments": {}
                    }]
                }
            }],
            "usage": {"total_tokens": 18}
        })))
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "gpt-5.5".to_string(),
        provider_name: "gpt".to_string(),
        api_key: "test-api-key".to_string(),
        model: "gpt-5.5".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });
    let result = client
        .invoke(&json!({
            "messages": [{"role": "user", "content": "env"}],
            "tools": []
        }))
        .await
        .expect("structured content tool call should normalize");

    assert_eq!(result["message"]["content"], "");
    assert_eq!(result["message"]["toolCalls"][0]["id"], "call_env");
    assert_eq!(result["message"]["toolCalls"][0]["name"], "get_env");
    assert_eq!(result["message"]["toolCalls"][0]["arguments"], json!({}));
}

#[tokio::test]
async fn model_invoke_rejects_unrecognized_tool_calls_without_empty_name_execution() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl_bad_tool",
            "model": "gpt-5.5",
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call_empty",
                        "type": "function",
                        "function": {
                            "arguments": "{}"
                        }
                    }]
                }
            }]
        })))
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "gpt-5.5".to_string(),
        provider_name: "gpt".to_string(),
        api_key: "test-api-key".to_string(),
        model: "gpt-5.5".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });
    let error = client
        .invoke(&json!({
            "messages": [{"role": "user", "content": "env"}],
            "tools": []
        }))
        .await
        .expect_err("empty-name tool call should fail before tool execution");

    assert!(error.to_string().contains("tool call is missing a function name"));
}

#[tokio::test]
async fn model_invoke_accepts_legacy_openai_function_call() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": "gpt-5.5",
            "choices": [{
                "finish_reason": "function_call",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "function_call": {
                        "name": "get_env",
                        "arguments": "{}"
                    }
                }
            }]
        })))
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "gpt-5.5".to_string(),
        provider_name: "gpt".to_string(),
        api_key: "test-api-key".to_string(),
        model: "gpt-5.5".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });
    let result = client
        .invoke(&json!({
            "messages": [{"role": "user", "content": "env"}],
            "tools": []
        }))
        .await
        .expect("legacy function_call should normalize");

    assert_eq!(result["message"]["toolCalls"][0]["name"], "get_env");
    assert_eq!(result["message"]["toolCalls"][0]["arguments"], json!({}));
}

#[tokio::test]
async fn model_invoke_streaming_emits_openai_text_deltas_and_final_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    concat!(
                        "data: {\"model\":\"test-model\",\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"Hel\"}}]}\n\n",
                        "data: {\"model\":\"test-model\",\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
                        "data: [DONE]\n\n"
                    )
                ),
        )
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "test-openai".to_string(),
        provider_name: "test".to_string(),
        api_key: "test-api-key".to_string(),
        model: "test-model".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });
    let mut deltas = Vec::new();

    let result = client
        .invoke_streaming(
            &json!({
                "messages": [{"role": "user", "content": "hello"}],
                "tools": []
            }),
            |event| {
                deltas.push(event.content_delta);
                std::future::ready(Ok(()))
            },
        )
        .await
        .expect("streaming invoke should succeed");

    assert_eq!(deltas, vec!["Hel", "lo"]);
    assert_eq!(result["message"]["content"], "Hello");

    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["stream"], true);
}

#[tokio::test]
async fn model_invoke_streaming_emits_openai_reasoning_deltas() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    concat!(
                        "data: {\"model\":\"test-model\",\"choices\":[{\"delta\":{\"reasoning_content\":\"Need\"}}]}\n\n",
                        "data: {\"model\":\"test-model\",\"choices\":[{\"delta\":{\"reasoning_content\":\" tools\",\"content\":\"Done\"}}]}\n\n",
                        "data: [DONE]\n\n"
                    )
                ),
        )
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "test-openai".to_string(),
        provider_name: "test".to_string(),
        api_key: "test-api-key".to_string(),
        model: "test-model".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });
    let mut events = Vec::new();

    let result = client
        .invoke_streaming(
            &json!({
                "messages": [{"role": "user", "content": "hello"}],
                "tools": []
            }),
            |event| {
                events.push((event.event_type, event.content_delta));
                std::future::ready(Ok(()))
            },
        )
        .await
        .expect("streaming invoke should succeed");

    assert_eq!(
        events,
        vec![
            ("assistant_thinking_delta".to_string(), "Need".to_string()),
            ("assistant_thinking_delta".to_string(), " tools".to_string()),
            ("assistant_delta".to_string(), "Done".to_string())
        ]
    );
    assert_eq!(result["message"]["content"], "Done");
    assert_eq!(result["message"]["thinking"], "Need tools");
}

#[tokio::test]
async fn model_invoke_streaming_normalizes_openai_tool_call_deltas() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    concat!(
                        "data: {\"model\":\"test-model\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_read\",\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\"}}]}}]}\n\n",
                        "data: {\"model\":\"test-model\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"README.md\\\"}\"}}]}}]}\n\n",
                        "data: [DONE]\n\n"
                    )
                ),
        )
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "test-openai".to_string(),
        provider_name: "test".to_string(),
        api_key: "test-api-key".to_string(),
        model: "test-model".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });

    let result = client
        .invoke_streaming(
            &json!({
                "messages": [{"role": "user", "content": "read"}],
                "tools": []
            }),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect("streaming invoke should succeed");

    assert_eq!(result["message"]["toolCalls"][0]["id"], "call_read");
    assert_eq!(result["message"]["toolCalls"][0]["name"], "read_file");
    assert_eq!(result["message"]["toolCalls"][0]["arguments"], json!({"path": "README.md"}));
}

#[tokio::test]
async fn model_invoke_streaming_normalizes_openai_tool_call_object_argument_deltas() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    concat!(
                        "data: {\"model\":\"gpt-5.5\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_search\",\"type\":\"function\",\"function\":{\"name\":\"search_workspace\",\"arguments\":{\"query\":\"toolcall\"}}}]}}]}\n\n",
                        "data: [DONE]\n\n"
                    )
                ),
        )
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "gpt-5.5".to_string(),
        provider_name: "gpt".to_string(),
        api_key: "test-api-key".to_string(),
        model: "gpt-5.5".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });

    let result = client
        .invoke_streaming(
            &json!({
                "messages": [{"role": "user", "content": "search"}],
                "tools": []
            }),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect("streaming object arguments should normalize");

    assert_eq!(result["message"]["toolCalls"][0]["name"], "search_workspace");
    assert_eq!(result["message"]["toolCalls"][0]["arguments"], json!({"query": "toolcall"}));
}

#[tokio::test]
async fn model_invoke_streaming_normalizes_gpt55_content_tool_call_deltas() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    concat!(
                        "data: {\"model\":\"gpt-5.5\",\"choices\":[{\"delta\":{\"content\":[{\"type\":\"tool_call\",\"id\":\"call_env\",\"function_name\":\"get_env\",\"arguments\":{}}]}}]}\n\n",
                        "data: [DONE]\n\n"
                    )
                ),
        )
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "gpt-5.5".to_string(),
        provider_name: "gpt".to_string(),
        api_key: "test-api-key".to_string(),
        model: "gpt-5.5".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });

    let result = client
        .invoke_streaming(
            &json!({
                "messages": [{"role": "user", "content": "env"}],
                "tools": []
            }),
            |_| std::future::ready(Ok(())),
        )
        .await
        .expect("streaming content tool call should normalize");

    assert_eq!(result["message"]["content"], "");
    assert_eq!(result["message"]["toolCalls"][0]["id"], "call_env");
    assert_eq!(result["message"]["toolCalls"][0]["name"], "get_env");
    assert_eq!(result["message"]["toolCalls"][0]["arguments"], json!({}));
}

#[tokio::test]
async fn model_invoke_streaming_emits_anthropic_text_deltas_and_final_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    concat!(
                        "event: message_start\n",
                        "data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-test\",\"usage\":{\"input_tokens\":5}}}\n\n",
                        "event: content_block_delta\n",
                        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n",
                        "event: message_delta\n",
                        "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":3}}\n\n",
                        "event: message_stop\n",
                        "data: {\"type\":\"message_stop\"}\n\n"
                    )
                ),
        )
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "test-anthropic".to_string(),
        provider_name: "anthropic".to_string(),
        api_key: "anthropic-key".to_string(),
        model: "claude-test".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "anthropic".to_string(),
    });
    let mut deltas = Vec::new();

    let result = client
        .invoke_streaming(
            &json!({
                "messages": [{"role": "user", "content": "hello"}],
                "tools": []
            }),
            |event| {
                deltas.push(event.content_delta);
                std::future::ready(Ok(()))
            },
        )
        .await
        .expect("streaming invoke should succeed");

    assert_eq!(deltas, vec!["Hi"]);
    assert_eq!(result["message"]["content"], "Hi");
    assert_eq!(result["usage"]["output_tokens"], 3);
}

#[tokio::test]
async fn model_invoke_streaming_emits_anthropic_thinking_deltas() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(
                    concat!(
                        "event: message_start\n",
                        "data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-test\"}}\n\n",
                        "event: content_block_delta\n",
                        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"Consider\"}}\n\n",
                        "event: content_block_delta\n",
                        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Answer\"}}\n\n",
                        "event: message_stop\n",
                        "data: {\"type\":\"message_stop\"}\n\n"
                    )
                ),
        )
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "test-anthropic".to_string(),
        provider_name: "anthropic".to_string(),
        api_key: "anthropic-key".to_string(),
        model: "claude-test".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "anthropic".to_string(),
    });
    let mut events = Vec::new();

    let result = client
        .invoke_streaming(
            &json!({
                "messages": [{"role": "user", "content": "hello"}],
                "tools": []
            }),
            |event| {
                events.push((event.event_type, event.content_delta));
                std::future::ready(Ok(()))
            },
        )
        .await
        .expect("streaming invoke should succeed");

    assert_eq!(
        events,
        vec![
            ("assistant_thinking_delta".to_string(), "Consider".to_string()),
            ("assistant_delta".to_string(), "Answer".to_string())
        ]
    );
    assert_eq!(result["message"]["content"], "Answer");
    assert_eq!(result["message"]["thinking"], "Consider");
}

#[tokio::test]
async fn model_invoke_injects_canonical_client_tool_schemas_when_server_omits_tools() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "chatcmpl_2",
            "model": "stepfun-ai/step-3.7-flash",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Ready",
                    "tool_calls": []
                }
            }]
        })))
        .mount(&server)
        .await;

    let client = ModelClient::new(ModelConfig {
        name: "test-openai".to_string(),
        provider_name: "test".to_string(),
        api_key: "test-api-key".to_string(),
        model: "stepfun-ai/step-3.7-flash".to_string(),
        base_url: format!("{}/v1", server.uri()),
        protocol: "openai".to_string(),
    });
    client
        .invoke(&json!({
            "messages": [{"role": "user", "content": "Inspect this project."}]
        }))
        .await
        .expect("model invoke should succeed");

    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    let tool_names = body["tools"]
        .as_array()
        .expect("tools should be injected")
        .iter()
        .map(|tool| tool["function"]["name"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();

    assert!(tool_names.contains(&"read_files".to_string()));
    assert!(tool_names.contains(&"edit_file".to_string()));
    assert!(tool_names.contains(&"terminal_spawn".to_string()));
    assert!(tool_names.contains(&"todo_create".to_string()));
    assert!(tool_names.contains(&"web_search".to_string()));
    assert!(!tool_names.contains(&"read_file".to_string()));
    assert!(!tool_names.contains(&"apply_patch".to_string()));
}

#[test]
fn default_tool_schemas_expose_only_canonical_model_visible_names() {
    let names = default_tool_schemas()
        .iter()
        .map(|tool| tool["function"]["name"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();

    assert!(names.contains(&"get_env".to_string()));
    assert!(names.contains(&"read_files".to_string()));
    assert!(names.contains(&"write_file".to_string()));
    assert!(names.contains(&"run_command".to_string()));
    assert!(names.contains(&"web_search".to_string()));
    assert!(names.contains(&"ask_user".to_string()));
    assert!(names.contains(&"terminal_list".to_string()));
    assert!(!names.contains(&"read_file".to_string()));
    assert!(!names.contains(&"background_start".to_string()));
    assert!(!names.contains(&"subagent_start".to_string()));
    assert!(!names.contains(&"branch_action".to_string()));
    assert!(!names.contains(&"skill_action".to_string()));

    let read_schema = default_tool_schemas()
        .into_iter()
        .find(|tool| tool["function"]["name"] == "read_files")
        .expect("read_files schema should be exposed");
    let description = read_schema["function"]["description"]
        .as_str()
        .expect("description");
    assert!(description.contains("Use for exact file content"));
    assert!(description.contains("list_directory"));
    assert_eq!(
        read_schema["function"]["parameters"]["properties"]["files"]["items"]["additionalProperties"],
        json!(false)
    );

    let run_schema = default_tool_schemas()
        .into_iter()
        .find(|tool| tool["function"]["name"] == "run_command")
        .expect("run_command schema should be exposed");
    let run_description = run_schema["function"]["description"]
        .as_str()
        .expect("run_command description");
    assert!(run_description.contains("short, non-interactive shell command"));
    assert!(run_description.contains("terminal_spawn"));

    let serialized = serde_json::to_string(&default_tool_schemas()).expect("schemas should serialize");
    assert!(!serialized.contains("mock web search"));
    assert!(serialized.contains("Tavily"));
    assert!(!serialized.contains("branch"));
    assert!(names.contains(&"create_skill".to_string()));
    assert!(names.contains(&"renovation_skill".to_string()));
    assert!(!names.contains(&"skill_action".to_string()));
    assert!(!serialized.contains("subagent"));
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
        name: "test-openai".to_string(),
        provider_name: "test".to_string(),
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
        device_name: "devbox".to_string(),
        installation_id: "install-test".to_string(),
        daemon_id: None,
        client_token: None,
        providers: vec![
            ClientProviderConfig {
                name: "nvidia".to_string(),
                base_url: "https://integrate.api.nvidia.com/v1".to_string(),
                api_key: "literal:test-key".to_string(),
                protocol: "openai".to_string(),
            },
            ClientProviderConfig {
                name: "anthropic".to_string(),
                base_url: "https://api.anthropic.com/v1".to_string(),
                api_key: "literal:anthropic-key".to_string(),
                protocol: "anthropic".to_string(),
            },
        ],
        web_search: None,
        model_context_windows: Default::default(),
    };

    let selected = ModelConfig::from_client_config(&config, Some("anthropic:claude-test")).unwrap();

    assert_eq!(selected.name, "anthropic:claude-test");
    assert_eq!(selected.provider_name, "anthropic");
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
fn openai_adapter_rejects_blank_tool_call_names_from_history() {
    let error = build_openai_chat_payload(
        "test-model",
        &json!({
            "messages": [
                {"role": "user", "content": "Inspect environment."},
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call_blank",
                        "type": "function",
                        "function": {
                            "name": "",
                            "arguments": "{}"
                        }
                    }]
                }
            ],
            "tools": []
        }),
    )
    .expect_err("blank persisted tool call names must not be sent back to the provider");

    assert!(error.to_string().contains("tool call requires non-empty name"));
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
fn anthropic_adapter_converts_multimodal_user_content_parts() {
    let payload = build_anthropic_messages_payload(
        "claude-test",
        &json!({
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "看看附件"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
                ]
            }],
            "tools": []
        }),
    )
    .expect("payload should be valid");

    assert_eq!(payload["messages"][0]["content"][0], json!({"type": "text", "text": "看看附件"}));
    assert_eq!(
        payload["messages"][0]["content"][1],
        json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": "AAAA"
            }
        })
    );
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
