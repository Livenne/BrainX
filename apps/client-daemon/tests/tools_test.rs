use brainx_client_daemon::auth::WebSearchConfig;
use brainx_client_daemon::tools::{SearchMode, WorkspaceTools};
use serde_json::{json, Value};
use std::fs;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

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
    assert_eq!(result["model"]["name"], "nvidia:stepfun-ai/step-3.7-flash");
    assert_eq!(result["model"]["model"], "stepfun-ai/step-3.7-flash");
    assert!(result["model"].get("provider").is_none());
    assert!(result["model"].get("baseUrl").is_none());
}

#[test]
fn get_environment_reports_selected_request_model() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path()).with_active_model_info("gpt:gpt-5.5", "gpt-5.5");

    let result = tools.execute("get_env", &json!({})).expect("environment should load");

    assert_eq!(result["model"]["name"], "gpt:gpt-5.5");
    assert_eq!(result["model"]["model"], "gpt-5.5");
}

#[test]
fn skill_inventory_scans_project_and_global_skill_markdown() {
    let workspace = tempfile::tempdir().unwrap();
    let global = tempfile::tempdir().unwrap();
    let project_skill = workspace.path().join(".agents/skills/debug-rust/SKILL.md");
    let global_skill = global.path().join(".agents/skills/write-plan/SKILL.md");
    fs::create_dir_all(project_skill.parent().unwrap()).unwrap();
    fs::create_dir_all(global_skill.parent().unwrap()).unwrap();
    fs::write(
        &project_skill,
        "---\nname: debug-rust\ndescription: Debug Rust test failures\nversion: 1\ntriggers:\n  - cargo test\n---\n# Debug Rust\n",
    )
    .unwrap();
    fs::write(
        &global_skill,
        "---\nname: write-plan\ndescription: Write implementation plans\n---\n# Write Plan\n",
    )
    .unwrap();
    let tools = WorkspaceTools::new(workspace.path()).with_global_skill_root(global.path().join(".agents/skills"));

    let inventory = tools.skill_inventory().expect("skills should scan");

    assert_eq!(inventory["projectRoot"], workspace.path().display().to_string());
    assert_eq!(inventory["project"][0]["name"], "debug-rust");
    assert_eq!(inventory["project"][0]["description"], "Debug Rust test failures");
    assert_eq!(inventory["project"][0]["path"], project_skill.display().to_string());
    assert_eq!(inventory["global"][0]["name"], "write-plan");
    assert_eq!(inventory["global"][0]["scope"], "global");
}

#[test]
fn create_and_renovation_skill_return_proposals_without_writing_files() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());
    let target = workspace.path().join(".agents/skills/new-skill/SKILL.md");

    let created = tools
        .execute(
            "create_skill",
            &json!({
                "scope": "project",
                "path": target,
                "content": "---\nname: new-skill\ndescription: New skill\n---\n# New Skill\n",
                "reason": "Reusable workflow",
                "evidence": ["session summary"]
            }),
        )
        .expect("create_skill should produce proposal");
    let renovated = tools
        .execute(
            "renovation_skill",
            &json!({
                "path": target,
                "content": "---\nname: new-skill\ndescription: Updated skill\n---\n# New Skill\n",
                "reason": "Improve workflow"
            }),
        )
        .expect("renovation_skill should produce proposal");

    assert_eq!(created["proposalType"], "create_skill");
    assert_eq!(renovated["proposalType"], "renovation_skill");
    assert!(!target.exists(), "skill proposal tools must not write files before approval");
}

#[test]
fn skill_apply_writes_only_under_skill_roots_after_path_normalization() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());
    let target = workspace.path().join(".agents/skills/new-skill/SKILL.md");

    let applied = tools
        .execute(
            "skill.apply",
            &json!({
                "path": target,
                "content": "# New Skill\n"
            }),
        )
        .expect("approved skill should write under .agents/skills");

    assert_eq!(applied["bytes"], "# New Skill\n".len());
    assert_eq!(fs::read_to_string(&target).unwrap(), "# New Skill\n");

    let traversal = workspace.path().join(".agents/skills/../outside/SKILL.md");
    let rejected = tools.execute(
        "skill.apply",
        &json!({
            "path": traversal,
            "content": "# Outside\n"
        }),
    );

    assert_error_contains(rejected, "skill.apply target must be under project .agents/skills or global ~/.agents/skills");
}

