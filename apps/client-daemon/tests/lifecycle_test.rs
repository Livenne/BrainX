use brainx_client_daemon::auth::{ClientConfig, ClientProviderConfig};
use brainx_client_daemon::lifecycle::{
    build_start_command_args, clear_stale_pidfile, daemon_status, ensure_daemon_stopped, DaemonStatus,
};
use std::fs;

#[test]
fn daemon_status_reports_current_process_as_running() {
    let temp = tempfile::tempdir().unwrap();
    let pid_path = temp.path().join("client.pid");
    fs::write(&pid_path, std::process::id().to_string()).unwrap();

    let status = daemon_status(&pid_path).unwrap();

    assert_eq!(status, DaemonStatus::Running(std::process::id()));
}

#[test]
fn clear_stale_pidfile_removes_non_running_process_record() {
    let temp = tempfile::tempdir().unwrap();
    let pid_path = temp.path().join("client.pid");
    fs::write(&pid_path, "4294967294").unwrap();

    let status = clear_stale_pidfile(&pid_path).unwrap();

    assert_eq!(status, DaemonStatus::Stale(4294967294));
    assert!(!pid_path.exists());
}

#[test]
fn ensure_daemon_stopped_rejects_running_pidfile() {
    let temp = tempfile::tempdir().unwrap();
    let pid_path = temp.path().join("client.pid");
    fs::write(&pid_path, std::process::id().to_string()).unwrap();

    let result = ensure_daemon_stopped(&pid_path);

    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("brainx stop"));
}

#[test]
fn start_command_args_use_saved_config_and_hidden_foreground_mode() {
    let temp = tempfile::tempdir().unwrap();
    let config_path = temp.path().join("client.json");
    let config = ClientConfig {
        server_url: "http://localhost:8080".to_string(),
        device_name: "devbox".to_string(),
        installation_id: "install-test".to_string(),
        daemon_id: Some("cd_1".to_string()),
        client_token: Some("bc_test".to_string()),
        providers: vec![ClientProviderConfig {
            name: "nvidia".to_string(),
            base_url: "https://integrate.api.nvidia.com/v1".to_string(),
            api_key: "env:NVIDIA_API_KEY".to_string(),
            protocol: "openai".to_string(),
        }],
        web_search: None,
        model_context_windows: Default::default(),
    };

    let args = build_start_command_args(&config, &config_path, 750).unwrap();
    let rendered: Vec<String> = args.iter().map(|arg| arg.to_string_lossy().to_string()).collect();

    assert_eq!(rendered.last().map(String::as_str), Some("run-foreground"));
    assert!(!rendered.iter().any(|arg| arg == "--workspace-root"));
    assert!(rendered.windows(2).any(|pair| pair == ["--config-path", config_path.to_string_lossy().as_ref()]));
    assert!(rendered.windows(2).any(|pair| pair == ["--poll-interval-ms", "750"]));
}
