use crate::auth::{resolve_secret_value, ClientConfig, ClientProviderConfig};
use crate::tools::default_tool_schemas;
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::future::Future;

const DEFAULT_MODEL: &str = "stepfun-ai/step-3.7-flash";
const DEFAULT_PROVIDER_NAME: &str = "nvidia";
const DEFAULT_MODEL_KEY: &str = "nvidia:stepfun-ai/step-3.7-flash";
const DEFAULT_BASE_URL: &str = "https://integrate.api.nvidia.com/v1";

#[derive(Debug, Clone)]
pub struct ModelConfig {
    pub name: String,
    pub provider_name: String,
    pub api_key: String,
    pub model: String,
    pub base_url: String,
    pub protocol: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogEntry {
    pub key: String,
    pub provider_name: String,
    pub model: String,
    pub protocol: String,
    pub context_window: Option<u32>,
}

impl ModelConfig {
    pub fn from_env() -> Result<Self> {
        Self::from_env_values(
            std::env::var("NVIDIA_API_KEY").ok(),
            std::env::var("BRAINX_NVIDIA_MODEL").ok(),
            std::env::var("BRAINX_NVIDIA_BASE_URL").ok(),
        )
    }

    pub fn from_env_values(
        api_key: Option<String>,
        model: Option<String>,
        base_url: Option<String>,
    ) -> Result<Self> {
        let api_key = api_key
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow!("NVIDIA_API_KEY is required for model.invoke"))?;
        Ok(Self {
            name: DEFAULT_MODEL_KEY.to_string(),
            provider_name: DEFAULT_PROVIDER_NAME.to_string(),
            api_key,
            model: model
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_MODEL.to_string()),
            base_url: base_url
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
            protocol: "openai".to_string(),
        })
    }

    pub fn from_client_config(config: &ClientConfig, requested_model_name: Option<&str>) -> Result<Self> {
        let selected = requested_model_name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(DEFAULT_MODEL_KEY);
        let (provider_name, model_id) = selected
            .split_once(':')
            .ok_or_else(|| anyhow!("modelName must use provider:model format"))?;
        if provider_name.trim().is_empty() || model_id.trim().is_empty() {
            return Err(anyhow!("modelName must use provider:model format"));
        }
        let provider = config.provider_config(provider_name)?;
        Ok(Self {
            name: selected.to_string(),
            provider_name: provider.name.clone(),
            api_key: resolve_api_key(&provider.api_key)?,
            model: model_id.to_string(),
            base_url: provider.base_url.clone(),
            protocol: provider.protocol.clone(),
        })
    }
}

pub async fn discover_provider_models(
    provider: &ClientProviderConfig,
    context_overrides: &HashMap<String, u32>,
) -> Result<Vec<ModelCatalogEntry>> {
    let api_key = resolve_api_key(&provider.api_key)?;
    let http = Client::new();
    let url = format!("{}/models", provider.base_url.trim_end_matches('/'));
    let mut request = http.get(url);
    if provider.protocol == "anthropic" {
        request = request
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01");
    } else {
        request = request.bearer_auth(&api_key);
    }
    let response = request
        .send()
        .await
        .context("failed to list provider models")?;
    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read provider models response")?;
    if !status.is_success() {
        return Err(anyhow!(
            "provider models returned HTTP {}: {}",
            status.as_u16(),
            response_excerpt(&body, &api_key)
        ));
    }
    let payload: Value = serde_json::from_str(&body)
        .context("failed to decode provider models response")?;
    let mut models = Vec::new();
    if let Some(items) = payload.get("data").and_then(Value::as_array) {
        for item in items {
            let Some(model_id) = item.get("id").and_then(Value::as_str).filter(|value| !value.trim().is_empty()) else {
                continue;
            };
            models.push(ModelCatalogEntry {
                key: format!("{}:{}", provider.name, model_id),
                provider_name: provider.name.clone(),
                model: model_id.to_string(),
                protocol: provider.protocol.clone(),
                context_window: context_overrides
                    .get(&format!("{}:{}", provider.name, model_id))
                    .copied()
                    .or_else(|| context_window_from_model_item(item)),
            });
        }
    }
    Ok(models)
}

