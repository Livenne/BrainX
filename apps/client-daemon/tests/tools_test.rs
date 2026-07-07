use brainx_client_daemon::tools::{SearchMode, WorkspaceTools};
use serde_json::json;
use std::fs;

fn assert_error_contains<T: std::fmt::Debug>(result: anyhow::Result<T>, expected: &str) {
    assert!(result.is_err(), "expected error containing {expected}");
    let message = result.unwrap_err().to_string();
    assert!(
        message.contains(expected),
        "expected error containing {expected}, got {message}"
    );
}

#[test]
fn read_workspace_file_rejects_paths_outside_workspace() {
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools.read_workspace_file(outside.path(), None, None);

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("outside workspace"));
}

#[test]
fn search_workspace_finds_text_matches() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("README.md"), "brainx agent runtime").unwrap();
    fs::create_dir(workspace.path().join("src")).unwrap();
    fs::write(workspace.path().join("src/main.ts"), "const name = 'brainx';").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let matches = tools
        .search_workspace("brainx", SearchMode::Text)
        .expect("search should succeed");

    assert_eq!(matches.len(), 2);
    assert!(matches.iter().any(|m| m.path.ends_with("README.md")));
    assert!(matches.iter().any(|m| m.path.ends_with("src/main.ts")));
}

#[test]
fn search_workspace_rejects_empty_query() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools.search_workspace("   ", SearchMode::Text);

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("query must not be empty"));
}

#[test]
fn get_environment_reports_runtime_without_provider_details() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools.execute("get_env", &json!({})).expect("environment should load");

    assert_eq!(result["workspaceRoot"], workspace.path().display().to_string());
    assert!(result["os"].as_str().unwrap_or_default().len() > 1);
    assert!(result["arch"].as_str().unwrap_or_default().len() > 1);
    assert!(result["defaultShell"].as_str().unwrap_or_default().len() > 1);
    assert!(result["dateTime"]["iso"].as_str().unwrap_or_default().contains('T'));
    assert!(result["dateTime"]["timezone"].as_str().unwrap_or_default().len() > 1);
    assert!(result["dateTime"]["utcOffset"].as_str().unwrap_or_default().starts_with(['+', '-']));
    assert_eq!(result["model"]["name"], "stepfun-ai/step-3.7-flash");
    assert!(result["model"].get("provider").is_none());
    assert!(result["model"].get("baseUrl").is_none());
}

#[test]
fn execute_rejects_old_get_environment_tool_name() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools.execute("get_environment", &json!({}));

    assert_error_contains(result, "unsupported tool");
}

#[test]
fn execute_web_search_returns_mock_result_without_network() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute(
            "web_search",
            &json!({
                "query": "agent toolcall rendering",
                "domains": ["openai.com"],
                "recencyDays": 30,
                "maxResults": 3
            }),
        )
        .expect("web_search mock should succeed");

    assert_eq!(result["mock"], true);
    assert_eq!(result["query"], "agent toolcall rendering");
    assert!(result["results"].as_array().expect("results").len() >= 1);
    assert!(result["results"][0]["title"].as_str().unwrap_or_default().contains("Mock"));
}

#[test]
fn execute_rejects_removed_list_files_tool() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools.execute("list_files", &json!({}));

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("unsupported tool"));
}

#[test]
fn search_workspace_excludes_generated_directories() {
    let workspace = tempfile::tempdir().unwrap();
    fs::create_dir_all(workspace.path().join("src")).unwrap();
    fs::create_dir_all(workspace.path().join("node_modules/pkg")).unwrap();
    fs::create_dir_all(workspace.path().join("target")).unwrap();
    fs::write(workspace.path().join("src/main.ts"), "const marker = 'brainx';").unwrap();
    fs::write(workspace.path().join("node_modules/pkg/index.js"), "const marker = 'brainx';").unwrap();
    fs::write(workspace.path().join("target/output.txt"), "brainx").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let matches = tools
        .search_workspace("brainx", SearchMode::Text)
        .expect("search should succeed");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].path, "src/main.ts");
}

