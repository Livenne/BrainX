use anyhow::Result;
use brainx_client_daemon::auth::{
    bind_code, default_config_path, load_config, login, logout as auth_logout, save_config, sync_bound_daemon,
    sync_workspaces, unbind, ClientConfig,
};
use brainx_client_daemon::daemon::{run_loop, run_loop_with_config};
use brainx_client_daemon::lifecycle::{
    daemon_status, default_log_path, default_pid_path, ensure_daemon_stopped, start_daemon_background, stop_daemon,
    DaemonStatus,
};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Parser)]
#[command(name = "brainx-daemon")]
#[command(about = "brainx local client daemon prototype")]
struct Args {
    #[arg(long, env = "BRAINX_SERVER_URL", default_value = "http://localhost:8080")]
    server_url: String,

    #[arg(long, env = "BRAINX_WORKSPACE_ID", default_value = "w_core")]
    workspace_id: String,

    #[arg(long, env = "BRAINX_DEVICE_NAME", default_value = "local-dev")]
    device_name: String,

    #[arg(long, env = "BRAINX_WORKSPACE_ROOT", default_value = ".")]
    workspace_root: PathBuf,

    #[arg(long, env = "BRAINX_POLL_INTERVAL_MS", default_value_t = 1000)]
    poll_interval_ms: u64,

    #[arg(long, env = "BRAINX_CONFIG_PATH")]
    config_path: Option<PathBuf>,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    Login {
        #[arg(long)]
        username: String,
        #[arg(long)]
        password: String,
    },
    Bind {
        #[arg(long)]
        password: String,
    },
    Unbind {
        #[arg(long)]
        confirm: bool,
    },
    Logout,
    Start,
    Stop,
    #[command(hide = true)]
    RunForeground,
    Status,
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    Workspace {
        #[command(subcommand)]
        command: WorkspaceCommand,
    },
}

#[derive(Debug, Subcommand)]
enum ConfigCommand {
    Set {
        key: String,
        value: String,
    },
}