fn context_window_from_model_item(item: &Value) -> Option<u32> {
    item.get("context_window")
        .or_else(|| item.get("contextWindow"))
        .or_else(|| item.get("max_context_length"))
        .or_else(|| item.get("max_input_tokens"))
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

#[derive(Debug, Clone)]
pub struct ModelClient {
    config: ModelConfig,
    http: Client,
}

impl ModelClient {
    pub fn new(config: ModelConfig) -> Self {
        Self {
            config,
            http: Client::new(),
        }
    }

    pub async fn invoke(&self, input: &Value) -> Result<Value> {
        let (url, payload) = match self.config.protocol.as_str() {
            "anthropic" => (
                format!("{}/messages", self.config.base_url.trim_end_matches('/')),
                build_anthropic_messages_payload(&self.config.model, input)?,
            ),
            "openai" | "" => (
                format!("{}/chat/completions", self.config.base_url.trim_end_matches('/')),
                build_openai_chat_payload(&self.config.model, input)?,
            ),
            other => return Err(anyhow!("unsupported model protocol: {other}")),
        };
        let mut request = self.http.post(url).json(&payload);
        if self.config.protocol == "anthropic" {
            request = request
                .header("x-api-key", &self.config.api_key)
                .header("anthropic-version", "2023-06-01");
        } else {
            request = request.bearer_auth(&self.config.api_key);
        }
        let response = request
            .send()
            .await
            .context("failed to call model provider")?;
        let status = response.status();
        let body = response
            .text()
            .await
            .context("failed to read model provider response")?;
        if !status.is_success() {
            return Err(anyhow!(
                "model provider returned HTTP {}: {}",
                status.as_u16(),
                response_excerpt(&body, &self.config.api_key)
            ));
        }
        let response: Value = serde_json::from_str(&body)
            .context("failed to decode model provider response")?;

        normalize_model_response(&response, &self.config.protocol)
    }

    pub async fn invoke_streaming<F, Fut>(&self, input: &Value, mut on_event: F) -> Result<Value>
    where
        F: FnMut(ModelStreamEvent) -> Fut,
        Fut: Future<Output = Result<()>>,
    {
        let (url, payload) = match self.config.protocol.as_str() {
            "anthropic" => (
                format!("{}/messages", self.config.base_url.trim_end_matches('/')),
                build_anthropic_messages_payload_with_stream(&self.config.model, input, true)?,
            ),
            "openai" | "" => (
                format!("{}/chat/completions", self.config.base_url.trim_end_matches('/')),
                build_openai_chat_payload_with_stream(&self.config.model, input, true)?,
            ),
            other => return Err(anyhow!("unsupported model protocol: {other}")),
        };
        let mut request = self.http.post(url).json(&payload);
        if self.config.protocol == "anthropic" {
            request = request
                .header("x-api-key", &self.config.api_key)
                .header("anthropic-version", "2023-06-01");
        } else {
            request = request.bearer_auth(&self.config.api_key);
        }
        let mut response = request
            .send()
            .await
            .context("failed to call model provider")?;
        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .context("failed to read model provider response")?;
            return Err(anyhow!(
                "model provider returned HTTP {}: {}",
                status.as_u16(),
                response_excerpt(&body, &self.config.api_key)
            ));
        }
        let is_event_stream = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.contains("text/event-stream"))
            .unwrap_or(false);
        if !is_event_stream {
            let body = response
                .text()
                .await
                .context("failed to read model provider response")?;
            if looks_like_sse(&body) {
                let mut parser = StreamResponseBuilder::new(&self.config.protocol);
                for event in push_sse_text(&mut parser, &body)? {
                    on_event(event).await?;
                }
                return parser.finish();
            }
            let response: Value = serde_json::from_str(&body)
                .context("failed to decode model provider response")?;
            let normalized = normalize_model_response(&response, &self.config.protocol)?;
            if let Some(content) = normalized
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(Value::as_str)
                .filter(|content| !content.is_empty())
            {
                on_event(ModelStreamEvent {
                    event_type: "assistant_delta".to_string(),
                    content_delta: content.to_string(),
                    payload: json!({"protocol": self.config.protocol}),
                })
                .await?;
            }
            return Ok(normalized);
        }

        let mut parser = StreamResponseBuilder::new(&self.config.protocol);
        let mut buffer = String::new();
        while let Some(chunk) = response.chunk().await.context("failed to read model provider stream")? {
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(index) = buffer.find("\n\n") {
                let frame = buffer[..index].to_string();
                buffer = buffer[index + 2..].to_string();
                for event in parser.push_sse_frame(&frame)? {
                    on_event(event).await?;
                }
            }
        }
        if !buffer.trim().is_empty() {
            for event in parser.push_sse_frame(&buffer)? {
                on_event(event).await?;
            }
        }
        parser.finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelStreamEvent {
    pub event_type: String,
    pub content_delta: String,
    pub payload: Value,
}

fn response_excerpt(body: &str, api_key: &str) -> String {
    let redacted = if api_key.len() >= 8 {
        body.replace(api_key, "<redacted>")
    } else {
        body.to_string()
    };
    let max_chars = 2_000;
    if redacted.chars().count() <= max_chars {
        return redacted;
    }
    let mut excerpt = redacted.chars().take(max_chars).collect::<String>();
    excerpt.push_str("...<truncated>");
    excerpt
}

fn resolve_api_key(value: &str) -> Result<String> {
    resolve_secret_value(value, "model.invoke")
}

pub fn build_openai_chat_payload(model: &str, input: &Value) -> Result<Value> {
    build_openai_chat_payload_with_stream(model, input, false)
}

fn build_openai_chat_payload_with_stream(model: &str, input: &Value, stream: bool) -> Result<Value> {
    let messages = input
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("model.invoke requires input.messages"))?
        .iter()
        .map(normalize_outgoing_message)
        .collect::<Result<Vec<_>>>()?;
    let tools = tools_from_input(input);

    let mut payload = json!({
        "model": model,
        "messages": messages,
    });
    if !tools.is_empty() {
        payload["tools"] = Value::Array(tools);
        payload["tool_choice"] = json!("auto");
    }
    if stream {
        payload["stream"] = json!(true);
    }
    if model_supports_enable_thinking(model) {
        payload["chat_template_kwargs"] = json!({ "enable_thinking": true });
    }
    Ok(payload)
}

