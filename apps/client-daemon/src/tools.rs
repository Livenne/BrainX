use crate::auth::{resolve_secret_value, WebSearchConfig};
use anyhow::{anyhow, Context, Result};
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const DEFAULT_MODEL: &str = "example-chat-model";
const DEFAULT_MODEL_NAME: &str = "primary:example-chat-model";
const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
const MAX_TIMEOUT_SECONDS: u64 = 300;
const DEFAULT_BACKGROUND_RUNTIME_SECONDS: u64 = 3600;
const MAX_BACKGROUND_RUNTIME_SECONDS: u64 = 14_400;
const DEFAULT_BACKGROUND_READ_BYTES: u64 = 12_000;
const MAX_BACKGROUND_READ_BYTES: u64 = 32_000;
const INTERNAL_TOOL_FIELDS: &[&str] = &["toolCallId", "toolName", "batchId"];
const MAX_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_PREVIEW_CHARS: usize = 240;
const MAX_SEARCH_TOTAL_PREVIEW_CHARS: usize = 12_000;
const MAX_FILE_CONTENT_CHARS: usize = 32_000;
const MAX_COMMAND_STREAM_CHARS: usize = 32_000;
const MAX_DIFF_CHARS: usize = 32_000;
const MAX_DIRECTORY_ENTRIES: usize = 1_000;
const MAX_SKILL_DESCRIPTION_CHARS: usize = 280;
const MAX_AGENTS_GUIDANCE_CHARS: usize = 24_000;
const MAX_WEB_SEARCH_RESULTS: u64 = 10;
const DEFAULT_WEB_SEARCH_RESULTS: u64 = 5;
const MAX_WEB_ANSWER_CHARS: usize = 4_000;
const MAX_WEB_RESULT_CONTENT_CHARS: usize = 2_000;
const MAX_WEB_RAW_CONTENT_CHARS: usize = 8_000;
const MAX_WEB_ERROR_CHARS: usize = 2_000;

