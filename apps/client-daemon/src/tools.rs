use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const DEFAULT_MODEL: &str = "stepfun-ai/step-3.7-flash";
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

#[derive(Debug, Clone)]
pub struct WorkspaceTools {
    root: PathBuf,
    background_tasks: Arc<Mutex<BackgroundTaskRegistry>>,
}

impl WorkspaceTools {
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
            background_tasks: Arc::new(Mutex::new(BackgroundTaskRegistry::default())),
        }
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
            "web_search" => {
                ensure_allowed_fields(input, &["query", "domains", "recencyDays", "maxResults"], &[])?;
                let query = input
                    .get("query")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("web_search requires input.query"))?;
                let query = query.trim();
                if query.is_empty() {
                    return Err(anyhow!("web_search query must not be empty"));
                }
                let domains = optional_string_array(input, "domains")?;
                let recency_days = optional_u64(input, "recencyDays")?;
                let max_results = optional_u64(input, "maxResults")?.unwrap_or(3).clamp(1, 10);
                Ok(json!({
                    "mock": true,
                    "query": query,
                    "domains": domains,
                    "recencyDays": recency_days,
                    "results": (0..max_results)
                        .map(|index| json!({
                            "title": format!("Mock web search result {} for {query}", index + 1),
                            "url": format!("https://example.invalid/brainx/search/{}", index + 1),
                            "snippet": format!("Mock result for '{query}'. Real web search is not enabled in this brainx build.")
                        }))
                        .collect::<Vec<_>>()
                }))
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
                let overwrite = input
                    .get("overwrite")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| anyhow!("write_file requires input.overwrite"))?;
                let create_parents = input.get("createParents").and_then(Value::as_bool).unwrap_or(true);
                self.write_file(path, content, overwrite, create_parents)
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
                ensure_allowed_fields(input, &["command", "workingDirectory", "timeoutSeconds"], &["cwd", "timeout_ms", "shell"])?;
                let command = input
                    .get("command")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("run_command requires input.command"))?;
                let working_directory = input
                    .get("workingDirectory")
                    .and_then(Value::as_str)
                    .unwrap_or(".");
                let timeout_seconds = optional_u64(input, "timeoutSeconds")?
                    .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
                    .clamp(1, MAX_TIMEOUT_SECONDS);
                self.run_command(command, working_directory, timeout_seconds)
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
                "name": std::env::var("BRAINX_NVIDIA_MODEL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| DEFAULT_MODEL.to_string())
            }
        })
    }

    pub fn read_workspace_file(&self, path: impl AsRef<Path>, start_line: Option<usize>, end_line: Option<usize>) -> Result<String> {
        Ok(self.read_workspace_file_selection(path, start_line, end_line)?.content)
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

    fn read_workspace_file_selection(&self, path: impl AsRef<Path>, start_line: Option<usize>, end_line: Option<usize>) -> Result<FileSelection> {
        let path = self.resolve_workspace_path(path)?;
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let start = start_line.unwrap_or(1).max(1);
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

    fn run_command(&self, command: &str, working_directory: &str, timeout_seconds: u64) -> Result<Value> {
        if command.trim().is_empty() {
            return Err(anyhow!("run_command command must not be empty"));
        }
        let directory = self.resolve_workspace_directory(working_directory)?;
        let output = run_shell_command(command, &directory, Duration::from_secs(timeout_seconds))?;
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
        let mut child = spawn_background_shell_command(command, &directory)?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let started_at = timestamp_now();
        let started_instant = Instant::now();
        let task_id = {
            let mut registry = self.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
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
        spawn_background_reader(self.background_tasks.clone(), task_id.clone(), "stdout", stdout);
        spawn_background_reader(self.background_tasks.clone(), task_id.clone(), "stderr", stderr);
        Ok(json!({
            "taskId": task_id,
            "status": "running",
            "pid": pid,
            "startedAt": started_at,
            "cursor": 0
        }))
    }

    fn background_read(&self, task_id: &str, cursor: u64, max_bytes: u64) -> Result<Value> {
        let mut registry = self.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
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
        let mut registry = self.background_tasks.lock().map_err(|_| anyhow!("background task registry is poisoned"))?;
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
        Ok(json!({
            "taskId": task_id,
            "status": task.status,
            "stoppedAt": task.stopped_at
        }))
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

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
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

fn run_shell_command(command: &str, directory: &Path, timeout: Duration) -> Result<CommandOutput> {
    let mut child = if cfg!(windows) {
        Command::new("cmd")
            .args(["/C", command])
            .current_dir(directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn command")?
    } else {
        Command::new("sh")
            .args(["-lc", command])
            .current_dir(directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn command")?
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

fn spawn_background_shell_command(command: &str, directory: &Path) -> Result<Child> {
    if cfg!(windows) {
        Command::new("cmd")
            .args(["/C", command])
            .current_dir(directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn background command")
    } else {
        let mut command_builder = Command::new("sh");
        command_builder
            .args(["-lc", command])
            .current_dir(directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
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