fn model_supports_enable_thinking(model: &str) -> bool {
    let normalized = model.to_lowercase();
    normalized.contains("stepfun-ai/step-") || normalized.contains("step-3.7")
}

pub fn build_anthropic_messages_payload(model: &str, input: &Value) -> Result<Value> {
    build_anthropic_messages_payload_with_stream(model, input, false)
}

fn build_anthropic_messages_payload_with_stream(model: &str, input: &Value, stream: bool) -> Result<Value> {
    let source_messages = input
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("model.invoke requires input.messages"))?;
    let mut system_parts = Vec::new();
    let mut messages = Vec::new();

    for message in source_messages {
        let object = message
            .as_object()
            .ok_or_else(|| anyhow!("model message must be an object"))?;
        let role = object
            .get("role")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("model message requires role"))?;
        match role {
            "system" => system_parts.push(string_content(object.get("content"))),
            "user" => messages.push(json!({
                "role": "user",
                "content": anthropic_user_content(object.get("content"))?
            })),
            "assistant" => messages.push(json!({
                "role": "assistant",
                "content": anthropic_assistant_content(object)?
            })),
            "tool" => messages.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_call_id(object).unwrap_or_default(),
                    "content": string_content(object.get("content"))
                }]
            })),
            other => return Err(anyhow!("unsupported model message role for anthropic: {other}")),
        }
    }

    let tools = tools_from_input(input)
        .iter()
        .map(openai_tool_to_anthropic)
        .collect::<Result<Vec<_>>>()?;

    let mut payload = json!({
        "model": model,
        "max_tokens": 4096,
        "messages": messages,
    });
    let system = system_parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if !system.is_empty() {
        payload["system"] = json!(system);
    }
    if !tools.is_empty() {
        payload["tools"] = Value::Array(tools);
    }
    if stream {
        payload["stream"] = json!(true);
    }
    Ok(payload)
}

fn normalize_outgoing_message(message: &Value) -> Result<Value> {
    let object = message
        .as_object()
        .ok_or_else(|| anyhow!("model message must be an object"))?;
    let mut normalized = Map::new();
    let role = object
        .get("role")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("model message requires role"))?;
    normalized.insert("role".to_string(), json!(role));
    normalized.insert(
        "content".to_string(),
        object.get("content").cloned().unwrap_or_else(|| json!("")),
    );
    if let Some(name) = object.get("name") {
        normalized.insert("name".to_string(), name.clone());
    }
    if let Some(tool_call_id) = object.get("toolCallId").or_else(|| object.get("tool_call_id")) {
        normalized.insert("tool_call_id".to_string(), tool_call_id.clone());
    }
    if let Some(tool_calls) = object.get("toolCalls").or_else(|| object.get("tool_calls")) {
        normalized.insert("tool_calls".to_string(), normalize_outgoing_tool_calls(tool_calls)?);
    }
    Ok(Value::Object(normalized))
}