#[test]
fn execute_rejects_old_get_environment_tool_name() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools.execute("get_environment", &json!({}));

    assert_error_contains(result, "unsupported tool");
}

#[tokio::test]
async fn execute_web_search_posts_tavily_request_and_normalizes_results() {
    let tavily = MockServer::start().await;
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path()).with_web_search_config(Some(WebSearchConfig {
        provider: "tavily".to_string(),
        base_url: tavily.uri(),
        api_key: "literal:tavily-test-key".to_string(),
        timeout_seconds: 20,
    }));
    let long_content = "x".repeat(40_000);
    Mock::given(method("POST"))
        .and(path("/search"))
        .and(|request: &wiremock::Request| {
            request
                .headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                == Some("Bearer tavily-test-key")
        })
        .and(|request: &wiremock::Request| {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            body["query"] == "agent toolcall rendering"
                && body["search_depth"] == "advanced"
                && body["topic"] == "news"
                && body["max_results"] == 3
                && body["days"] == 7
                && body["include_answer"] == true
                && body["include_raw_content"] == false
                && body["include_domains"] == json!(["openai.com"])
                && body["exclude_domains"] == json!(["example.com"])
        })
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "query": "agent toolcall rendering",
            "answer": "Use concise tool frames.",
            "request_id": "tvly_req_1",
            "response_time": 1.25,
            "results": [{
                "title": "Agent tool rendering",
                "url": "https://openai.com/example",
                "content": long_content,
                "score": 0.93
            }]
        })))
        .expect(1)
        .mount(&tavily)
        .await;

    let result = tools
        .execute_async(
            "web_search",
            &json!({
                "query": "agent toolcall rendering",
                "searchDepth": "advanced",
                "topic": "news",
                "maxResults": 3,
                "days": 7,
                "includeDomains": ["openai.com"],
                "excludeDomains": ["example.com"],
                "includeAnswer": true,
                "includeRawContent": false
            }),
        )
        .await
        .expect("web_search should call Tavily");

    assert_eq!(result["query"], "agent toolcall rendering");
    assert_eq!(result["answer"], "Use concise tool frames.");
    assert_eq!(result["requestId"], "tvly_req_1");
    assert_eq!(result["responseTime"], 1.25);
    assert_eq!(result["results"][0]["title"], "Agent tool rendering");
    assert_eq!(result["results"][0]["url"], "https://openai.com/example");
    assert!(result["results"][0]["content"].as_str().unwrap().len() < 40_000);
    assert_eq!(result["truncated"], true);
}

#[tokio::test]
async fn execute_web_search_requires_local_tavily_config() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute_async("web_search", &json!({"query": "brainx"}))
        .await;

    assert_error_contains(result, "web_search is not configured");
}

#[test]
fn execute_read_file_allows_absolute_path_outside_workspace() {
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), "one\ntwo\nthree\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute("read_file", &json!({"path": outside.path(), "offset": 2, "limit": 1}))
        .expect("read_file may read outside workspace");

    assert_eq!(result["path"], outside.path().to_string_lossy().as_ref());
    assert_eq!(result["content"], "two");
    assert_eq!(result["startLine"], 2);
}

#[test]
fn execute_write_and_edit_file_reject_paths_outside_workspace() {
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let write = tools.execute("write_file", &json!({"path": outside.path(), "content": "new"}));
    let edit = tools.execute(
        "edit_file",
        &json!({"path": outside.path(), "old_string": "old", "new_string": "new"}),
    );

    assert_error_contains(write, "outside workspace");
    assert_error_contains(edit, "outside workspace");
}

#[test]
fn execute_edit_file_replaces_unique_string_inside_workspace() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("note.md"), "alpha\nbeta\ngamma\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute(
            "edit_file",
            &json!({"path": "note.md", "old_string": "beta", "new_string": "delta"}),
        )
        .expect("edit_file should replace unique text");

    assert_eq!(result["path"], "note.md");
    assert!(result["diff"].as_str().unwrap().contains("-beta"));
    assert_eq!(fs::read_to_string(workspace.path().join("note.md")).unwrap(), "alpha\ndelta\ngamma\n");
}