#[derive(Debug, Clone, Copy)]
pub enum SearchMode {
    Filename,
    Text,
    Regex,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: Option<usize>,
    pub preview: String,
    #[serde(rename = "previewTruncated")]
    pub preview_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
struct DirectoryEntry {
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
}

#[derive(Debug, Clone)]
struct SearchResults {
    matches: Vec<SearchMatch>,
    truncated: bool,
}

#[derive(Debug, Clone)]
struct TruncatedText {
    text: String,
    truncated: bool,
    original_chars: usize,
}

#[derive(Clone)]
pub struct ToolRuntimeState {
    background_tasks: Arc<Mutex<BackgroundTaskRegistry>>,
    todo_tasks: Arc<Mutex<Vec<TodoTask>>>,
}

impl Default for ToolRuntimeState {
    fn default() -> Self {
        Self {
            background_tasks: Arc::new(Mutex::new(BackgroundTaskRegistry::default())),
            todo_tasks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[derive(Clone)]
pub struct WorkspaceTools {
    root: PathBuf,
    state: ToolRuntimeState,
    active_model_name: String,
    active_model_id: String,
    global_skill_root: PathBuf,
    web_search_config: Option<WebSearchConfig>,
}

impl WorkspaceTools {
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self::new_with_state(root, ToolRuntimeState::default())
    }

    pub fn new_with_state(root: impl AsRef<Path>, state: ToolRuntimeState) -> Self {
        Self {
            root: expand_home_path(root.as_ref()),
            state,
            active_model_name: DEFAULT_MODEL_NAME.to_string(),
            active_model_id: DEFAULT_MODEL.to_string(),
            global_skill_root: default_global_skill_root(),
            web_search_config: None,
        }
    }

    pub fn with_active_model(mut self, model: impl Into<String>) -> Self {
        let model = model.into();
        if !model.trim().is_empty() {
            self.active_model_name = model.clone();
            self.active_model_id = model;
        }
        self
    }

    pub fn with_active_model_info(mut self, name: impl Into<String>, model: impl Into<String>) -> Self {
        let name = name.into();
        let model = model.into();
        if !name.trim().is_empty() {
            self.active_model_name = name;
        }
        if !model.trim().is_empty() {
            self.active_model_id = model;
        }
        self
    }

    pub fn with_global_skill_root(mut self, root: impl AsRef<Path>) -> Self {
        self.global_skill_root = expand_home_path(root.as_ref());
        self
    }

    pub fn with_web_search_config(mut self, config: Option<WebSearchConfig>) -> Self {
        self.web_search_config = config;
        self
    }

    pub async fn execute_async(&self, tool_name: &str, input: &Value) -> Result<Value> {
        if tool_name == "web_search" {
            return self.web_search(input).await;
        }
        self.execute(tool_name, input)
    }

    pub fn execute(&self, tool_name: &str, input: &Value) -> Result<Value> {
        match tool_name {
            "get_env" => {
                ensure_allowed_fields(input, &[], &[])?;
                Ok(self.get_environment())
            }
            "read_files" => {
                ensure_allowed_fields(input, &["files"], &["path", "paths", "range"])?;
                let files = input
                    .get("files")
                    .and_then(Value::as_array)
                    .ok_or_else(|| anyhow!("read_files requires input.files"))?;
                let results = files
                    .iter()
                    .map(|file| {
                        ensure_fields(file, &["path", "startLine", "endLine"], &["range"])?;
                        let path = file
                            .get("path")
                            .and_then(Value::as_str)
                            .ok_or_else(|| anyhow!("read_files file requires path"))?;
                        let start_line = optional_line(file, "startLine")?;
                        let end_line = optional_line(file, "endLine")?;
                        match self.read_workspace_file_result(path, start_line, end_line) {
                            Ok(mut result) => {
                                result["ok"] = json!(true);
                                Ok(result)
                            }
                            Err(error) => Ok(json!({
                                "ok": false,
                                "path": path,
                                "error": error.to_string()
                            })),
                        }
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(json!({ "files": results }))
            }
            "read_file" => {
                ensure_allowed_fields(input, &["path", "offset", "limit"], &["range", "startLine", "endLine"])?;
                let path = input
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("read_file requires input.path"))?;
                let offset = optional_line(input, "offset")?;
                let limit = optional_line(input, "limit")?;
                self.read_file_result(path, offset, limit)
            }
            "search_workspace" => {
                ensure_allowed_fields(input, &["query", "mode", "maxResults"], &[])?;
                let query = input
                    .get("query")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("search_workspace requires input.query"))?;
                let mode = match input.get("mode").and_then(Value::as_str) {
                    Some("filename") => SearchMode::Filename,
                    Some("regex") => SearchMode::Regex,
                    Some("text") | None => SearchMode::Text,
                    Some(_) => return Err(anyhow!("mode must be one of text, filename, regex")),
                };
                let max_results = optional_u64(input, "maxResults")?
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(MAX_SEARCH_RESULTS)
                    .min(MAX_SEARCH_RESULTS);
                let results = self.search_workspace_limited(query, mode, max_results)?;
                Ok(json!({
                    "matches": results.matches,
                    "truncated": results.truncated,
                    "limits": {
                        "maxResults": max_results,
                        "maxPreviewChars": MAX_SEARCH_PREVIEW_CHARS,
                        "maxTotalPreviewChars": MAX_SEARCH_TOTAL_PREVIEW_CHARS
                    }
                }))
            }
            "search_content" => {
                ensure_allowed_fields(
                    input,
                    &["pattern", "path", "file_types", "context_before", "context_after", "max_results"],
                    &[],
                )?;
                let pattern = input
                    .get("pattern")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("search_content requires input.pattern"))?;
                let path = input.get("path").and_then(Value::as_str).unwrap_or(".");
                let file_types = input.get("file_types").and_then(Value::as_str);
                let context_before = optional_u64(input, "context_before")?
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(2);
                let context_after = optional_u64(input, "context_after")?
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(2);
                let max_results = optional_u64(input, "max_results")?
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(30)
                    .min(MAX_SEARCH_RESULTS);
                self.search_content(pattern, path, file_types, context_before, context_after, max_results)
            }
            "list_directory" => {
                ensure_allowed_fields(input, &["path", "recursive", "max_depth", "filter"], &[])?;
                let path = input.get("path").and_then(Value::as_str).unwrap_or(".");
                let recursive = input.get("recursive").and_then(Value::as_bool).unwrap_or(false);
                let max_depth = optional_u64(input, "max_depth")?
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(3)
                    .max(1);
                let filter = input.get("filter").and_then(Value::as_str);
                self.list_directory(path, recursive, max_depth, filter)
            }
            "web_search" => {
                Err(anyhow!("web_search requires async execution"))
            }
            "write_file" => {
                ensure_allowed_fields(input, &["path", "content", "overwrite", "createParents"], &["mode", "bytes"])?;
                let path = input
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("write_file requires input.path"))?;
                let content = input
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("write_file requires input.content"))?;
                let overwrite = input.get("overwrite").and_then(Value::as_bool).unwrap_or(true);
                let create_parents = input.get("createParents").and_then(Value::as_bool).unwrap_or(true);
                self.write_file(path, content, overwrite, create_parents)
            }
            "edit_file" => {
                ensure_allowed_fields(input, &["path", "old_string", "new_string"], &[])?;
                let path = input
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("edit_file requires input.path"))?;
                let old_string = input
                    .get("old_string")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("edit_file requires input.old_string"))?;
                let new_string = input
                    .get("new_string")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("edit_file requires input.new_string"))?;
                self.edit_file(path, old_string, new_string)
            }
            "apply_patch" => {
                ensure_allowed_fields(input, &["patch", "dryRun"], &["files"])?;
                let patch = input
                    .get("patch")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("apply_patch requires input.patch"))?;
                let dry_run = input.get("dryRun").and_then(Value::as_bool).unwrap_or(false);
                self.apply_patch(patch, dry_run)
            }
            "run_command" => {
                ensure_allowed_fields(
                    input,
                    &["command", "workingDirectory", "timeoutSeconds", "workdir", "timeout", "env"],
                    &["cwd", "timeout_ms", "shell"],
                )?;
                let command = input
                    .get("command")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("run_command requires input.command"))?;
                let working_directory = input
                    .get("workdir")
                    .or_else(|| input.get("workingDirectory"))
                    .and_then(Value::as_str)
                    .unwrap_or(".");
                let timeout_seconds = optional_u64(input, "timeout")?
                    .or(optional_u64(input, "timeoutSeconds")?)
                    .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
                    .clamp(1, MAX_TIMEOUT_SECONDS);
                let env = optional_string_map(input, "env")?;
                self.run_command(command, working_directory, timeout_seconds, &env)
            }
            "ask_user" => {
                ensure_allowed_fields(input, &["question", "question_type", "options", "context_note"], &[])?;
                let question = input
                    .get("question")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("ask_user requires input.question"))?;
                if question.trim().is_empty() {
                    return Err(anyhow!("ask_user question must not be empty"));
                }
                let question_type = input
                    .get("question_type")
                    .and_then(Value::as_str)
                    .unwrap_or("clarification");
                if !matches!(question_type, "clarification" | "approval" | "preference" | "input") {
                    return Err(anyhow!("question_type must be one of clarification, approval, preference, input"));
                }
                Ok(json!({
                    "status": "waiting_for_user",
                    "question": question,
                    "questionType": question_type,
                    "options": optional_string_array(input, "options")?,
                    "contextNote": input.get("context_note").and_then(Value::as_str).unwrap_or("")
                }))
            }
            "todo_create" => {
                ensure_allowed_fields(input, &["tasks"], &[])?;
                self.todo_create(input)
            }
            "todo_update" => {
                ensure_allowed_fields(input, &["task_id", "status", "title", "description"], &[])?;
                self.todo_update(input)
            }
            "todo_list" => {
                ensure_allowed_fields(input, &["filter"], &[])?;
                self.todo_list(input)
            }
            "terminal_spawn" => {
                ensure_allowed_fields(input, &["command", "workdir", "env", "terminal_id"], &[])?;
                let command = input
                    .get("command")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("terminal_spawn requires input.command"))?;
                let workdir = input.get("workdir").and_then(Value::as_str).unwrap_or(".");
                let env = optional_string_map(input, "env")?;
                let terminal_id = input.get("terminal_id").and_then(Value::as_str);
                self.terminal_spawn(command, workdir, &env, terminal_id)
            }
            "terminal_output" => {
                ensure_allowed_fields(input, &["terminal_id", "lines"], &[])?;
                let terminal_id = input
                    .get("terminal_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("terminal_output requires input.terminal_id"))?;
                let lines = optional_u64(input, "lines")?
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(120);
                self.terminal_output(terminal_id, lines)
            }
            "terminal_input" => {
                ensure_allowed_fields(input, &["terminal_id", "input_text"], &[])?;
                let terminal_id = input
                    .get("terminal_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("terminal_input requires input.terminal_id"))?;
                let input_text = input
                    .get("input_text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("terminal_input requires input.input_text"))?;
                self.terminal_input(terminal_id, input_text)
            }
            "terminal_kill" => {
                ensure_allowed_fields(input, &["terminal_id"], &[])?;
                let terminal_id = input
                    .get("terminal_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("terminal_kill requires input.terminal_id"))?;
                self.terminal_kill(terminal_id)
            }
            "terminal_list" => {
                ensure_allowed_fields(input, &[], &[])?;
                self.terminal_list()
            }
            "background_start" => {
                ensure_allowed_fields(input, &["name", "command", "workingDirectory", "maxRuntimeSeconds", "purpose"], &["cwd", "timeout_ms", "shell"])?;
                let name = input
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("background_start requires input.name"))?;
                let command = input
                    .get("command")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("background_start requires input.command"))?;
                let purpose = input
                    .get("purpose")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("background_start requires input.purpose"))?;
                let working_directory = input
                    .get("workingDirectory")
                    .and_then(Value::as_str)
                    .unwrap_or(".");
                let max_runtime_seconds = optional_u64(input, "maxRuntimeSeconds")?
                    .unwrap_or(DEFAULT_BACKGROUND_RUNTIME_SECONDS)
                    .clamp(1, MAX_BACKGROUND_RUNTIME_SECONDS);
                self.background_start(name, command, working_directory, max_runtime_seconds, purpose)
            }
            "background_read" => {
                ensure_allowed_fields(input, &["taskId", "cursor", "maxBytes"], &[])?;
                let task_id = input
                    .get("taskId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("background_read requires input.taskId"))?;
                let cursor = optional_nonnegative_u64(input, "cursor")?.unwrap_or(0);
                let max_bytes = optional_u64(input, "maxBytes")?
                    .unwrap_or(DEFAULT_BACKGROUND_READ_BYTES)
                    .min(MAX_BACKGROUND_READ_BYTES);
                self.background_read(task_id, cursor, max_bytes)
            }
            "background_stop" => {
                ensure_allowed_fields(input, &["taskId", "mode"], &[])?;
                let task_id = input
                    .get("taskId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("background_stop requires input.taskId"))?;
                let mode = input.get("mode").and_then(Value::as_str).unwrap_or("terminate");
                self.background_stop(task_id, mode)
            }
            "create_skill" => {
                ensure_allowed_fields(input, &["scope", "path", "content", "reason", "evidence"], &[])?;
                self.skill_proposal("create_skill", input)
            }
            "renovation_skill" => {
                ensure_allowed_fields(input, &["path", "content", "reason", "evidence"], &["scope"])?;
                self.skill_proposal("renovation_skill", input)
            }
            "skill.apply" => {
                ensure_allowed_fields(input, &["path", "content", "createParents"], &[])?;
                let path = input
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("skill.apply requires input.path"))?;
                let content = input
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("skill.apply requires input.content"))?;
                let create_parents = input.get("createParents").and_then(Value::as_bool).unwrap_or(true);
                self.apply_skill_file(path, content, create_parents)
            }
            "mock_provider" => Ok(json!({
                "message": "Mock provider completed the run.",
                "input": input
            })),
            other => Err(anyhow!("unsupported tool: {other}")),
        }
    }

    pub fn get_environment(&self) -> Value {
        json!({
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "workspaceRoot": self.root.display().to_string(),
            "defaultShell": default_shell_name(),
            "dateTime": {
                "iso": command_stdout("date", &["-Iseconds"]).unwrap_or_else(|| "unknown".to_string()),
                "timezone": std::env::var("TZ")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .or_else(|| command_stdout("date", &["+%Z"]))
                    .unwrap_or_else(|| "local".to_string()),
                "utcOffset": command_stdout("date", &["+%:z"]).unwrap_or_else(|| "+00:00".to_string())
            },
            "model": {
                "name": self.active_model_name.clone(),
                "model": self.active_model_id.clone()
            }
        })
    }

    pub fn skill_inventory(&self) -> Result<Value> {
        Ok(json!({
            "projectRoot": normalize_path(&self.root).display().to_string(),
            "project": scan_skill_root(&self.root.join(".agents/skills"), "project")?,
            "global": scan_skill_root(&self.global_skill_root, "global")?
        }))
    }

    pub fn local_context_messages(&self) -> Vec<Value> {
        let mut messages = Vec::new();
        if let Ok(guidance) = self.agents_guidance() {
            if !guidance.trim().is_empty() {
                messages.push(json!({
                    "role": "system",
                    "content": guidance
                }));
            }
        }
        if let Ok(inventory) = self.skill_inventory() {
            let content = skill_catalog_prompt(&inventory);
            if !content.trim().is_empty() {
                messages.push(json!({
                    "role": "system",
                    "content": content
                }));
            }
        }
        messages
    }

    fn agents_guidance(&self) -> Result<String> {
        let mut files = Vec::new();
        let start = self.root.canonicalize().unwrap_or_else(|_| self.root.clone());
        for ancestor in start.ancestors() {
            let candidate = ancestor.join("AGENTS.md");
            if candidate.is_file() {
                files.push(candidate);
            }
        }
        files.reverse();
        let mut sections = Vec::new();
        for path in files {
            let content = fs::read_to_string(&path)
                .with_context(|| format!("failed to read AGENTS guidance {}", path.display()))?;
            let content = truncate_text(&content, MAX_AGENTS_GUIDANCE_CHARS);
            sections.push(format!(
                "AGENTS.md guidance from {}:\n{}{}",
                path.display(),
                content.text,
                if content.truncated { "\n[truncated]" } else { "" }
            ));
        }
        if sections.is_empty() {
            return Ok(String::new());
        }
        Ok(format!(
            "Follow the applicable repository guidance below. More specific guidance overrides broader guidance.\n\n{}",
            sections.join("\n\n")
        ))
    }

    fn skill_proposal(&self, proposal_type: &str, input: &Value) -> Result<Value> {
        let path = input
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("{proposal_type} requires input.path"))?;
        let content = input
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("{proposal_type} requires input.content"))?;
        if content.trim().is_empty() {
            return Err(anyhow!("{proposal_type} content must not be empty"));
        }
        let path = expand_home_path(Path::new(path));
        let scope = input
            .get("scope")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "project" | "global"))
            .map(ToString::to_string)
            .unwrap_or_else(|| self.skill_scope_for_path(&path));
        let metadata = parse_skill_metadata(content);
        let name = metadata
            .get("name")
            .cloned()
            .or_else(|| path.parent().and_then(Path::file_name).map(|name| name.to_string_lossy().to_string()))
            .unwrap_or_else(|| "skill".to_string());
        let evidence = optional_string_array(input, "evidence")?;
        Ok(json!({
            "proposalType": proposal_type,
            "scope": scope,
            "path": path.display().to_string(),
            "name": name,
            "content": content,
            "reason": input.get("reason").and_then(Value::as_str).unwrap_or(""),
            "evidence": evidence
        }))
    }

    fn skill_scope_for_path(&self, path: &Path) -> String {
        if path.starts_with(&self.global_skill_root) {
            "global".to_string()
        } else {
            "project".to_string()
        }
    }

    fn apply_skill_file(&self, path: &str, content: &str, create_parents: bool) -> Result<Value> {
        let target = normalize_path(&expand_home_path(Path::new(path)));
        let project_skill_root = normalize_path(&self.root.join(".agents/skills"));
        let global_skill_root = normalize_path(&self.global_skill_root);
        let allowed_project = target.starts_with(&project_skill_root);
        let allowed_global = target.starts_with(&global_skill_root);
        if !allowed_project && !allowed_global {
            return Err(anyhow!("skill.apply target must be under project .agents/skills or global ~/.agents/skills"));
        }
        if target.file_name().and_then(|name| name.to_str()) != Some("SKILL.md") {
            return Err(anyhow!("skill.apply target must be a SKILL.md file"));
        }
        if create_parents {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("failed to create skill directory {}", parent.display()))?;
            }
        }
        fs::write(&target, content)
            .with_context(|| format!("failed to write skill file {}", target.display()))?;
        Ok(json!({
            "path": target.display().to_string(),
            "bytes": content.len(),
            "scope": self.skill_scope_for_path(&target)
        }))
    }

    pub fn read_workspace_file(&self, path: impl AsRef<Path>, start_line: Option<usize>, end_line: Option<usize>) -> Result<String> {
        Ok(self
            .read_file_selection(path, start_line.unwrap_or(1), end_line, true)?
            .content)
    }

    pub fn search_workspace(&self, query: &str, mode: SearchMode) -> Result<Vec<SearchMatch>> {
        Ok(self.search_workspace_limited(query, mode, MAX_SEARCH_RESULTS)?.matches)
    }

    fn read_workspace_file_result(&self, path: impl AsRef<Path>, start_line: Option<usize>, end_line: Option<usize>) -> Result<Value> {
        let requested_path = path.as_ref().to_string_lossy().replace('\\', "/");
        let selection = self.read_workspace_file_selection(path, start_line, end_line)?;
        let content = truncate_text(&selection.content, MAX_FILE_CONTENT_CHARS);
        Ok(json!({
            "path": requested_path,
            "content": content.text,
            "contentTruncated": content.truncated,
            "originalChars": content.original_chars,
            "startLine": selection.start_line,
            "endLine": selection.end_line,
            "totalLines": selection.total_lines
        }))
    }

    fn read_file_result(&self, path: impl AsRef<Path>, offset: Option<usize>, limit: Option<usize>) -> Result<Value> {
        let requested_path = path.as_ref().to_string_lossy().replace('\\', "/");
        let start_line = offset.unwrap_or(1);
        let end_line = limit.map(|line_count| start_line.saturating_add(line_count).saturating_sub(1));
        let selection = self.read_file_selection(path, start_line, end_line, false)?;
        let content = truncate_text(&selection.content, MAX_FILE_CONTENT_CHARS);
        Ok(json!({
            "path": requested_path,
            "content": content.text,
            "contentTruncated": content.truncated,
            "originalChars": content.original_chars,
            "startLine": selection.start_line,
            "endLine": selection.end_line,
            "totalLines": selection.total_lines
        }))
    }

    fn read_workspace_file_selection(&self, path: impl AsRef<Path>, start_line: Option<usize>, end_line: Option<usize>) -> Result<FileSelection> {
        self.read_file_selection(path, start_line.unwrap_or(1), end_line, false)
    }

    fn read_file_selection(
        &self,
        path: impl AsRef<Path>,
        start_line: usize,
        end_line: Option<usize>,
        require_workspace: bool,
    ) -> Result<FileSelection> {
        let path = if require_workspace {
            self.resolve_workspace_path(path)?
        } else {
            self.resolve_readable_path(path)?
        };
        if path.is_dir() {
            return Err(anyhow!("path is a directory: {}; use list_directory instead", path.display()));
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let start = start_line.max(1);
        let total_lines = content.lines().count();
        let end = end_line.unwrap_or(total_lines).min(total_lines.max(1));
        let selected = content
            .lines()
            .enumerate()
            .filter_map(|(index, line)| {
                let line_number = index + 1;
                (line_number >= start && line_number <= end).then_some(line)
            })
            .collect::<Vec<_>>()
            .join("\n");
        Ok(FileSelection {
            content: selected,
            start_line: start,
            end_line: end,
            total_lines,
        })
    }

    fn search_content(
        &self,
        pattern: &str,
        path: &str,
        file_types: Option<&str>,
        context_before: usize,
        context_after: usize,
        max_results: usize,
    ) -> Result<Value> {
        let pattern = pattern.trim();
        if pattern.is_empty() {
            return Err(anyhow!("search_content pattern must not be empty"));
        }
        let root = self.resolve_readable_directory(path)?;
        let regex = Regex::new(pattern).ok();
        let mut matches = Vec::new();
        let mut truncated = false;
        let mut total_preview_chars = 0usize;

        for entry in WalkDir::new(&root)
            .max_depth(6)
            .into_iter()
            .filter_entry(|entry| !is_generated_directory(entry.path()))
            .filter_map(|entry| entry.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let entry_path = entry.path();
            let relative = relative_path(&root, entry_path);
            if !matches_file_filter(&relative, file_types) {
                continue;
            }
            let Ok(content) = fs::read_to_string(entry_path) else {
                continue;
            };
            let lines = content.lines().collect::<Vec<_>>();
            for (index, line) in lines.iter().enumerate() {
                let is_match = regex
                    .as_ref()
                    .map(|regex| regex.is_match(line))
                    .unwrap_or_else(|| line.contains(pattern));
                if !is_match {
                    continue;
                }
                let preview = line_context(&lines, index, context_before, context_after);
                if push_search_match(
                    &mut matches,
                    &mut truncated,
                    &mut total_preview_chars,
                    max_results,
                    relative.clone(),
                    Some(index + 1),
                    preview,
                ) {
                    break;
                }
            }
            if matches.len() >= max_results {
                break;
            }
        }

        Ok(json!({
            "matches": matches,
            "truncated": truncated,
            "limits": {
                "maxResults": max_results,
                "maxPreviewChars": MAX_SEARCH_PREVIEW_CHARS,
                "maxTotalPreviewChars": MAX_SEARCH_TOTAL_PREVIEW_CHARS
            }
        }))
    }

    fn list_directory(&self, path: &str, recursive: bool, max_depth: usize, filter: Option<&str>) -> Result<Value> {
        let root = self.resolve_readable_directory(path)?;
        let mut entries = Vec::new();
        let mut truncated = false;
        let walk_max_depth = if recursive { max_depth } else { 1 };

        for entry in WalkDir::new(&root)
            .min_depth(1)
            .max_depth(walk_max_depth)
            .into_iter()
            .filter_entry(|entry| !is_generated_directory(entry.path()))
            .filter_map(|entry| entry.ok())
        {
            let relative = relative_path(&root, entry.path());
            if !matches_file_filter(&relative, filter) {
                continue;
            }
            let metadata = entry.metadata().ok();
            entries.push(DirectoryEntry {
                path: relative,
                entry_type: if entry.file_type().is_dir() {
                    "directory".to_string()
                } else {
                    "file".to_string()
                },
                size: metadata.as_ref().filter(|_| entry.file_type().is_file()).map(|meta| meta.len()),
            });
            if entries.len() >= MAX_DIRECTORY_ENTRIES {
                truncated = true;
                break;
            }
        }

        Ok(json!({
            "path": path,
            "entries": entries,
            "truncated": truncated,
            "limits": {
                "maxEntries": MAX_DIRECTORY_ENTRIES
            }
        }))
    }

    async fn web_search(&self, input: &Value) -> Result<Value> {
        ensure_allowed_fields(
            input,
            &[
                "query",
                "searchDepth",
                "topic",
                "maxResults",
                "days",
                "includeDomains",
                "excludeDomains",
                "includeAnswer",
                "includeRawContent",
            ],
            &["domains", "recencyDays", "search_type", "num_results"],
        )?;
        let config = self
            .web_search_config
            .as_ref()
            .ok_or_else(|| anyhow!("web_search is not configured"))?;
        if config.provider.trim() != "tavily" {
            return Err(anyhow!("web_search provider must be tavily"));
        }
        let query = input
            .get("query")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("web_search requires input.query"))?
            .trim()
            .to_string();
        if query.is_empty() {
            return Err(anyhow!("web_search query must not be empty"));
        }
        let search_depth = match input.get("searchDepth").and_then(Value::as_str).unwrap_or("basic") {
            "basic" => "basic",
            "advanced" => "advanced",
            _ => return Err(anyhow!("searchDepth must be basic or advanced")),
        };
        let topic = match input.get("topic").and_then(Value::as_str).unwrap_or("general") {
            "general" => "general",
            "news" => "news",
            "finance" => "finance",
            _ => return Err(anyhow!("topic must be general, news, or finance")),
        };
        let max_results = optional_u64(input, "maxResults")?
            .unwrap_or(DEFAULT_WEB_SEARCH_RESULTS)
            .clamp(1, MAX_WEB_SEARCH_RESULTS);
        let days = optional_u64(input, "days")?.map(|value| value.clamp(1, 30));
        let include_answer = input.get("includeAnswer").and_then(Value::as_bool).unwrap_or(true);
        let include_raw_content = input
            .get("includeRawContent")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let include_domains = optional_string_array(input, "includeDomains")?;
        let exclude_domains = optional_string_array(input, "excludeDomains")?;
        let api_key = resolve_secret_value(&config.api_key, "web_search")?;
        let timeout = Duration::from_secs(config.timeout_seconds.clamp(1, 120));
        let http = Client::builder()
            .timeout(timeout)
            .build()
            .context("failed to build Tavily client")?;
        let mut body = json!({
            "query": query,
            "search_depth": search_depth,
            "topic": topic,
            "max_results": max_results,
            "include_answer": include_answer,
            "include_raw_content": include_raw_content,
        });
        if let Some(days) = days {
            body["days"] = json!(days);
        }
        if !include_domains.is_empty() {
            body["include_domains"] = json!(include_domains);
        }
        if !exclude_domains.is_empty() {
            body["exclude_domains"] = json!(exclude_domains);
        }
        let url = format!("{}/search", config.base_url.trim_end_matches('/'));
        let response = http
            .post(url)
            .bearer_auth(&api_key)
            .json(&body)
            .send()
            .await
            .context("failed to call Tavily search")?;
        let status = response.status();
        let response_body = response
            .text()
            .await
            .context("failed to read Tavily search response")?;
        if !status.is_success() {
            return Err(anyhow!(
                "Tavily search returned HTTP {}: {}",
                status.as_u16(),
                web_response_excerpt(&response_body, &api_key)
            ));
        }
        let payload: Value = serde_json::from_str(&response_body)
            .context("failed to decode Tavily search response")?;
        normalize_tavily_search_response(&payload)
    }

    fn search_workspace_limited(&self, query: &str, mode: SearchMode, max_results: usize) -> Result<SearchResults> {
        let query = query.trim();
        if query.is_empty() {
            return Err(anyhow!("search_workspace query must not be empty"));
        }
        let root = self.canonical_root()?;
        let mut matches = Vec::new();
        let mut truncated = false;
        let mut total_preview_chars = 0usize;
        let regex = if matches!(mode, SearchMode::Regex) {
            Some(Regex::new(query).with_context(|| format!("invalid regex: {query}"))?)
        } else {
            None
        };
        for entry in WalkDir::new(&root)
            .max_depth(6)
            .into_iter()
            .filter_entry(|entry| !is_generated_directory(entry.path()))
            .filter_map(|entry| entry.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let relative = relative_path(&root, path);
            match mode {
                SearchMode::Filename => {
                    if relative.contains(query) {
                        let preview = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                        if push_search_match(
                            &mut matches,
                            &mut truncated,
                            &mut total_preview_chars,
                            max_results,
                            relative,
                            None,
                            preview,
                        ) {
                            break;
                        }
                    }
                }
                SearchMode::Text | SearchMode::Regex => {
                    if let Ok(content) = fs::read_to_string(path) {
                        for (index, line) in content.lines().enumerate() {
                            let is_match = regex
                                .as_ref()
                                .map(|regex| regex.is_match(line))
                                .unwrap_or_else(|| line.contains(query));
                            if is_match {
                                if push_search_match(
                                    &mut matches,
                                    &mut truncated,
                                    &mut total_preview_chars,
                                    max_results,
                                    relative.clone(),
                                    Some(index + 1),
                                    line.trim().to_string(),
                                ) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            if matches.len() >= max_results {
                break;
            }
        }
        Ok(SearchResults { matches, truncated })
    }

    fn write_file(&self, path: &str, content: &str, overwrite: bool, create_parents: bool) -> Result<Value> {
        let target = self.resolve_writable_workspace_path(path)?;
        let before = if target.exists() {
            Some(fs::read_to_string(&target).with_context(|| format!("failed to read {}", target.display()))?)
        } else {
            None
        };
        if target.exists() && !overwrite {
            return Err(anyhow!("file already exists: {path}"));
        }
        if let Some(parent) = target.parent() {
            if create_parents {
                fs::create_dir_all(parent)
                    .with_context(|| format!("failed to create directory {}", parent.display()))?;
            } else if !parent.exists() {
                return Err(anyhow!("parent directory does not exist: {}", parent.display()));
            }
        }
        fs::write(&target, content).with_context(|| format!("failed to write {}", target.display()))?;
        let diff = truncate_text(
            build_file_diff(path, before.as_deref().unwrap_or(""), content),
            MAX_DIFF_CHARS,
        );
        Ok(json!({
            "path": path,
            "bytesWritten": content.len(),
            "overwritten": overwrite,
            "diff": diff.text,
            "diffTruncated": diff.truncated,
            "originalDiffChars": diff.original_chars
        }))
    }

    fn edit_file(&self, path: &str, old_string: &str, new_string: &str) -> Result<Value> {
        if old_string.is_empty() {
            return Err(anyhow!("edit_file old_string must not be empty"));
        }
        let target = self.resolve_writable_workspace_path(path)?;
        let before = fs::read_to_string(&target)
            .with_context(|| format!("failed to read {}", target.display()))?;
        let match_count = before.matches(old_string).count();
        if match_count == 0 {
            return Err(anyhow!("old_string was not found in {path}"));
        }
        if match_count > 1 {
            return Err(anyhow!("old_string is not unique in {path}"));
        }
        let after = before.replacen(old_string, new_string, 1);
        fs::write(&target, &after).with_context(|| format!("failed to write {}", target.display()))?;
        let diff = truncate_text(build_file_diff(path, &before, &after), MAX_DIFF_CHARS);
        Ok(json!({
            "path": path,
            "bytesWritten": after.len(),
            "diff": diff.text,
            "diffTruncated": diff.truncated,
            "originalDiffChars": diff.original_chars
        }))
    }

    fn apply_patch(&self, patch: &str, dry_run: bool) -> Result<Value> {
        if patch.trim().is_empty() {
            return Err(anyhow!("apply_patch patch must not be empty"));
        }
        let root = self.canonical_root()?;
        let check = run_git_apply(&root, patch, true)?;
        if check.exit_code != 0 {
            return Err(anyhow!("git apply --check failed: {}", check.stderr.trim()));
        }
        if !dry_run {
            let applied = run_git_apply(&root, patch, false)?;
            if applied.exit_code != 0 {
                return Err(anyhow!("git apply failed: {}", applied.stderr.trim()));
            }
        }
        let stdout = truncate_text(&check.stdout, MAX_COMMAND_STREAM_CHARS);
        let stderr = truncate_text(&check.stderr, MAX_COMMAND_STREAM_CHARS);
        Ok(json!({
            "applied": !dry_run,
            "changedFiles": changed_files_from_patch(patch),
            "stdout": stdout.text,
            "stdoutTruncated": stdout.truncated,
            "stderr": stderr.text,
            "stderrTruncated": stderr.truncated
        }))
    }

    fn run_command(
        &self,
        command: &str,
        working_directory: &str,
        timeout_seconds: u64,
        env: &HashMap<String, String>,
    ) -> Result<Value> {
        if command.trim().is_empty() {
            return Err(anyhow!("run_command command must not be empty"));
        }
        let directory = self.resolve_workspace_directory(working_directory)?;
        let output = run_shell_command(command, &directory, Duration::from_secs(timeout_seconds), env)?;
        let stdout = truncate_text(&output.stdout, MAX_COMMAND_STREAM_CHARS);
        let stderr = truncate_text(&output.stderr, MAX_COMMAND_STREAM_CHARS);
        Ok(json!({
            "exitCode": output.exit_code,
            "stdout": stdout.text,
            "stdoutTruncated": stdout.truncated,
            "stderr": stderr.text,
            "stderrTruncated": stderr.truncated,
            "timedOut": output.timed_out
        }))
    }

    fn background_start(
        &self,
        name: &str,
        command: &str,
        working_directory: &str,
        max_runtime_seconds: u64,
        purpose: &str,
    ) -> Result<Value> {
        if name.trim().is_empty() {
            return Err(anyhow!("background_start name must not be empty"));
        }
        if command.trim().is_empty() {
            return Err(anyhow!("background_start command must not be empty"));
        }
        if purpose.trim().is_empty() {
            return Err(anyhow!("background_start purpose must not be empty"));
        }
        let directory = self.resolve_workspace_directory(working_directory)?;
        let env = HashMap::new();
        let mut child = spawn_background_shell_command(command, &directory, &env)?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let started_at = timestamp_now();
        let started_instant = Instant::now();
        let task_id = {
            let mut registry = self.state.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
            let task_id = format!("bg_{}", registry.next_id);
            registry.next_id += 1;
            registry.tasks.insert(
                task_id.clone(),
                BackgroundTask {
                    name: name.to_string(),
                    child,
                    status: "running".to_string(),
                    pid,
                    started_at: started_at.clone(),
                    started_instant,
                    stopped_at: None,
                    chunks: Vec::new(),
                    next_cursor: 0,
                    exit_code: None,
                    max_runtime_seconds,
                    purpose: purpose.to_string(),
                },
            );
            task_id
        };
        spawn_background_reader(self.state.background_tasks.clone(), task_id.clone(), "stdout", stdout);
        spawn_background_reader(self.state.background_tasks.clone(), task_id.clone(), "stderr", stderr);
        Ok(json!({
            "taskId": task_id,
            "status": "running",
            "pid": pid,
            "startedAt": started_at,
            "cursor": 0
        }))
    }

    fn background_read(&self, task_id: &str, cursor: u64, max_bytes: u64) -> Result<Value> {
        let mut registry = self.state.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
        let task = registry
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| anyhow!("background task not found: {task_id}"))?;
        refresh_background_task_status(task)?;
        let mut bytes = 0_u64;
        let mut truncated = false;
        let mut chunks = Vec::new();
        for chunk in task.chunks.iter().filter(|chunk| chunk.cursor > cursor) {
            if bytes >= max_bytes {
                truncated = true;
                break;
            }
            let remaining = (max_bytes - bytes) as usize;
            let chunk_bytes = chunk.text.len() as u64;
            if bytes + chunk_bytes > max_bytes {
                let text = truncate_text_bytes(&chunk.text, remaining);
                chunks.push(json!({
                    "cursor": chunk.cursor,
                    "stream": chunk.stream,
                    "text": text.text,
                    "textTruncated": true,
                    "timestamp": chunk.timestamp
                }));
                truncated = true;
                break;
            }
            bytes += chunk_bytes;
            chunks.push(json!({
                "cursor": chunk.cursor,
                "stream": chunk.stream,
                "text": chunk.text,
                "textTruncated": false,
                "timestamp": chunk.timestamp
            }));
        }
        Ok(json!({
            "taskId": task_id,
            "name": task.name,
            "status": task.status,
            "exitCode": task.exit_code,
            "startedAt": task.started_at,
            "maxRuntimeSeconds": task.max_runtime_seconds,
            "purpose": task.purpose,
            "timedOut": task.status == "timed_out",
            "chunks": chunks,
            "nextCursor": task.next_cursor,
            "truncated": truncated,
            "limits": {
                "maxBytes": max_bytes,
                "maxAllowedBytes": MAX_BACKGROUND_READ_BYTES
            }
        }))
    }

    fn background_stop(&self, task_id: &str, mode: &str) -> Result<Value> {
        if !matches!(mode, "terminate" | "kill") {
            return Err(anyhow!("mode must be one of terminate, kill"));
        }
        let mut registry = self.state.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
        let response = {
            let task = registry
                .tasks
                .get_mut(task_id)
                .ok_or_else(|| anyhow!("background task not found: {task_id}"))?;
            refresh_background_task_status(task)?;
            if task.status == "running" {
                stop_background_child(&mut task.child, task.pid, mode)?;
                let _ = task.child.wait();
                task.exit_code = task.child.try_wait().ok().flatten().and_then(|status| status.code());
                task.status = "stopped".to_string();
                task.stopped_at = Some(timestamp_now());
            }
            json!({
                "taskId": task_id,
                "status": task.status,
                "stoppedAt": task.stopped_at
            })
        };
        registry.tasks.remove(task_id);
        Ok(response)
    }

    fn todo_create(&self, input: &Value) -> Result<Value> {
        let tasks_value = input
            .get("tasks")
            .and_then(Value::as_array)
            .ok_or_else(|| anyhow!("todo_create requires input.tasks"))?;
        let mut tasks = Vec::new();
        for task_value in tasks_value {
            let task: TodoTask = serde_json::from_value(task_value.clone())
                .context("todo_create task must match the task schema")?;
            validate_todo_status(&task.status)?;
            if task.id.trim().is_empty() {
                return Err(anyhow!("todo task id must not be empty"));
            }
            if task.title.trim().is_empty() {
                return Err(anyhow!("todo task title must not be empty"));
            }
            if tasks.iter().any(|existing: &TodoTask| existing.id == task.id) {
                return Err(anyhow!("duplicate todo task id: {}", task.id));
            }
            tasks.push(task);
        }
        let mut registry = self.state.todo_tasks.lock().map_err(|_| anyhow!("todo registry is poisoned"))?;
        *registry = tasks.clone();
        Ok(json!({ "tasks": tasks }))
    }

    fn todo_update(&self, input: &Value) -> Result<Value> {
        let task_id = input
            .get("task_id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("todo_update requires input.task_id"))?;
        let mut registry = self.state.todo_tasks.lock().map_err(|_| anyhow!("todo registry is poisoned"))?;
        let task = registry
            .iter_mut()
            .find(|task| task.id == task_id)
            .ok_or_else(|| anyhow!("todo task not found: {task_id}"))?;
        if let Some(status) = input.get("status").and_then(Value::as_str) {
            validate_todo_status(status)?;
            task.status = status.to_string();
        }
        if let Some(title) = input.get("title").and_then(Value::as_str) {
            if title.trim().is_empty() {
                return Err(anyhow!("todo task title must not be empty"));
            }
            task.title = title.to_string();
        }
        if let Some(description) = input.get("description").and_then(Value::as_str) {
            task.description = (!description.trim().is_empty()).then(|| description.to_string());
        }
        Ok(json!({ "task": task.clone() }))
    }

    fn todo_list(&self, input: &Value) -> Result<Value> {
        let filter = input.get("filter").and_then(Value::as_str).unwrap_or("all");
        if !matches!(filter, "all" | "pending" | "in_progress" | "completed" | "cancelled") {
            return Err(anyhow!("todo_list filter must be one of all, pending, in_progress, completed, cancelled"));
        }
        let registry = self.state.todo_tasks.lock().map_err(|_| anyhow!("todo registry is poisoned"))?;
        let tasks = registry
            .iter()
            .filter(|task| filter == "all" || task.status == filter)
            .cloned()
            .collect::<Vec<_>>();
        Ok(json!({ "tasks": tasks }))
    }

    fn terminal_spawn(
        &self,
        command: &str,
        workdir: &str,
        env: &HashMap<String, String>,
        requested_terminal_id: Option<&str>,
    ) -> Result<Value> {
        if command.trim().is_empty() {
            return Err(anyhow!("terminal_spawn command must not be empty"));
        }
        let directory = self.resolve_workspace_directory(workdir)?;
        let mut child = spawn_background_shell_command(command, &directory, env)?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let started_at = timestamp_now();
        let started_instant = Instant::now();
        let terminal_id = {
            let mut registry = self.state.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
            let terminal_id = requested_terminal_id
                .map(ToString::to_string)
                .unwrap_or_else(|| {
                    let id = format!("term_{}", registry.next_id);
                    registry.next_id += 1;
                    id
                });
            if terminal_id.trim().is_empty() {
                return Err(anyhow!("terminal_id must not be empty"));
            }
            if registry.tasks.contains_key(&terminal_id) {
                return Err(anyhow!("terminal already exists: {terminal_id}"));
            }
            registry.tasks.insert(
                terminal_id.clone(),
                BackgroundTask {
                    name: terminal_id.clone(),
                    child,
                    status: "running".to_string(),
                    pid,
                    started_at: started_at.clone(),
                    started_instant,
                    stopped_at: None,
                    chunks: Vec::new(),
                    next_cursor: 0,
                    exit_code: None,
                    max_runtime_seconds: DEFAULT_BACKGROUND_RUNTIME_SECONDS,
                    purpose: "terminal session".to_string(),
                },
            );
            terminal_id
        };
        spawn_background_reader(self.state.background_tasks.clone(), terminal_id.clone(), "stdout", stdout);
        spawn_background_reader(self.state.background_tasks.clone(), terminal_id.clone(), "stderr", stderr);
        Ok(json!({
            "terminalId": terminal_id,
            "status": "running",
            "pid": pid,
            "startedAt": started_at
        }))
    }

    fn terminal_output(&self, terminal_id: &str, lines: usize) -> Result<Value> {
        let mut registry = self.state.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
        let task = registry
            .tasks
            .get_mut(terminal_id)
            .ok_or_else(|| anyhow!("terminal not found: {terminal_id}"))?;
        refresh_background_task_status(task)?;
        let output = task
            .chunks
            .iter()
            .map(|chunk| chunk.text.as_str())
            .collect::<String>();
        let output_lines = output.lines().collect::<Vec<_>>();
        let from = output_lines.len().saturating_sub(lines);
        Ok(json!({
            "terminalId": terminal_id,
            "status": task.status,
            "exitCode": task.exit_code,
            "output": output_lines[from..].join("\n"),
            "nextCursor": task.next_cursor
        }))
    }

    fn terminal_input(&self, terminal_id: &str, input_text: &str) -> Result<Value> {
        let mut registry = self.state.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
        let task = registry
            .tasks
            .get_mut(terminal_id)
            .ok_or_else(|| anyhow!("terminal not found: {terminal_id}"))?;
        refresh_background_task_status(task)?;
        if task.status != "running" {
            return Err(anyhow!("terminal is not running: {terminal_id}"));
        }
        let stdin = task
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow!("terminal stdin is not available: {terminal_id}"))?;
        stdin
            .write_all(input_text.as_bytes())
            .with_context(|| format!("failed to write input to terminal {terminal_id}"))?;
        stdin.flush().ok();
        Ok(json!({
            "terminalId": terminal_id,
            "bytesWritten": input_text.len()
        }))
    }

    fn terminal_kill(&self, terminal_id: &str) -> Result<Value> {
        let mut registry = self.state.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
        let response = {
            let task = registry
                .tasks
                .get_mut(terminal_id)
                .ok_or_else(|| anyhow!("terminal not found: {terminal_id}"))?;
            refresh_background_task_status(task)?;
            if task.status == "running" {
                stop_background_child(&mut task.child, task.pid, "terminate")?;
                let _ = task.child.wait();
                task.exit_code = task.child.try_wait().ok().flatten().and_then(|status| status.code());
                task.status = "stopped".to_string();
                task.stopped_at = Some(timestamp_now());
            }
            json!({
                "terminalId": terminal_id,
                "status": task.status,
                "stoppedAt": task.stopped_at
            })
        };
        registry.tasks.remove(terminal_id);
        Ok(response)
    }

    fn terminal_list(&self) -> Result<Value> {
        let mut registry = self.state.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
        let mut terminals = Vec::new();
        let mut stopped_terminal_ids = Vec::new();
        for (terminal_id, task) in registry.tasks.iter_mut() {
            refresh_background_task_status(task)?;
            if task.status == "stopped" {
                stopped_terminal_ids.push(terminal_id.clone());
                continue;
            }
            terminals.push(json!({
                "terminalId": terminal_id,
                "status": task.status,
                "exitCode": task.exit_code,
                "pid": task.pid,
                "startedAt": task.started_at,
                "stoppedAt": task.stopped_at
            }));
        }
        for terminal_id in stopped_terminal_ids {
            registry.tasks.remove(&terminal_id);
        }
        Ok(json!({ "terminals": terminals }))
    }

    fn resolve_workspace_path(&self, path: impl AsRef<Path>) -> Result<PathBuf> {
        let root = self.canonical_root()?;
        let candidate = if path.as_ref().is_absolute() {
            path.as_ref().to_path_buf()
        } else {
            root.join(path)
        };
        let canonical = candidate
            .canonicalize()
            .with_context(|| format!("failed to resolve {}", candidate.display()))?;
        if !canonical.starts_with(&root) {
            return Err(anyhow!("path is outside workspace: {}", canonical.display()));
        }
        Ok(canonical)
    }

    fn resolve_writable_workspace_path(&self, path: impl AsRef<Path>) -> Result<PathBuf> {
        let root = self.canonical_root()?;
        let candidate = if path.as_ref().is_absolute() {
            path.as_ref().to_path_buf()
        } else {
            root.join(path)
        };
        let normalized = normalize_path(&candidate);
        if !normalized.starts_with(&root) {
            return Err(anyhow!("path is outside workspace: {}", normalized.display()));
        }
        Ok(normalized)
    }

    fn resolve_readable_path(&self, path: impl AsRef<Path>) -> Result<PathBuf> {
        let root = self.canonical_root()?;
        let candidate = if path.as_ref().is_absolute() {
            path.as_ref().to_path_buf()
        } else {
            root.join(path)
        };
        candidate
            .canonicalize()
            .with_context(|| format!("failed to resolve {}", candidate.display()))
    }

    fn resolve_readable_directory(&self, path: impl AsRef<Path>) -> Result<PathBuf> {
        let path = self.resolve_readable_path(path)?;
        if !path.is_dir() {
            return Err(anyhow!("path is not a directory: {}", path.display()));
        }
        Ok(path)
    }

    fn resolve_workspace_directory(&self, path: impl AsRef<Path>) -> Result<PathBuf> {
        let path = self.resolve_workspace_path(path)?;
        if !path.is_dir() {
            return Err(anyhow!("workingDirectory is not a directory: {}", path.display()));
        }
        Ok(path)
    }

    fn canonical_root(&self) -> Result<PathBuf> {
        self.root
            .canonicalize()
            .with_context(|| format!("failed to resolve workspace root {}", self.root.display()))
    }
}

pub fn default_tool_schemas() -> Vec<Value> {
    vec![
        tool_schema(
            "get_env",
            "Inspect the local runtime environment, current workspace root, default shell, active model name, and local date/time. Use when environment facts matter. Does not expose API keys, provider URLs, or secrets.",
            json!({
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "read_files",
            "Read one or more UTF-8 text files by path and optional line range. Use for exact file content; if a path is a directory, use list_directory instead. Keep ranges small when files may be large.",
            json!({
                "type": "object",
                "properties": {
                    "files": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {"type": "string", "description": "Absolute path or path relative to the current workspace. Must point to a file, not a directory."},
                                "startLine": {"type": "integer", "description": "1-based starting line.", "default": 1},
                                "endLine": {"type": "integer", "description": "1-based inclusive ending line."}
                            },
                            "required": ["path"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["files"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "write_file",
            "Create or fully overwrite a UTF-8 text file inside the current workspace. Use for new files or complete replacements. Read the existing file first before overwriting unless the file is known not to exist.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path inside the current workspace."},
                    "content": {"type": "string", "description": "Complete file content."}
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "edit_file",
            "Replace one exact, unique text fragment inside a workspace file. Read the file first and provide enough old_string context to make the match unique.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path inside the current workspace."},
                    "old_string": {"type": "string", "description": "Exact existing text. Must appear exactly once."},
                    "new_string": {"type": "string", "description": "Replacement text. Use an empty string to delete."}
                },
                "required": ["path", "old_string", "new_string"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "search_content",
            "Search readable text files for a literal string or regular expression. Use when you know text or symbols but not the exact file or line. Read files before editing.",
            json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Text or regex pattern to search for."},
                    "path": {"type": "string", "description": "Directory to search. Defaults to current workspace.", "default": "."},
                    "file_types": {"type": "string", "description": "Optional file filter such as *.rs or *.{js,ts}."},
                    "context_before": {"type": "integer", "default": 2},
                    "context_after": {"type": "integer", "default": 2},
                    "max_results": {"type": "integer", "default": 30}
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "list_directory",
            "List files and directories. Use for structure discovery or when a path might be a directory. Use recursion sparingly with max_depth and filters.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "default": "."},
                    "recursive": {"type": "boolean", "default": false},
                    "max_depth": {"type": "integer", "default": 3},
                    "filter": {"type": "string", "description": "Optional file name filter such as *.md."}
                },
                "required": [],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "run_command",
            "Run a short, non-interactive shell command inside the current workspace. Use for tests, builds, git inspection, and quick diagnostics. Use terminal_spawn for servers, watchers, or commands expected to keep running.",
            json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to execute."},
                    "workdir": {"type": "string", "description": "Working directory inside the current workspace.", "default": "."},
                    "timeout": {"type": "integer", "description": "Timeout in seconds.", "default": 120},
                    "env": {"type": "object", "additionalProperties": {"type": "string"}}
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "web_search",
            "Search the public web through Tavily for current facts, documentation, news, or external references that are not available in the workspace. Prefer precise queries and include domains when source quality matters.",
            json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Precise natural-language search query."},
                    "searchDepth": {"type": "string", "enum": ["basic", "advanced"], "default": "basic"},
                    "topic": {"type": "string", "enum": ["general", "news", "finance"], "default": "general"},
                    "maxResults": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
                    "days": {"type": "integer", "minimum": 1, "maximum": 30, "description": "Recency window for news searches."},
                    "includeDomains": {"type": "array", "items": {"type": "string"}, "description": "Restrict results to these domains."},
                    "excludeDomains": {"type": "array", "items": {"type": "string"}, "description": "Exclude results from these domains."},
                    "includeAnswer": {"type": "boolean", "default": true},
                    "includeRawContent": {"type": "boolean", "default": false}
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "ask_user",
            "Ask the user for clarification, approval, a preference, or missing input. Use only when tool exploration cannot answer the question. Provide concise options when possible.",
            json!({
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "question_type": {
                        "type": "string",
                        "enum": ["clarification", "approval", "preference", "input"],
                        "default": "clarification"
                    },
                    "options": {"type": "array", "items": {"type": "string"}},
                    "context_note": {"type": "string"}
                },
                "required": ["question"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "create_skill",
            "Submit a proposal for a new reusable skill. This does not write files directly; the browser/server approval flow must approve and apply it. Use only when a workflow is reusable beyond the current task.",
            json!({
                "type": "object",
                "properties": {
                    "scope": {"type": "string", "enum": ["project", "global"], "description": "project writes under the current workspace .agents/skills; global writes under ~/.agents/skills."},
                    "path": {"type": "string", "description": "Full target SKILL.md path."},
                    "content": {"type": "string", "description": "Complete SKILL.md markdown, including YAML frontmatter."},
                    "reason": {"type": "string", "description": "Why this skill should exist."},
                    "evidence": {"type": "array", "items": {"type": "string"}, "description": "Concrete observations that justify the skill."}
                },
                "required": ["scope", "path", "content", "reason"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "renovation_skill",
            "Submit a proposal to replace an existing skill with improved complete SKILL.md content. This does not write files directly; approval must apply it.",
            json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Full path to the existing or target SKILL.md file."},
                    "content": {"type": "string", "description": "Complete replacement SKILL.md markdown."},
                    "reason": {"type": "string", "description": "Why the skill should be updated."},
                    "evidence": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["path", "content", "reason"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "todo_create",
            "Create or replace the current task list for non-trivial multi-step work. Tasks should be actionable, ordered, and short. Prefer one in_progress item.",
            json!({
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                                "description": {"type": "string"},
                                "status": {
                                    "type": "string",
                                    "enum": ["pending", "in_progress", "completed", "cancelled"],
                                    "default": "pending"
                                },
                                "dependencies": {"type": "array", "items": {"type": "string"}}
                            },
                            "required": ["id", "title"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["tasks"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "todo_update",
            "Update one task in the current task list as work progresses. Mark completed only after the corresponding work is actually done or verified.",
            json!({
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "status": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "completed", "cancelled"]
                    },
                    "title": {"type": "string"},
                    "description": {"type": "string"}
                },
                "required": ["task_id"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "todo_list",
            "Read the current task list when needed to recover state. Do not call after every update unless context is unclear.",
            json!({
                "type": "object",
                "properties": {
                    "filter": {
                        "type": "string",
                        "enum": ["all", "pending", "in_progress", "completed", "cancelled"],
                        "default": "all"
                    }
                },
                "required": [],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "terminal_spawn",
            "Start a long-running or interactive terminal process inside the current workspace. Use for dev servers, watchers, REPL-like commands, or commands that should not block the loop.",
            json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "workdir": {"type": "string", "default": "."},
                    "env": {"type": "object", "additionalProperties": {"type": "string"}},
                    "terminal_id": {"type": "string", "description": "Optional stable terminal id."}
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "terminal_output",
            "Read recent buffered output from a background terminal. Use to observe progress, failures, ports, or logs after terminal_spawn or terminal_input.",
            json!({
                "type": "object",
                "properties": {
                    "terminal_id": {"type": "string"},
                    "lines": {"type": "integer", "default": 120}
                },
                "required": ["terminal_id"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "terminal_input",
            "Send stdin text to a running background terminal. Include a newline when simulating Enter.",
            json!({
                "type": "object",
                "properties": {
                    "terminal_id": {"type": "string"},
                    "input_text": {"type": "string"}
                },
                "required": ["terminal_id", "input_text"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "terminal_kill",
            "Terminate a running background terminal when it is no longer needed or is stuck. Stopped terminals should not remain in active terminal lists.",
            json!({
                "type": "object",
                "properties": {
                    "terminal_id": {"type": "string"}
                },
                "required": ["terminal_id"],
                "additionalProperties": false
            }),
        ),
        tool_schema(
            "terminal_list",
            "List active and completed terminal sessions that are still relevant. Stopped sessions should be cleared by the runtime/UI path.",
            json!({
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
            }),
        ),
    ]
}

fn default_global_skill_root() -> PathBuf {
    expand_home_path(Path::new("~/.agents/skills"))
}

fn scan_skill_root(root: &Path, scope: &str) -> Result<Vec<Value>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut skills = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file() && entry.file_name().to_string_lossy() == "SKILL.md")
    {
        let path = entry.path().to_path_buf();
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read skill {}", path.display()))?;
        let metadata = parse_skill_metadata(&content);
        let name = metadata
            .get("name")
            .cloned()
            .or_else(|| path.parent().and_then(Path::file_name).map(|name| name.to_string_lossy().to_string()))
            .unwrap_or_else(|| "skill".to_string());
        let description = truncate_text(metadata.get("description").cloned().unwrap_or_default(), MAX_SKILL_DESCRIPTION_CHARS).text;
        let triggers = parse_skill_triggers(&content);
        let mut item = json!({
            "id": format!("{scope}:{}", path.display()),
            "scope": scope,
            "name": name,
            "description": description,
            "path": path.display().to_string()
        });
        if let Some(version) = metadata.get("version") {
            item["version"] = json!(version);
        }
        if !triggers.is_empty() {
            item["triggers"] = json!(triggers);
        }
        skills.push(item);
    }
    skills.sort_by(|a, b| {
        a.get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(b.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    Ok(skills)
}

fn parse_skill_metadata(content: &str) -> HashMap<String, String> {
    let mut metadata = HashMap::new();
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return metadata;
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if trimmed.starts_with('-') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
            if !value.is_empty() {
                metadata.insert(key.trim().to_string(), value);
            }
        }
    }
    metadata
}

fn parse_skill_triggers(content: &str) -> Vec<String> {
    let mut triggers = Vec::new();
    let mut in_triggers = false;
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return triggers;
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if trimmed == "triggers:" {
            in_triggers = true;
            continue;
        }
        if in_triggers {
            if let Some(value) = trimmed.strip_prefix('-') {
                let value = value.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() {
                    triggers.push(value.to_string());
                }
                continue;
            }
            if !trimmed.is_empty() && !line.starts_with(' ') {
                in_triggers = false;
            }
        }
    }
    triggers
}

fn skill_catalog_prompt(inventory: &Value) -> String {
    let project = inventory.get("project").and_then(Value::as_array).cloned().unwrap_or_default();
    let global = inventory.get("global").and_then(Value::as_array).cloned().unwrap_or_default();
    if project.is_empty() && global.is_empty() {
        return String::new();
    }
    let mut lines = vec![
        "Available brainx skills are listed below. Before applying a skill, read its full SKILL.md with read_files and follow it exactly when relevant.".to_string(),
        String::new(),
    ];
    append_skill_catalog_group(&mut lines, "Project skills", &project);
    append_skill_catalog_group(&mut lines, "Global skills", &global);
    lines.join("\n")
}

fn append_skill_catalog_group(lines: &mut Vec<String>, title: &str, skills: &[Value]) {
    if skills.is_empty() {
        return;
    }
    lines.push(format!("{title}:"));
    for skill in skills {
        let name = skill.get("name").and_then(Value::as_str).unwrap_or("skill");
        let description = skill.get("description").and_then(Value::as_str).unwrap_or("");
        let path = skill.get("path").and_then(Value::as_str).unwrap_or("");
        if description.is_empty() {
            lines.push(format!("- {name} ({path})"));
        } else {
            lines.push(format!("- {name}: {description} ({path})"));
        }
    }
    lines.push(String::new());
}

fn tool_schema(name: &str, description: &str, parameters: Value) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters
        }
    })
}

#[derive(Debug, Clone)]
struct FileSelection {
    content: String,
    start_line: usize,
    end_line: usize,
    total_lines: usize,
}

#[derive(Debug)]
struct BackgroundTaskRegistry {
    next_id: u64,
    tasks: HashMap<String, BackgroundTask>,
}

impl Default for BackgroundTaskRegistry {
    fn default() -> Self {
        Self {
            next_id: 1,
            tasks: HashMap::new(),
        }
    }
}

#[derive(Debug)]
struct BackgroundTask {
    name: String,
    child: Child,
    status: String,
    pid: u32,
    started_at: String,
    started_instant: Instant,
    stopped_at: Option<String>,
    chunks: Vec<BackgroundChunk>,
    next_cursor: u64,
    exit_code: Option<i32>,
    max_runtime_seconds: u64,
    purpose: String,
}

#[derive(Debug, Clone)]
struct BackgroundChunk {
    cursor: u64,
    stream: String,
    text: String,
    timestamp: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct TodoTask {
    id: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default = "default_todo_status")]
    status: String,
    #[serde(default)]
    dependencies: Vec<String>,
}

fn default_todo_status() -> String {
    "pending".to_string()
}

fn validate_todo_status(status: &str) -> Result<()> {
    if matches!(status, "pending" | "in_progress" | "completed" | "cancelled") {
        return Ok(());
    }
    Err(anyhow!("todo status must be one of pending, in_progress, completed, cancelled"))
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn line_context(lines: &[&str], match_index: usize, context_before: usize, context_after: usize) -> String {
    let start = match_index.saturating_sub(context_before);
    let end = (match_index + context_after + 1).min(lines.len());
    lines[start..end].join("\n")
}

fn matches_file_filter(path: &str, filter: Option<&str>) -> bool {
    let Some(filter) = filter.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };
    filter
        .split(',')
        .map(str::trim)
        .filter(|pattern| !pattern.is_empty())
        .any(|pattern| wildcard_match(pattern, path))
}

fn wildcard_match(pattern: &str, path: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(extensions) = pattern.strip_prefix("*.{").and_then(|value| value.strip_suffix('}')) {
        return extensions
            .split(',')
            .map(str::trim)
            .any(|extension| path.ends_with(&format!(".{extension}")));
    }
    if let Some(extension) = pattern.strip_prefix("*.") {
        return path.ends_with(&format!(".{extension}"));
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return path.starts_with(prefix);
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return path.ends_with(suffix);
    }
    path == pattern || path.ends_with(&format!("/{pattern}"))
}

fn truncate_text(text: impl AsRef<str>, max_chars: usize) -> TruncatedText {
    let text = text.as_ref();
    let original_chars = text.chars().count();
    if original_chars <= max_chars {
        return TruncatedText {
            text: text.to_string(),
            truncated: false,
            original_chars,
        };
    }

    let marker = "\n...[truncated]";
    let keep_chars = max_chars.saturating_sub(marker.chars().count());
    let mut truncated = text.chars().take(keep_chars).collect::<String>();
    truncated.push_str(marker);
    TruncatedText {
        text: truncated,
        truncated: true,
        original_chars,
    }
}

fn normalize_tavily_search_response(payload: &Value) -> Result<Value> {
    let answer = payload.get("answer").and_then(Value::as_str).unwrap_or("");
    let answer = truncate_text(answer, MAX_WEB_ANSWER_CHARS);
    let mut truncated = answer.truncated;
    let result_items = payload
        .get("results")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let results = result_items
        .iter()
        .map(|result| {
            let title = result.get("title").and_then(Value::as_str).unwrap_or("");
            let url = result.get("url").and_then(Value::as_str).unwrap_or("");
            let content = result.get("content").and_then(Value::as_str).unwrap_or("");
            let content = truncate_text(content, MAX_WEB_RESULT_CONTENT_CHARS);
            let raw = result
                .get("raw_content")
                .or_else(|| result.get("rawContent"))
                .and_then(Value::as_str)
                .map(|raw| truncate_text(raw, MAX_WEB_RAW_CONTENT_CHARS));
            truncated = truncated || content.truncated || raw.as_ref().map(|value| value.truncated).unwrap_or(false);
            json!({
                "title": title,
                "url": url,
                "content": content.text,
                "score": result.get("score").cloned().unwrap_or(Value::Null),
                "rawContent": raw.map(|value| value.text)
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "query": payload.get("query").and_then(Value::as_str).unwrap_or(""),
        "answer": answer.text,
        "results": results,
        "requestId": payload
            .get("request_id")
            .or_else(|| payload.get("requestId"))
            .and_then(Value::as_str)
            .unwrap_or(""),
        "responseTime": payload
            .get("response_time")
            .or_else(|| payload.get("responseTime"))
            .cloned()
            .unwrap_or(Value::Null),
        "truncated": truncated
    }))
}

fn web_response_excerpt(body: &str, api_key: &str) -> String {
    let redacted = if api_key.len() >= 8 {
        body.replace(api_key, "<redacted>")
    } else {
        body.to_string()
    };
    truncate_text(redacted, MAX_WEB_ERROR_CHARS).text
}

fn truncate_text_bytes(text: &str, max_bytes: usize) -> TruncatedText {
    let original_chars = text.chars().count();
    if text.len() <= max_bytes {
        return TruncatedText {
            text: text.to_string(),
            truncated: false,
            original_chars,
        };
    }

    let marker = "\n...[truncated]";
    if max_bytes <= marker.len() {
        return TruncatedText {
            text: String::new(),
            truncated: true,
            original_chars,
        };
    }

    let keep_bytes = max_bytes - marker.len();
    let mut end = 0;
    for (index, character) in text.char_indices() {
        let next = index + character.len_utf8();
        if next > keep_bytes {
            break;
        }
        end = next;
    }
    let mut truncated = text[..end].to_string();
    truncated.push_str(marker);
    TruncatedText {
        text: truncated,
        truncated: true,
        original_chars,
    }
}

fn push_search_match(
    matches: &mut Vec<SearchMatch>,
    truncated: &mut bool,
    total_preview_chars: &mut usize,
    max_results: usize,
    path: String,
    line: Option<usize>,
    preview: String,
) -> bool {
    let preview = truncate_text(preview, MAX_SEARCH_PREVIEW_CHARS);
    let preview_chars = preview.text.chars().count();
    if *total_preview_chars + preview_chars > MAX_SEARCH_TOTAL_PREVIEW_CHARS {
        *truncated = true;
        return true;
    }

    *total_preview_chars += preview_chars;
    *truncated |= preview.truncated;
    matches.push(SearchMatch {
        path,
        line,
        preview: preview.text,
        preview_truncated: preview.truncated,
    });

    matches.len() >= max_results
}

fn optional_line(input: &Value, key: &str) -> Result<Option<usize>> {
    input
        .get(key)
        .map(|value| {
            value
                .as_u64()
                .ok_or_else(|| anyhow!("{key} must be a positive integer"))
                .and_then(|line| {
                    if line == 0 {
                        return Err(anyhow!("{key} must be greater than 0"));
                    }
                    usize::try_from(line).map_err(|_| anyhow!("{key} is too large"))
                })
        })
        .transpose()
}

fn optional_u64(input: &Value, key: &str) -> Result<Option<u64>> {
    input
        .get(key)
        .map(|value| {
            let number = value.as_u64().ok_or_else(|| anyhow!("{key} must be a positive integer"))?;
            if number == 0 {
                return Err(anyhow!("{key} must be greater than 0"));
            }
            Ok(number)
        })
        .transpose()
}

fn optional_nonnegative_u64(input: &Value, key: &str) -> Result<Option<u64>> {
    input
        .get(key)
        .map(|value| value.as_u64().ok_or_else(|| anyhow!("{key} must be a non-negative integer")))
        .transpose()
}

fn optional_string_array(input: &Value, key: &str) -> Result<Vec<String>> {
    let Some(value) = input.get(key) else {
        return Ok(Vec::new());
    };
    let array = value
        .as_array()
        .ok_or_else(|| anyhow!("{key} must be an array of strings"))?;
    array
        .iter()
        .map(|item| {
            item.as_str()
                .map(ToString::to_string)
                .ok_or_else(|| anyhow!("{key} must be an array of strings"))
        })
        .collect()
}

fn optional_string_map(input: &Value, key: &str) -> Result<HashMap<String, String>> {
    let Some(value) = input.get(key) else {
        return Ok(HashMap::new());
    };
    let object = value
        .as_object()
        .ok_or_else(|| anyhow!("{key} must be an object of strings"))?;
    object
        .iter()
        .map(|(name, value)| {
            value
                .as_str()
                .map(|text| (name.clone(), text.to_string()))
                .ok_or_else(|| anyhow!("{key} must be an object of strings"))
        })
        .collect()
}

fn build_file_diff(path: &str, before: &str, after: &str) -> String {
    let mut diff = format!("--- a/{path}\n+++ b/{path}\n");
    for line in before.lines() {
        diff.push_str(&format!("-{line}\n"));
    }
    for line in after.lines() {
        diff.push_str(&format!("+{line}\n"));
    }
    diff
}

fn ensure_allowed_fields(input: &Value, allowed: &[&str], priority_rejected: &[&str]) -> Result<()> {
    let mut allowed_with_internal = allowed.to_vec();
    allowed_with_internal.extend_from_slice(INTERNAL_TOOL_FIELDS);
    ensure_fields(input, &allowed_with_internal, priority_rejected)
}

fn ensure_fields(input: &Value, allowed: &[&str], priority_rejected: &[&str]) -> Result<()> {
    let Some(object) = input.as_object() else {
        return Err(anyhow!("tool input must be an object"));
    };
    for field in priority_rejected {
        if object.contains_key(*field) {
            return Err(anyhow!("unsupported input field: {}", *field));
        }
    }
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(anyhow!("unsupported input field: {key}"));
        }
    }
    Ok(())
}

fn is_generated_directory(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    matches!(
        name,
        ".git"
            | ".brainx"
            | ".next"
            | ".vite"
            | "build"
            | "coverage"
            | "dist"
            | "logs"
            | "node_modules"
            | "target"
    ) && path.is_dir()
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn expand_home_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) else {
        return path.to_path_buf();
    };
    if text == "~" {
        return PathBuf::from(home);
    }
    if let Some(rest) = text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        return PathBuf::from(home).join(rest);
    }
    path.to_path_buf()
}

fn command_stdout(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn default_shell_name() -> String {
    std::env::var("SHELL")
        .or_else(|_| std::env::var("COMSPEC"))
        .ok()
        .and_then(|shell| {
            Path::new(&shell)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| if cfg!(windows) { "cmd".to_string() } else { "sh".to_string() })
}

#[derive(Debug, Clone)]
struct CommandOutput {
    exit_code: i32,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

fn run_shell_command(
    command: &str,
    directory: &Path,
    timeout: Duration,
    env: &HashMap<String, String>,
) -> Result<CommandOutput> {
    let mut child = if cfg!(windows) {
        let mut builder = Command::new("cmd");
        builder
            .args(["/C", command])
            .current_dir(directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        builder.envs(env);
        builder.spawn().context("failed to spawn command")?
    } else {
        let mut builder = Command::new("sh");
        builder
            .args(["-lc", command])
            .current_dir(directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        builder.envs(env);
        builder.spawn().context("failed to spawn command")?
    };

    let started = Instant::now();
    let mut timed_out = false;
    loop {
        if child.try_wait().context("failed to poll command")?.is_some() {
            break;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            let _ = child.kill();
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }

    let output = child.wait_with_output().context("failed to collect command output")?;
    Ok(CommandOutput {
        exit_code: output.status.code().unwrap_or(if timed_out { 124 } else { 1 }),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        timed_out,
    })
}

fn spawn_background_shell_command(
    command: &str,
    directory: &Path,
    env: &HashMap<String, String>,
) -> Result<Child> {
    if cfg!(windows) {
        let mut builder = Command::new("cmd");
        builder
            .args(["/C", command])
            .current_dir(directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        builder.envs(env);
        builder.spawn().context("failed to spawn background command")
    } else {
        let mut command_builder = Command::new("sh");
        command_builder
            .args(["-lc", command])
            .current_dir(directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command_builder.envs(env);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command_builder.process_group(0);
        }
        command_builder.spawn().context("failed to spawn background command")
    }
}

fn spawn_background_reader<R: Read + Send + 'static>(
    registry: Arc<Mutex<BackgroundTaskRegistry>>,
    task_id: String,
    stream: &'static str,
    reader: Option<R>,
) {
    let Some(reader) = reader else {
        return;
    };
    std::thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => push_background_chunk(&registry, &task_id, stream, line.clone()),
                Err(error) => {
                    push_background_chunk(&registry, &task_id, "stderr", format!("failed to read {stream}: {error}"));
                    break;
                }
            }
        }
    });
}

fn push_background_chunk(
    registry: &Arc<Mutex<BackgroundTaskRegistry>>,
    task_id: &str,
    stream: &str,
    text: String,
) {
    let Ok(mut registry) = registry.lock() else {
        return;
    };
    let Some(task) = registry.tasks.get_mut(task_id) else {
        return;
    };
    push_background_chunk_to_task(task, stream, text);
}

fn push_background_chunk_to_task(task: &mut BackgroundTask, stream: &str, text: String) {
    task.next_cursor += 1;
    let cursor = task.next_cursor;
    task.chunks.push(BackgroundChunk {
        cursor,
        stream: stream.to_string(),
        text,
        timestamp: timestamp_now(),
    });
    let retained_from = task.next_cursor.saturating_sub(200);
    task.chunks.retain(|chunk| chunk.cursor > retained_from);
}

fn refresh_background_task_status(task: &mut BackgroundTask) -> Result<()> {
    if task.status != "running" {
        return Ok(());
    }
    if let Some(status) = task.child.try_wait().context("failed to poll background task")? {
        task.exit_code = Some(status.code().unwrap_or(1));
        task.status = if status.success() {
            "completed".to_string()
        } else {
            "failed".to_string()
        };
        task.stopped_at = Some(timestamp_now());
        return Ok(());
    }
    if task.started_instant.elapsed() >= Duration::from_secs(task.max_runtime_seconds) {
        stop_background_child(&mut task.child, task.pid, "terminate")?;
        let status = task.child.wait().context("failed to wait for timed out background task")?;
        task.exit_code = Some(status.code().unwrap_or(124));
        task.status = "timed_out".to_string();
        task.stopped_at = Some(timestamp_now());
        push_background_chunk_to_task(
            task,
            "stderr",
            format!("background task exceeded maxRuntimeSeconds ({}) and was terminated\n", task.max_runtime_seconds),
        );
    }
    Ok(())
}

fn stop_background_child(child: &mut Child, pid: u32, mode: &str) -> Result<()> {
    if cfg!(windows) || mode == "kill" {
        child.kill().context("failed to kill background task")?;
        return Ok(());
    }
    #[cfg(unix)]
    {
        let signal = if mode == "terminate" { "-TERM" } else { "-KILL" };
        let status = Command::new("kill")
            .arg(signal)
            .arg(format!("-{pid}"))
            .status()
            .context("failed to signal background process group")?;
        if status.success() {
            return Ok(());
        }
    }
    child.kill().context("failed to kill background task")
}

fn timestamp_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{millis}")
}

fn run_git_apply(root: &Path, patch: &str, check_only: bool) -> Result<CommandOutput> {
    let command = if check_only { "git apply --check -" } else { "git apply -" };
    let mut child = if cfg!(windows) {
        Command::new("cmd")
            .args(["/C", command])
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn git apply")?
    } else {
        Command::new("sh")
            .args(["-lc", command])
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn git apply")?
    };
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(patch.as_bytes()).context("failed to write patch to git apply")?;
    }
    let output = child.wait_with_output().context("failed to collect git apply output")?;
    Ok(CommandOutput {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        timed_out: false,
    })
}

fn changed_files_from_patch(patch: &str) -> Vec<String> {
    let mut files = Vec::new();
    for line in patch.lines() {
        let Some(path) = line.strip_prefix("+++ b/") else {
            continue;
        };
        if path != "/dev/null" && !files.iter().any(|existing| existing == path) {
            files.push(path.to_string());
        }
    }
    files
}