fn tools_from_input(input: &Value) -> Vec<Value> {
    match input.get("tools") {
        Some(Value::Array(tools)) => tools.clone(),
        Some(_) => Vec::new(),
        None => default_tool_schemas(),
    }
}

fn anthropic_assistant_content(object: &Map<String, Value>) -> Result<Value> {
    let tool_calls = object.get("toolCalls").or_else(|| object.get("tool_calls"));
    if let Some(tool_calls) = tool_calls {
        let calls = tool_calls
            .as_array()
            .ok_or_else(|| anyhow!("toolCalls must be an array"))?;
        let mut blocks = Vec::new();
        let text = string_content(object.get("content"));
        if !text.is_empty() {
            blocks.push(json!({"type": "text", "text": text}));
        }
        for call in calls {
            let call = call
                .as_object()
                .ok_or_else(|| anyhow!("tool call must be an object"))?;
            let id = call.get("id").and_then(Value::as_str).unwrap_or("");
            let name = outgoing_tool_call_name(call)?;
            let input = outgoing_tool_call_arguments(call)
                .map(|arguments| arguments_to_value(&arguments))
                .unwrap_or_else(|| json!({}));
            blocks.push(json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input
            }));
        }
        return Ok(Value::Array(blocks));
    }
    Ok(json!(string_content(object.get("content"))))
}

fn anthropic_user_content(value: Option<&Value>) -> Result<Value> {
    let Some(Value::Array(parts)) = value else {
        return Ok(json!(string_content(value)));
    };
    let mut converted = Vec::new();
    for part in parts {
        let object = part
            .as_object()
            .ok_or_else(|| anyhow!("message content part must be an object"))?;
        match object.get("type").and_then(Value::as_str).unwrap_or("") {
            "text" => converted.push(json!({
                "type": "text",
                "text": object.get("text").and_then(Value::as_str).unwrap_or("")
            })),
            "image_url" => {
                let url = object
                    .get("image_url")
                    .and_then(Value::as_object)
                    .and_then(|image| image.get("url"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("image_url content part requires image_url.url"))?;
                let (media_type, data) = parse_data_url(url)?;
                converted.push(json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": data
                    }
                }));
            }
            other => return Err(anyhow!("unsupported user content part type for anthropic: {other}")),
        }
    }
    Ok(Value::Array(converted))
}

fn parse_data_url(url: &str) -> Result<(String, String)> {
    let (header, data) = url
        .split_once(',')
        .ok_or_else(|| anyhow!("image_url must be a data URL"))?;
    let media_type = header
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .ok_or_else(|| anyhow!("image_url must use base64 data URL format"))?;
    Ok((media_type.to_string(), data.to_string()))
}

fn openai_tool_to_anthropic(tool: &Value) -> Result<Value> {
    let object = tool
        .as_object()
        .ok_or_else(|| anyhow!("tool must be an object"))?;
    let function = object
        .get("function")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("tool requires function"))?;
    let name = function
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("tool function requires name"))?;
    Ok(json!({
        "name": name,
        "description": string_content(function.get("description")),
        "input_schema": function.get("parameters").cloned().unwrap_or_else(|| json!({"type": "object"}))
    }))
}

