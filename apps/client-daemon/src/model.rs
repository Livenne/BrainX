use crate::auth::ClientConfig;
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde_json::{json, Map, Value};

const DEFAULT_MODEL: &str = "stepfun-ai/step-3.7-flash";
const DEFAULT_BASE_URL: &str = "https://integrate.api.nvidia.com/v1";

#[derive(Debug, Clone)]
pub struct ModelConfig {
    pub api_key: String,
    pub model: String,
    pub base_url: String,
    pub protocol: String,
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
        let model = config.model_config(requested_model_name)?;
        Ok(Self {
            api_key: resolve_api_key(&model.api_key)?,
            model: model.model.clone(),
            base_url: model.base_url.clone(),
            protocol: model.protocol.clone(),
        })
    }
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
    if let Some(name) = value.strip_prefix("env:") {
        return std::env::var(name).with_context(|| format!("{name} is required for model.invoke"));
    }
    if let Some(literal) = value.strip_prefix("literal:") {
        return Ok(literal.to_string());
    }
    if value.trim().is_empty() {
        return Err(anyhow!("model apiKey must not be empty"));
    }
    Ok(value.to_string())
}

pub fn build_openai_chat_payload(model: &str, input: &Value) -> Result<Value> {
    let messages = input
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("model.invoke requires input.messages"))?
        .iter()
        .map(normalize_outgoing_message)
        .collect::<Result<Vec<_>>>()?;
    let tools = input
        .get("tools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut payload = json!({
        "model": model,
        "messages": messages,
    });
    if !tools.is_empty() {
        payload["tools"] = Value::Array(tools);
        payload["tool_choice"] = json!("auto");
    }
    Ok(payload)
}

pub fn build_anthropic_messages_payload(model: &str, input: &Value) -> Result<Value> {
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
                "content": string_content(object.get("content"))
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

    let tools = input
        .get("tools")
        .and_then(Value::as_array)
        .map(|tools| tools.iter().map(openai_tool_to_anthropic).collect::<Result<Vec<_>>>())
        .transpose()?
        .unwrap_or_default();

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
        .ok_or_else(|| anyhow!("tool call requires name"))
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
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("");
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| calls.iter().map(normalize_incoming_tool_call).collect::<Vec<_>>())
        .unwrap_or_default();

    Ok(json!({
        "message": {
            "role": role,
            "content": content,
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
    let mut tool_calls = Vec::new();
    for block in content {
        let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
        if block_type == "text" {
            if let Some(text) = block.get("text").and_then(Value::as_str) {
                text_parts.push(text.to_string());
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
            "toolCalls": tool_calls
        },
        "model": response.get("model").cloned().unwrap_or_else(|| json!(null)),
        "usage": response.get("usage").cloned().unwrap_or_else(|| json!({}))
    }))
}

fn normalize_incoming_tool_call(call: &Value) -> Value {
    let function = call.get("function").unwrap_or(&Value::Null);
    let raw_arguments = function
        .get("arguments")
        .and_then(Value::as_str)
        .unwrap_or("{}");
    json!({
        "id": call.get("id").and_then(Value::as_str).unwrap_or(""),
        "name": function.get("name").and_then(Value::as_str).unwrap_or(""),
        "arguments": parse_arguments(raw_arguments),
    })
}

fn parse_arguments(raw: &str) -> Value {
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