#[derive(Debug, Subcommand)]
enum WorkspaceCommand {
    List,
    Add {
        #[arg(long)]
        id: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        path: PathBuf,
    },
    Remove {
        #[arg(long)]
        id: String,
        #[arg(long)]
        confirm: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let config_path = match args.config_path.clone() {
        Some(path) => path,
        None => default_config_path()?,
    };

    match args.command {
        Some(Command::Login { username, password }) => {
            let mut config = login(&args.server_url, &username, &password).await?;
            config.device_name = args.device_name;
            save_config(config_path, &config)?;
            println!("Logged in as {username}");
            Ok(())
        }
        Some(Command::Bind { password }) => {
            let config = load_config(config_path)?;
            let response = bind_code(&config, &password).await?;
            println!("Bind code: {}", response.code);
            println!("Expires at: {}", response.expires_at);
            Ok(())
        }
        Some(Command::Unbind { confirm }) => {
            let mut config = load_config(config_path.clone())?;
            unbind(&config, confirm).await?;
            config.daemon_id = None;
            save_config(config_path, &config)?;
            println!("Client unbound");
            Ok(())
        }
        Some(Command::Logout) => {
            let pid_path = default_pid_path()?;
            ensure_daemon_stopped(&pid_path)?;
            let config = load_config(config_path.clone())?;
            let cleared = auth_logout(&config).await?;
            save_config(config_path, &cleared)?;
            println!("Logged out");
            Ok(())
        }
        Some(Command::Start) => {
            let config = load_config(config_path.clone())?;
            let synced = sync_bound_daemon(&config).await?;
            save_config(config_path.clone(), &synced)?;
            let pid_path = default_pid_path()?;
            let log_path = default_log_path()?;
            let pid = start_daemon_background(
                &synced,
                &config_path,
                &pid_path,
                &log_path,
                args.poll_interval_ms,
            )?;
            println!("Client daemon started as pid {pid}");
            println!("Log file: {}", log_path.display());
            Ok(())
        }
        Some(Command::Stop) => {
            let pid_path = default_pid_path()?;
            match stop_daemon(&pid_path)? {
                DaemonStatus::Running(pid) => println!("Client daemon stopped pid {pid}"),
                DaemonStatus::Stale(pid) => println!("Removed stale client daemon pidfile for pid {pid}"),
                DaemonStatus::NotStarted => println!("Client daemon is not running"),
            }
            Ok(())
        }
        Some(Command::RunForeground) => {
            let config = load_config(config_path)?;
            let workspace_root = PathBuf::from(&config.active_workspace()?.path);
            run_loop_with_config(
                &config,
                &workspace_root,
                Duration::from_millis(args.poll_interval_ms),
            )
            .await
        }
        Some(Command::Status) => {
            let config = load_config(config_path)?;
            let pid_path = default_pid_path()?;
            let log_path = default_log_path()?;
            println!("Server: {}", config.server_url);
            println!("Workspace: {}", config.active_workspace_id);
            println!("Workspace root: {}", config.active_workspace()?.path);
            println!("Device: {}", config.device_name);
            println!("User: {}", config.username.as_deref().unwrap_or("not logged in"));
            println!("Bound daemon: {}", config.daemon_id.as_deref().unwrap_or("none"));
            println!("Active model: {}", config.active_model);
            println!("Pid file: {}", pid_path.display());
            println!("Log file: {}", log_path.display());
            match daemon_status(&pid_path)? {
                DaemonStatus::Running(pid) => println!("Daemon process: running ({pid})"),
                DaemonStatus::Stale(pid) => println!("Daemon process: stale pidfile ({pid})"),
                DaemonStatus::NotStarted => println!("Daemon process: stopped"),
            }
            Ok(())
        }
        Some(Command::Config { command }) => {
            let mut config = load_config(config_path.clone()).unwrap_or_else(|_| {
                ClientConfig::new(&args.server_url, &args.device_name)
            });
            match command {
                ConfigCommand::Set { key, value } if key == "active-model" => {
                    config.model_config(Some(&value))?;
                    config.active_model = value;
                    save_config(config_path, &config)?;
                    println!("active-model={}", config.active_model);
                    Ok(())
                }
                ConfigCommand::Set { key, .. } => Err(anyhow::anyhow!("unsupported config key: {key}")),
            }
        }
        Some(Command::Workspace { command }) => {
            let mut config = load_config(config_path.clone()).unwrap_or_else(|_| {
                ClientConfig::new(&args.server_url, &args.device_name)
            });
            match command {
                WorkspaceCommand::List => {
                    for workspace in &config.workspaces {
                        let active = if workspace.id == config.active_workspace_id { "*" } else { " " };
                        println!("{active} {} {} {}", workspace.id, workspace.name, workspace.path);
                    }
                    Ok(())
                }
                WorkspaceCommand::Add { id, name, path } => {
                    config.add_workspace(id, name, path.to_string_lossy().to_string())?;
                    save_config(config_path, &config)?;
                    sync_workspaces_if_bound(&config).await?;
                    println!("Workspace added");
                    Ok(())
                }
                WorkspaceCommand::Remove { id, confirm } => {
                    config.remove_workspace(&id, confirm)?;
                    save_config(config_path, &config)?;
                    sync_workspaces_if_bound(&config).await?;
                    println!("Workspace removed");
                    Ok(())
                }
            }
        }
        None => {
            if let Ok(config) = load_config(config_path) {
                let workspace_root = PathBuf::from(&config.active_workspace()?.path);
                run_loop_with_config(
                    &config,
                    &workspace_root,
                    Duration::from_millis(args.poll_interval_ms),
                )
                .await
            } else {
                run_loop(
                    &args.server_url,
                    &args.workspace_id,
                    &args.device_name,
                    &args.workspace_root,
                    Duration::from_millis(args.poll_interval_ms),
                )
                .await
            }
        }
    }
}

async fn sync_workspaces_if_bound(config: &ClientConfig) -> Result<()> {
    if config.session_token.is_some() && config.daemon_id.is_some() {
        sync_workspaces(config).await?;
    }
    Ok(())
}