fn tool_call_id(object: &Map<String, Value>) -> Option<String> {
    object
        .get("toolCallId")
        .or_else(|| object.get("tool_call_id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn string_content(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn first_reasoning_value(object: &Value) -> Option<String> {
    ["reasoning_content", "reasoning_delta", "reasoning", "thinking"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(ToString::to_string)
}

fn normalize_outgoing_tool_calls(tool_calls: &Value) -> Result<Value> {
    let calls = tool_calls
        .as_array()
        .ok_or_else(|| anyhow!("toolCalls must be an array"))?;
    let normalized = calls
        .iter()
        .map(|call| {
            let object = call
                .as_object()
                .ok_or_else(|| anyhow!("tool call must be an object"))?;
            let id = object.get("id").cloned().unwrap_or_else(|| json!(""));
            let name = outgoing_tool_call_name(object)?;
            let arguments = outgoing_tool_call_arguments(object).unwrap_or_else(|| json!({}));
            Ok(json!({
                "id": id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": arguments_to_string(&arguments)
                }
            }))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Value::Array(normalized))
}

fn outgoing_tool_call_function(object: &Map<String, Value>) -> Option<&Map<String, Value>> {
    object.get("function").and_then(Value::as_object)
}

fn outgoing_tool_call_name(object: &Map<String, Value>) -> Result<&str> {
    object
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| outgoing_tool_call_function(object).and_then(|function| function.get("name")).and_then(Value::as_str))
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| anyhow!("tool call requires non-empty name"))
}

fn outgoing_tool_call_arguments(object: &Map<String, Value>) -> Option<Value> {
    object
        .get("arguments")
        .cloned()
        .or_else(|| outgoing_tool_call_function(object).and_then(|function| function.get("arguments")).cloned())
}

fn normalize_model_response(response: &Value, protocol: &str) -> Result<Value> {
    if protocol == "anthropic" {
        return normalize_anthropic_response(response);
    }
    let message = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .ok_or_else(|| anyhow!("NVIDIA response did not include choices[0].message"))?;

    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("assistant");
    let content = incoming_assistant_text(message.get("content"));
    let thinking = first_reasoning_value(message).unwrap_or_default();
    let mut tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| calls.iter().map(normalize_incoming_tool_call).collect::<Result<Vec<_>>>())
        .transpose()?
        .unwrap_or_default();
    if let Some(function_call) = message.get("function_call").filter(|value| value.is_object()) {
        tool_calls.push(normalize_legacy_function_call(function_call)?);
    }
    tool_calls.extend(incoming_content_tool_calls(message.get("content"))?);

    Ok(json!({
        "message": {
            "role": role,
            "content": content,
            "thinking": thinking,
            "toolCalls": tool_calls
        },
        "model": response.get("model").cloned().unwrap_or_else(|| json!(null)),
        "usage": response.get("usage").cloned().unwrap_or_else(|| json!({}))
    }))
}

fn normalize_anthropic_response(response: &Value) -> Result<Value> {
    let content = response
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut text_parts = Vec::new();
    let mut thinking_parts = Vec::new();
    let mut tool_calls = Vec::new();
    for block in content {
        let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
        if block_type == "text" {
            if let Some(text) = block.get("text").and_then(Value::as_str) {
                text_parts.push(text.to_string());
            }
        }
        if block_type == "thinking" {
            if let Some(thinking) = block.get("thinking").and_then(Value::as_str) {
                thinking_parts.push(thinking.to_string());
            }
        }
        if block_type == "tool_use" {
            tool_calls.push(json!({
                "id": block.get("id").and_then(Value::as_str).unwrap_or(""),
                "name": block.get("name").and_then(Value::as_str).unwrap_or(""),
                "arguments": block.get("input").cloned().unwrap_or_else(|| json!({}))
            }));
        }
    }
    Ok(json!({
        "message": {
            "role": "assistant",
            "content": text_parts.join("\n\n"),
            "thinking": thinking_parts.join("\n\n"),
            "toolCalls": tool_calls
        },
        "model": response.get("model").cloned().unwrap_or_else(|| json!(null)),
        "usage": response.get("usage").cloned().unwrap_or_else(|| json!({}))
    }))
}

fn incoming_assistant_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(incoming_content_text_part)
            .collect::<Vec<_>>()
            .join("\n\n"),
        Some(value @ Value::Object(_)) => incoming_content_text_part(value).unwrap_or_default(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn incoming_content_parts(value: &Value) -> Vec<&Value> {
    match value {
        Value::Array(parts) => parts.iter().collect(),
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    }
}

fn incoming_stream_content_text_parts(value: &Value) -> Vec<String> {
    incoming_content_parts(value)
        .into_iter()
        .filter_map(incoming_content_text_part)
        .collect()
}

fn incoming_content_text_part(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    let block_type = object.get("type").and_then(Value::as_str).unwrap_or("");
    if matches!(block_type, "text" | "output_text" | "message") || object.contains_key("text") {
        return object
            .get("text")
            .or_else(|| object.get("content"))
            .and_then(Value::as_str)
            .map(ToString::to_string);
    }
    None
}

fn incoming_content_tool_calls(value: Option<&Value>) -> Result<Vec<Value>> {
    match value {
        Some(Value::Array(parts)) => parts.iter().filter_map(normalize_content_tool_call).collect(),
        Some(value @ Value::Object(_)) => match normalize_content_tool_call(value) {
            Some(tool_call) => Ok(vec![tool_call?]),
            None => Ok(Vec::new()),
        },
        _ => Ok(Vec::new()),
    }
}

fn normalize_content_tool_call(value: &Value) -> Option<Result<Value>> {
    let object = value.as_object()?;
    let block_type = object.get("type").and_then(Value::as_str).unwrap_or("");
    let is_tool = matches!(
        block_type,
        "tool_call" | "function_call" | "tool_use" | "custom_tool_call" | "custom"
    ) || object.contains_key("function")
        || object.contains_key("functionCall")
        || object.contains_key("toolName")
        || object.contains_key("tool_name")
        || object.contains_key("function_name");
    is_tool.then(|| normalize_incoming_tool_call(value))
}

fn normalize_incoming_tool_call(call: &Value) -> Result<Value> {
    let object = call
        .as_object()
        .ok_or_else(|| anyhow!("tool call must be an object"))?;
    let name = incoming_tool_call_name(object)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| anyhow!("tool call is missing a function name"))?;
    Ok(json!({
        "id": incoming_tool_call_id(object),
        "name": name,
        "arguments": incoming_tool_call_arguments(object),
    }))
}