#[test]
fn search_workspace_excludes_runtime_log_directories() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("README.md"), "brainx README").unwrap();
    fs::create_dir_all(workspace.path().join("logs")).unwrap();
    fs::write(
        workspace.path().join("logs/brainx-bsc-trace.ndjson"),
        "brainx README trace payload",
    )
    .unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let matches = tools
        .search_workspace("README", SearchMode::Text)
        .expect("search should succeed");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].path, "README.md");
}

#[test]
fn execute_search_workspace_truncates_large_previews() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(
        workspace.path().join("large.txt"),
        format!("needle {}\n", "x".repeat(50_000)),
    )
    .unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute("search_workspace", &json!({"query": "needle"}))
        .expect("search should succeed");
    let preview = result["matches"][0]["preview"].as_str().expect("preview");

    assert!(preview.len() <= 320, "preview was {} bytes", preview.len());
    assert_eq!(result["matches"][0]["previewTruncated"], true);
    assert_eq!(result["truncated"], true);
}

#[test]
fn execute_read_files_truncates_large_file_content() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("large.txt"), "x".repeat(80_000)).unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute("read_files", &json!({"files": [{"path": "large.txt"}]}))
        .expect("read_files should succeed");
    let content = result["files"][0]["content"].as_str().expect("content");

    assert!(content.len() <= 33_000, "content was {} bytes", content.len());
    assert_eq!(result["files"][0]["contentTruncated"], true);
}

#[test]
fn execute_run_command_truncates_large_output_streams() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute(
            "run_command",
            &json!({
                "command": "python3 - <<'PY'\nimport sys\nprint('o' * 80000)\nprint('e' * 80000, file=sys.stderr)\nPY",
                "timeoutSeconds": 5
            }),
        )
        .expect("run_command should succeed");

    assert!(result["stdout"].as_str().expect("stdout").len() <= 33_000);
    assert!(result["stderr"].as_str().expect("stderr").len() <= 33_000);
    assert_eq!(result["stdoutTruncated"], true);
    assert_eq!(result["stderrTruncated"], true);
}

#[test]
fn execute_background_read_caps_large_requested_output() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let started = tools
        .execute(
            "background_start",
            &json!({
                "name": "large-output",
                "command": "python3 - <<'PY'\nprint('x' * 80000)\nPY",
                "workingDirectory": ".",
                "maxRuntimeSeconds": 5,
                "purpose": "test output budget"
            }),
        )
        .expect("background_start should succeed");
    let task_id = started["taskId"].as_str().expect("task id").to_string();

    std::thread::sleep(std::time::Duration::from_millis(200));
    let read = tools
        .execute(
            "background_read",
            &json!({"taskId": task_id, "cursor": 0, "maxBytes": 1_000_000}),
        )
        .expect("background_read should succeed");
    let chunks = read["chunks"].as_array().expect("chunks");
    let text = chunks[0]["text"].as_str().expect("chunk text");

    assert!(text.len() <= 33_000, "chunk text was {} bytes", text.len());
    assert_eq!(read["truncated"], true);
}

#[test]
fn execute_read_files_reads_one_or_many_files_with_line_ranges() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("README.md"), "one\ntwo\nthree\nfour\n").unwrap();
    fs::write(workspace.path().join("Cargo.toml"), "[package]\nname = \"brainx\"\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute(
            "read_files",
            &json!({
                "files": [
                    {"path": "README.md", "startLine": 2, "endLine": 3},
                    {"path": "Cargo.toml"}
                ]
            }),
        )
        .expect("read_files should succeed");

    assert_eq!(result["files"][0]["ok"], true);
    assert_eq!(result["files"][0]["path"], "README.md");
    assert_eq!(result["files"][0]["content"], "two\nthree");
    assert_eq!(result["files"][0]["startLine"], 2);
    assert_eq!(result["files"][0]["endLine"], 3);
    assert_eq!(result["files"][0]["totalLines"], 4);
    assert_eq!(result["files"][1]["ok"], true);
    assert!(result["files"][1]["content"].as_str().unwrap().contains("brainx"));
}