#[test]
fn execute_list_directory_and_search_content_support_new_names() {
    let workspace = tempfile::tempdir().unwrap();
    fs::create_dir_all(workspace.path().join("src")).unwrap();
    fs::write(workspace.path().join("src/main.ts"), "const marker = 'brainx';\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let listed = tools
        .execute("list_directory", &json!({"path": ".", "recursive": true, "max_depth": 2}))
        .expect("list_directory should succeed");
    let searched = tools
        .execute("search_content", &json!({"pattern": "brainx", "path": ".", "max_results": 5}))
        .expect("search_content should succeed");

    assert!(listed["entries"].to_string().contains("src/main.ts"));
    assert_eq!(searched["matches"][0]["path"], "src/main.ts");
}

#[test]
fn workspace_tools_expand_home_relative_roots() {
    let tools = WorkspaceTools::new("~");

    let result = tools.execute("list_directory", &json!({"path": ".", "recursive": false}));

    assert!(result.is_ok(), "expected ~ to resolve to the user home directory: {result:?}");
}

#[test]
fn execute_run_command_uses_workdir_and_rejects_outside_workspace() {
    let workspace = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let ok = tools
        .execute("run_command", &json!({"command": "printf brainx", "workdir": ".", "timeout": 5}))
        .expect("run_command should accept new workdir and timeout fields");
    let rejected = tools.execute(
        "run_command",
        &json!({"command": "printf no", "workdir": outside.path(), "timeout": 5}),
    );

    assert_eq!(ok["stdout"], "brainx");
    assert_error_contains(rejected, "outside workspace");
}

#[test]
fn execute_todo_tools_create_update_and_list_tasks() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let created = tools
        .execute(
            "todo_create",
            &json!({
                "tasks": [
                    {"id": "1", "title": "Inspect code", "status": "pending"},
                    {"id": "2", "title": "Run tests", "dependencies": ["1"]}
                ]
            }),
        )
        .expect("todo_create should succeed");
    let updated = tools
        .execute("todo_update", &json!({"task_id": "1", "status": "completed"}))
        .expect("todo_update should succeed");
    let listed = tools
        .execute("todo_list", &json!({"filter": "completed"}))
        .expect("todo_list should succeed");

    assert_eq!(created["tasks"].as_array().unwrap().len(), 2);
    assert_eq!(updated["task"]["status"], "completed");
    assert_eq!(listed["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(listed["tasks"][0]["id"], "1");
}

#[test]
fn workspace_tools_can_share_todo_state_across_request_instances() {
    let workspace = tempfile::tempdir().unwrap();
    let runtime = brainx_client_daemon::tools::ToolRuntimeState::default();
    let first_request_tools = WorkspaceTools::new_with_state(workspace.path(), runtime.clone());
    let second_request_tools = WorkspaceTools::new_with_state(workspace.path(), runtime);

    first_request_tools
        .execute(
            "todo_create",
            &json!({
                "tasks": [
                    {"id": "1", "title": "Persist across requests", "status": "pending"}
                ]
            }),
        )
        .expect("todo_create should succeed");
    let listed = second_request_tools
        .execute("todo_list", &json!({"filter": "all"}))
        .expect("todo_list should read shared state");

    assert_eq!(listed["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(listed["tasks"][0]["title"], "Persist across requests");
}

#[test]
fn workspace_tools_can_share_terminal_state_across_request_instances() {
    let workspace = tempfile::tempdir().unwrap();
    let runtime = brainx_client_daemon::tools::ToolRuntimeState::default();
    let first_request_tools = WorkspaceTools::new_with_state(workspace.path(), runtime.clone());
    let second_request_tools = WorkspaceTools::new_with_state(workspace.path(), runtime);

    first_request_tools
        .execute(
            "terminal_spawn",
            &json!({
                "terminal_id": "term_shared",
                "command": "read line; printf \"shared:$line\\n\"",
                "workdir": "."
            }),
        )
        .expect("terminal_spawn should start");
    second_request_tools
        .execute("terminal_input", &json!({"terminal_id": "term_shared", "input_text": "hello\n"}))
        .expect("terminal_input should find shared terminal");
    std::thread::sleep(std::time::Duration::from_millis(100));
    let output = second_request_tools
        .execute("terminal_output", &json!({"terminal_id": "term_shared", "lines": 20}))
        .expect("terminal_output should read shared terminal output");

    assert!(output["output"].as_str().unwrap_or_default().contains("shared:hello"));
}

#[test]
fn execute_ask_user_returns_pending_question_payload() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute(
            "ask_user",
            &json!({
                "question": "Which option should I use?",
                "question_type": "preference",
                "options": ["A", "B"],
                "context_note": "Need a user decision."
            }),
        )
        .expect("ask_user should produce a pause payload");

    assert_eq!(result["status"], "waiting_for_user");
    assert_eq!(result["question"], "Which option should I use?");
    assert_eq!(result["options"][0], "A");
}

#[test]
fn execute_terminal_tools_spawn_input_output_list_and_kill() {
    let workspace = tempfile::tempdir().unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let spawned = tools
        .execute(
            "terminal_spawn",
            &json!({
                "terminal_id": "term_test",
                "command": "read line; printf \"got:$line\\n\"",
                "workdir": "."
            }),
        )
        .expect("terminal_spawn should start");
    assert_eq!(spawned["terminalId"], "term_test");

    tools
        .execute("terminal_input", &json!({"terminal_id": "term_test", "input_text": "hello\n"}))
        .expect("terminal_input should write to process stdin");
    std::thread::sleep(std::time::Duration::from_millis(100));
    let output = tools
        .execute("terminal_output", &json!({"terminal_id": "term_test", "lines": 20}))
        .expect("terminal_output should read buffered output");
    let listed = tools.execute("terminal_list", &json!({})).expect("terminal_list should work");

    assert!(output["output"].as_str().unwrap_or_default().contains("got:hello"));
    assert!(listed["terminals"].to_string().contains("term_test"));

    let sleeper = tools
        .execute(
            "terminal_spawn",
            &json!({"terminal_id": "term_sleep", "command": "sleep 5", "workdir": "."}),
        )
        .expect("second terminal should start");
    assert_eq!(sleeper["status"], "running");
    let killed = tools
        .execute("terminal_kill", &json!({"terminal_id": "term_sleep"}))
        .expect("terminal_kill should stop a running process");
    assert_eq!(killed["status"], "stopped");

    let listed_after_kill = tools.execute("terminal_list", &json!({})).expect("terminal_list should work after kill");
    assert!(!listed_after_kill["terminals"].to_string().contains("term_sleep"));
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

    let mut read = json!({});
    for _ in 0..20 {
        read = tools
            .execute(
                "background_read",
                &json!({"taskId": task_id, "cursor": 0, "maxBytes": 1_000_000}),
            )
            .expect("background_read should succeed");
        if read["chunks"].as_array().map(|chunks| !chunks.is_empty()).unwrap_or(false) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
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
fn execute_read_files_reports_directories_as_list_directory_targets() {
    let workspace = tempfile::tempdir().unwrap();
    fs::create_dir_all(workspace.path().join("src")).unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let result = tools
        .execute("read_files", &json!({"files": [{"path": "src"}]}))
        .expect("read_files should report per-file failures without failing the batch");

    assert_eq!(result["files"][0]["ok"], false);
    let error = result["files"][0]["error"].as_str().expect("error");
    assert!(error.contains("path is a directory"));
    assert!(error.contains("list_directory"));
}

#[test]
fn execute_read_files_rejects_old_many_read_tool_and_aliases() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("README.md"), "one\ntwo\n").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

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
fn execute_write_file_defaults_to_full_overwrite_and_rejects_removed_preview_fields() {
    let workspace = tempfile::tempdir().unwrap();
    fs::write(workspace.path().join("note.md"), "old").unwrap();
    let tools = WorkspaceTools::new(workspace.path());

    let overwritten = tools
        .execute("write_file", &json!({"path": "note.md", "content": "new"}))
        .expect("write_file should overwrite by default");
    assert_eq!(overwritten["path"], "note.md");
    assert_eq!(fs::read_to_string(workspace.path().join("note.md")).unwrap(), "new");

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

    let read_after_stop = tools.execute("background_read", &json!({"taskId": task_id, "cursor": 0, "maxBytes": 100}));
    assert!(read_after_stop.is_err());
    assert!(read_after_stop.unwrap_err().to_string().contains("background task not found"));
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