fn normalize_legacy_function_call(call: &Value) -> Result<Value> {
    let object = call
        .as_object()
        .ok_or_else(|| anyhow!("function_call must be an object"))?;
    let name = incoming_tool_call_name(object)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| anyhow!("tool call is missing a function name"))?;
    Ok(json!({
        "id": call.get("id").and_then(Value::as_str).unwrap_or("call_function_call"),
        "name": name,
        "arguments": incoming_tool_call_arguments(object),
    }))
}

fn incoming_tool_call_id(object: &Map<String, Value>) -> String {
    object
        .get("id")
        .or_else(|| object.get("tool_call_id"))
        .or_else(|| object.get("toolCallId"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn incoming_tool_call_name(object: &Map<String, Value>) -> Option<String> {
    string_field(object, &["name", "toolName", "tool_name", "function_name"])
        .or_else(|| nested_object(object, "function").and_then(|function| string_field(function, &["name", "function_name"])))
        .or_else(|| nested_object(object, "functionCall").and_then(|function| string_field(function, &["name", "function_name"])))
        .or_else(|| {
            incoming_argument_candidates(object)
                .into_iter()
                .map(|arguments| incoming_arguments_to_value(Some(arguments)))
                .find_map(|arguments| {
                    arguments
                        .as_object()
                        .and_then(|argument_object| string_field(argument_object, &["name", "toolName", "tool_name", "function_name"]))
                })
        })
}

fn incoming_tool_call_arguments(object: &Map<String, Value>) -> Value {
    let arguments = incoming_argument_candidates(object)
        .into_iter()
        .next()
        .map(|value| incoming_arguments_to_value(Some(value)))
        .unwrap_or_else(|| json!({}));
    unwrap_arguments_envelope(arguments)
}

fn incoming_argument_candidates<'a>(object: &'a Map<String, Value>) -> Vec<&'a Value> {
    let mut candidates = Vec::new();
    if let Some(function) = nested_object(object, "function") {
        if let Some(arguments) = function.get("arguments").or_else(|| function.get("input")) {
            candidates.push(arguments);
        }
    }
    if let Some(function) = nested_object(object, "functionCall") {
        if let Some(arguments) = function.get("arguments").or_else(|| function.get("input")) {
            candidates.push(arguments);
        }
    }
    for key in ["arguments", "input", "parameters", "params"] {
        if let Some(value) = object.get(key) {
            candidates.push(value);
        }
    }
    candidates
}

fn unwrap_arguments_envelope(arguments: Value) -> Value {
    let Some(object) = arguments.as_object() else {
        return arguments;
    };
    let has_name = string_field(object, &["name", "toolName", "tool_name", "function_name"]).is_some();
    if !has_name {
        return arguments;
    }
    object
        .get("arguments")
        .or_else(|| object.get("input"))
        .or_else(|| object.get("parameters"))
        .or_else(|| object.get("params"))
        .cloned()
        .unwrap_or_else(|| json!({}))
}

fn nested_object<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a Map<String, Value>> {
    object.get(key).and_then(Value::as_object)
}

fn string_field(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(ToString::to_string)
}

fn incoming_arguments_to_value(arguments: Option<&Value>) -> Value {
    match arguments {
        Some(Value::String(raw)) => parse_arguments(raw),
        Some(Value::Null) | None => json!({}),
        Some(value) => value.clone(),
    }
}

fn parse_arguments(raw: &str) -> Value {
    if raw.trim().is_empty() {
        return json!({});
    }
    serde_json::from_str(raw).unwrap_or_else(|_| json!({ "raw": raw }))
}

fn arguments_to_string(arguments: &Value) -> String {
    arguments
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| serde_json::to_string(arguments).unwrap_or_else(|_| "{}".to_string()))
}