#[test]
fn execute_read_files_rejects_old_read_tools_and_aliases() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("README.md"), "one\ntwo\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let old_single = tools.execute("read_file", &json!({"path": "README.md"}));
    assert_error_contains(old_single, "unsupported tool");

    let old_many = tools.execute("read_many_files", &json!({"files": [{"path": "README.md"}]}));
    assert_error_contains(old_many, "unsupported tool");

    let old_alias = tools.execute("read_files", &json!({"paths": ["README.md"]}));
    assert_error_contains(old_alias, "unsupported input field: paths");

    let old_range = tools.execute("read_files", &json!({"files": [{"path": "README.md", "range": "1-2"}]}));
    assert_error_contains(old_range, "unsupported input field: range");
}

#[test]
fn execute_search_workspace_rejects_invalid_mode_and_zero_max_results() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("README.md"), "brainx\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let invalid_mode = tools.execute("search_workspace", &json!({"query": "brainx", "mode": "code"}));
    assert_error_contains(invalid_mode, "mode must be one of text, filename, regex");

    let zero_results = tools.execute("search_workspace", &json!({"query": "brainx", "maxResults": 0}));
    assert_error_contains(zero_results, "maxResults must be greater than 0");
}

#[test]
fn execute_write_file_requires_explicit_overwrite() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("note.md"), "old").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let rejected = tools.execute(
        "write_file",
        &json!({"path": "note.md", "content": "new", "overwrite": false}),
    );
    assert!(rejected.is_err());
    assert!(rejected.unwrap_err().to_string().contains("already exists"));

    let result = tools
        .execute(
            "write_file",
            &json!({"path": "note.md", "content": "new", "overwrite": true}),
        )
        .expect("write_file should overwrite when explicit");

    assert_eq!(result["path"], "note.md");
    assert_eq!(result["bytesWritten"], 3);
    assert!(result["diff"].as_str().unwrap_or_default().contains("-old"));
    assert!(result["diff"].as_str().unwrap_or_default().contains("+new"));
    assert_eq!(fs::read_to_string(workspace.path().join("note.md")).unwrap(), "new");
}

#[test]
fn execute_write_file_rejects_missing_overwrite_and_removed_preview_fields() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let missing_overwrite = tools.execute("write_file", &json!({"path": "note.md", "content": "new"}));
    assert_error_contains(missing_overwrite, "write_file requires input.overwrite");

    let old_preview_fields = tools.execute(
        "write_file",
        &json!({"path": "note.md", "content": "new", "overwrite": false, "mode": "create", "bytes": 3}),
    );
    assert_error_contains(old_preview_fields, "unsupported input field: mode");
}

#[test]
fn execute_run_command_returns_exit_code_and_output() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute(
            "run_command",
            &json!({"command": "printf brainx", "workingDirectory": ".", "timeoutSeconds": 5}),
        )
        .expect("run_command should succeed");

    assert_eq!(result["exitCode"], 0);
    assert_eq!(result["stdout"], "brainx");
    assert_eq!(result["stderr"], "");
    assert_eq!(result["timedOut"], false);
}

#[test]
fn execute_run_command_rejects_removed_cwd_timeout_aliases_and_zero_timeout() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let old_aliases = tools.execute(
        "run_command",
        &json!({"command": "printf brainx", "cwd": ".", "timeout_ms": 1000}),
    );
    assert_error_contains(old_aliases, "unsupported input field: cwd");

    let zero_timeout = tools.execute(
        "run_command",
        &json!({"command": "printf brainx", "workingDirectory": ".", "timeoutSeconds": 0}),
    );
    assert_error_contains(zero_timeout, "timeoutSeconds must be greater than 0");
}

#[test]
fn execute_apply_patch_checks_and_applies_unified_diff() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("note.md"), "old\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute(
            "apply_patch",
            &json!({
                "patch": "diff --git a/note.md b/note.md\n--- a/note.md\n+++ b/note.md\n@@ -1 +1 @@\n-old\n+new\n",
                "dryRun": false
            }),
        )
        .expect("apply_patch should succeed");

    assert_eq!(result["applied"], true);
    assert_eq!(result["changedFiles"][0], "note.md");
    assert_eq!(fs::read_to_string(workspace.path().join("note.md")).unwrap(), "new\n");
}