fn arguments_to_value(arguments: &Value) -> Value {
    arguments
        .as_str()
        .map(parse_arguments)
        .unwrap_or_else(|| arguments.clone())
}

#[derive(Debug, Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

struct StreamResponseBuilder {
    protocol: String,
    model: Value,
    usage: Value,
    content: String,
    thinking: String,
    tool_calls: BTreeMap<usize, ToolCallAccumulator>,
}

fn looks_like_sse(body: &str) -> bool {
    let trimmed = body.trim_start();
    trimmed.starts_with("data:") || trimmed.starts_with("event:")
}

fn push_sse_text(parser: &mut StreamResponseBuilder, body: &str) -> Result<Vec<ModelStreamEvent>> {
    let mut events = Vec::new();
    for frame in body.split("\n\n") {
        if frame.trim().is_empty() {
            continue;
        }
        events.extend(parser.push_sse_frame(frame)?);
    }
    Ok(events)
}

impl StreamResponseBuilder {
    fn new(protocol: &str) -> Self {
        Self {
            protocol: protocol.to_string(),
            model: Value::Null,
            usage: json!({}),
            content: String::new(),
            thinking: String::new(),
            tool_calls: BTreeMap::new(),
        }
    }

    fn push_sse_frame(&mut self, frame: &str) -> Result<Vec<ModelStreamEvent>> {
        let data = frame
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.trim().is_empty() || data.trim() == "[DONE]" {
            return Ok(Vec::new());
        }
        let value: Value = serde_json::from_str(&data).context("failed to decode model stream event")?;
        if self.protocol == "anthropic" {
            self.apply_anthropic_event(&value)
        } else {
            self.apply_openai_chunk(&value)
        }
    }

    fn apply_openai_chunk(&mut self, chunk: &Value) -> Result<Vec<ModelStreamEvent>> {
        if !chunk.get("model").unwrap_or(&Value::Null).is_null() {
            self.model = chunk.get("model").cloned().unwrap_or(Value::Null);
        }
        if !chunk.get("usage").unwrap_or(&Value::Null).is_null() {
            self.usage = chunk.get("usage").cloned().unwrap_or_else(|| json!({}));
        }
        let mut events = Vec::new();
        let choices = chunk
            .get("choices")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for choice in choices {
            let delta = choice.get("delta").unwrap_or(&Value::Null);
            if let Some(thinking) = first_reasoning_value(delta) {
                if !thinking.is_empty() {
                    self.thinking.push_str(&thinking);
                    events.push(ModelStreamEvent {
                        event_type: "assistant_thinking_delta".to_string(),
                        content_delta: thinking,
                        payload: json!({"protocol": "openai"}),
                    });
                }
            }
            if let Some(text) = delta.get("content").and_then(Value::as_str) {
                if !text.is_empty() {
                    self.content.push_str(text);
                    events.push(ModelStreamEvent {
                        event_type: "assistant_delta".to_string(),
                        content_delta: text.to_string(),
                        payload: json!({"protocol": "openai"}),
                    });
                }
            } else if let Some(content) = delta.get("content") {
                for text in incoming_stream_content_text_parts(content) {
                    if text.is_empty() {
                        continue;
                    }
                    self.content.push_str(&text);
                    events.push(ModelStreamEvent {
                        event_type: "assistant_delta".to_string(),
                        content_delta: text,
                        payload: json!({"protocol": "openai"}),
                    });
                }
                self.apply_openai_content_tool_calls(content)?;
            }
            for call in delta
                .get("tool_calls")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
            {
                let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let accumulator = self.tool_calls.entry(index).or_default();
                let call_object = call.as_object();
                if let Some(id) = call_object.and_then(|object| {
                    object
                        .get("id")
                        .or_else(|| object.get("tool_call_id"))
                        .or_else(|| object.get("toolCallId"))
                        .and_then(Value::as_str)
                }) {
                    accumulator.id = id.to_string();
                }
                if let Some(name) = call_object.and_then(incoming_tool_call_name) {
                    if !name.trim().is_empty() {
                        accumulator.name = name;
                    }
                }
                if let Some(arguments) = call_object.and_then(|object| incoming_argument_candidates(object).into_iter().next()) {
                    accumulator.arguments.push_str(&arguments_to_string(arguments));
                }
            }
        }
        Ok(events)
    }

    fn apply_openai_content_tool_calls(&mut self, content: &Value) -> Result<()> {
        for (offset, part) in incoming_content_parts(content).into_iter().enumerate() {
            let Some(tool_call) = normalize_content_tool_call(part) else {
                continue;
            };
            let normalized = tool_call?;
            let object = normalized
                .as_object()
                .ok_or_else(|| anyhow!("normalized tool call must be an object"))?;
            let index = part
                .get("index")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or_else(|| self.tool_calls.len() + offset);
            let accumulator = self.tool_calls.entry(index).or_default();
            accumulator.id = object.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            accumulator.name = object.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            accumulator.arguments = arguments_to_string(object.get("arguments").unwrap_or(&Value::Null));
        }
        Ok(())
    }

    fn apply_anthropic_event(&mut self, event: &Value) -> Result<Vec<ModelStreamEvent>> {
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        if event_type == "message_start" {
            if let Some(message) = event.get("message") {
                if !message.get("model").unwrap_or(&Value::Null).is_null() {
                    self.model = message.get("model").cloned().unwrap_or(Value::Null);
                }
                if !message.get("usage").unwrap_or(&Value::Null).is_null() {
                    self.usage = message.get("usage").cloned().unwrap_or_else(|| json!({}));
                }
            }
            return Ok(Vec::new());
        }
        if event_type == "message_delta" {
            if !event.get("usage").unwrap_or(&Value::Null).is_null() {
                self.usage = event.get("usage").cloned().unwrap_or_else(|| json!({}));
            }
            return Ok(Vec::new());
        }
        if event_type == "content_block_start" {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let block = event.get("content_block").unwrap_or(&Value::Null);
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                let accumulator = self.tool_calls.entry(index).or_default();
                accumulator.id = block.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                accumulator.name = block.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            }
            return Ok(Vec::new());
        }
        if event_type != "content_block_delta" {
            return Ok(Vec::new());
        }
        let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        let delta = event.get("delta").unwrap_or(&Value::Null);
        match delta.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                let text = delta.get("text").and_then(Value::as_str).unwrap_or("");
                if text.is_empty() {
                    return Ok(Vec::new());
                }
                self.content.push_str(text);
                Ok(vec![ModelStreamEvent {
                    event_type: "assistant_delta".to_string(),
                    content_delta: text.to_string(),
                    payload: json!({"protocol": "anthropic"}),
                }])
            }
            Some("thinking_delta") => {
                let thinking = delta.get("thinking").and_then(Value::as_str).unwrap_or("");
                if thinking.is_empty() {
                    return Ok(Vec::new());
                }
                self.thinking.push_str(thinking);
                Ok(vec![ModelStreamEvent {
                    event_type: "assistant_thinking_delta".to_string(),
                    content_delta: thinking.to_string(),
                    payload: json!({"protocol": "anthropic"}),
                }])
            }
            Some("input_json_delta") => {
                let partial_json = delta.get("partial_json").and_then(Value::as_str).unwrap_or("");
                self.tool_calls.entry(index).or_default().arguments.push_str(partial_json);
                Ok(Vec::new())
            }
            _ => Ok(Vec::new()),
        }
    }

    fn finish(self) -> Result<Value> {
        let tool_calls = self
            .tool_calls
            .into_values()
            .map(|call| {
                let parsed_arguments = parse_arguments(&call.arguments);
                let arguments = unwrap_arguments_envelope(parsed_arguments.clone());
                let name = if call.name.trim().is_empty() {
                    parsed_arguments
                        .as_object()
                        .and_then(|object| string_field(object, &["name", "toolName", "tool_name", "function_name"]))
                        .unwrap_or_default()
                } else {
                    call.name
                };
                if name.trim().is_empty() {
                    return Err(anyhow!("tool call is missing a function name"));
                }
                Ok(json!({
                    "id": call.id,
                    "name": name,
                    "arguments": arguments,
                }))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(json!({
            "message": {
                "role": "assistant",
                "content": self.content,
                "thinking": self.thinking,
                "toolCalls": tool_calls
            },
            "model": self.model,
            "usage": self.usage
        }))
    }
}