#[test]
fn execute_apply_patch_rejects_removed_files_alias() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools.execute("apply_patch", &json!({"files": ["note.md"]}));

    assert_error_contains(result, "unsupported input field: files");
}

#[test]
fn execute_tools_allow_server_internal_fields() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("README.md"), "brainx\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute(
            "read_files",
            &json!({
                "files": [{"path": "README.md"}],
                "toolCallId": "call_1",
                "toolName": "read_files",
                "batchId": "exec_1"
            }),
        )
        .expect("internal fields should not affect tool execution");

    assert_eq!(result["files"][0]["content"], "brainx");
}

#[test]
fn execute_background_task_lifecycle_returns_incremental_output_and_exit_status() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let started = tools
        .execute(
            "background_start",
            &json!({
                "name": "quick-task",
                "command": "printf first; printf second",
                "workingDirectory": ".",
                "maxRuntimeSeconds": 5,
                "purpose": "test buffered output"
            }),
        )
        .expect("background_start should succeed");

    assert_eq!(started["status"], "running");
    let task_id = started["taskId"].as_str().expect("task id").to_string();

    std::thread::sleep(std::time::Duration::from_millis(100));
    let first_read = tools
        .execute(
            "background_read",
            &json!({"taskId": task_id, "cursor": 0, "maxBytes": 12000}),
        )
        .expect("background_read should succeed");

    assert_eq!(first_read["taskId"], task_id);
    assert_eq!(first_read["status"], "completed");
    assert_eq!(first_read["exitCode"], 0);
    assert!(first_read["chunks"].to_string().contains("firstsecond"));
    let next_cursor = first_read["nextCursor"].as_u64().expect("next cursor");

    let second_read = tools
        .execute(
            "background_read",
            &json!({"taskId": task_id, "cursor": next_cursor, "maxBytes": 12000}),
        )
        .expect("background_read should support incremental reads");
    assert_eq!(second_read["chunks"].as_array().unwrap().len(), 0);
}

#[test]
fn execute_background_stop_terminates_running_task() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let started = tools
        .execute(
            "background_start",
            &json!({
                "name": "sleep-task",
                "command": "sleep 5",
                "workingDirectory": ".",
                "maxRuntimeSeconds": 10,
                "purpose": "test stop"
            }),
        )
        .expect("background_start should succeed");
    let task_id = started["taskId"].as_str().expect("task id").to_string();

    let stopped = tools
        .execute(
            "background_stop",
            &json!({"taskId": task_id, "mode": "terminate"}),
        )
        .expect("background_stop should succeed");

    assert_eq!(stopped["taskId"], task_id);
    assert_eq!(stopped["status"], "stopped");
}

#[test]
fn execute_background_read_times_out_long_running_task() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let started = tools
        .execute(
            "background_start",
            &json!({
                "name": "timeout-task",
                "command": "sleep 5",
                "workingDirectory": ".",
                "maxRuntimeSeconds": 1,
                "purpose": "test runtime limit"
            }),
        )
        .expect("background_start should succeed");
    let task_id = started["taskId"].as_str().expect("task id").to_string();

    std::thread::sleep(std::time::Duration::from_millis(1200));

    let read = tools
        .execute(
            "background_read",
            &json!({"taskId": task_id, "cursor": 0, "maxBytes": 12000}),
        )
        .expect("background_read should enforce runtime limit");

    assert_eq!(read["taskId"], task_id);
    assert_eq!(read["status"], "timed_out");
    assert_eq!(read["exitCode"], 124);
    assert!(read["chunks"].to_string().contains("exceeded maxRuntimeSeconds"));
}

#[test]
fn execute_background_tools_reject_invalid_inputs() {
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let outside_workdir = tools.execute(
        "background_start",
        &json!({
            "name": "bad",
            "command": "printf no",
            "workingDirectory": outside.path().display().to_string(),
            "purpose": "outside"
        }),
    );
    assert_error_contains(outside_workdir, "outside workspace");

    let bad_mode = tools.execute("background_stop", &json!({"taskId": "missing", "mode": "force"}));
    assert_error_contains(bad_mode, "mode must be one of terminate, kill");
}
