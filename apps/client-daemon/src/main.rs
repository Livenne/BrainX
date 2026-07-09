use anyhow::Result;
use brainx_client_daemon::auth::{
    bind_code, default_config_path, default_workspace_path, load_config, load_or_create_config,
    resolve_device_name, save_config, unbind, ClientProviderConfig,
};
use brainx_client_daemon::daemon::run_loop_with_config;
use brainx_client_daemon::lifecycle::{
    daemon_status, default_log_path, default_pid_path, start_daemon_background, stop_daemon, DaemonStatus,
};
use clap::{Parser, Subcommand};
use std::io::{self, Write};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Parser)]
#[command(name = "brainx")]
#[command(about = "brainx local client")]
struct Args {
    #[arg(long, env = "BRAINX_SERVER_URL", default_value = "http://localhost:8080")]
    server_url: String,

    #[arg(long, env = "BRAINX_DEVICE_NAME")]
    device_name: Option<String>,

    #[arg(long, env = "BRAINX_POLL_INTERVAL_MS", default_value_t = 1000)]
    poll_interval_ms: u64,

    #[arg(long, env = "BRAINX_CONFIG_PATH")]
    config_path: Option<PathBuf>,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    Start,
    Stop,
    Bind,
    Unbind {
        #[arg(long)]
        confirm: bool,
    },
    Status,
    Provider {
        #[command(subcommand)]
        command: Option<ProviderCommand>,
    },
    #[command(alias = "ws")]
    Workspace,
    #[command(hide = true)]
    RunForeground,
}

#[derive(Debug, Subcommand)]
enum ProviderCommand {
    Add,
    Remove { name: String },
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let config_path = args.config_path.clone().unwrap_or(default_config_path()?);
    let device_name = resolve_device_name(args.device_name.clone());

    match args.command {
        Some(Command::Start) => {
            let config = load_or_create_config(config_path.clone(), &args.server_url, &device_name)?;
            let pid_path = default_pid_path()?;
            let log_path = default_log_path()?;
            let pid = start_daemon_background(&config, &config_path, &pid_path, &log_path, args.poll_interval_ms)?;
            println!("brainx started as pid {pid}");
            println!("Log file: {}", log_path.display());
            Ok(())
        }
        Some(Command::Stop) => {
            let pid_path = default_pid_path()?;
            match stop_daemon(&pid_path)? {
                DaemonStatus::Running(pid) => println!("brainx stopped pid {pid}"),
                DaemonStatus::Stale(pid) => println!("Removed stale brainx pidfile for pid {pid}"),
                DaemonStatus::NotStarted => println!("brainx is not running"),
            }
            Ok(())
        }
        Some(Command::Bind) => {
            let config = load_config(config_path)?;
            let response = bind_code(&config).await?;
            println!("Bind code: {}", response.code);
            println!("Expires at: {}", response.expires_at);
            Ok(())
        }
        Some(Command::Unbind { confirm }) => {
            let mut config = load_config(config_path.clone())?;
            unbind(&config, confirm).await?;
            config.daemon_id = None;
            config.client_token = None;
            save_config(config_path, &config)?;
            println!("brainx unbound");
            Ok(())
        }
        Some(Command::Status) => {
            let config = load_or_create_config(config_path, &args.server_url, &device_name)?;
            let pid_path = default_pid_path()?;
            let log_path = default_log_path()?;
            println!("Server: {}", config.server_url);
            println!("Device: {}", config.device_name);
            println!("Daemon: {}", config.daemon_id.as_deref().unwrap_or("none"));
            println!("Default workspace: {}", default_workspace_path()?.display());
            println!("Pid file: {}", pid_path.display());
            println!("Log file: {}", log_path.display());
            match daemon_status(&pid_path)? {
                DaemonStatus::Running(pid) => println!("Process: running ({pid})"),
                DaemonStatus::Stale(pid) => println!("Process: stale pidfile ({pid})"),
                DaemonStatus::NotStarted => println!("Process: stopped"),
            }
            Ok(())
        }
        Some(Command::Provider { command }) => {
            let mut config = load_or_create_config(config_path.clone(), &args.server_url, &device_name)?;
            match command {
                None => {
                    for provider in &config.providers {
                        println!("{} {} {}", provider.name, provider.protocol, provider.base_url);
                    }
                    Ok(())
                }
                Some(ProviderCommand::Add) => {
                    let provider = prompt_provider()?;
                    config.add_provider(provider)?;
                    save_config(config_path, &config)?;
                    println!("Provider added");
                    Ok(())
                }
                Some(ProviderCommand::Remove { name }) => {
                    config.remove_provider(&name)?;
                    save_config(config_path, &config)?;
                    println!("Provider removed");
                    Ok(())
                }
            }
        }
        Some(Command::Workspace) => {
            println!("Workspace lists are no longer managed by the brainx CLI.");
            println!("Default local workspace: {}", default_workspace_path()?.display());
            println!("Use /workspace <path> inside a Chat Session to change that Session's current workspace.");
            Ok(())
        }
        Some(Command::RunForeground) => {
            let config = load_or_create_config(config_path.clone(), &args.server_url, &device_name)?;
            run_loop_with_config(config_path, config, Duration::from_millis(args.poll_interval_ms)).await
        }
        None => {
            let config = load_or_create_config(config_path.clone(), &args.server_url, &device_name)?;
            run_loop_with_config(config_path, config, Duration::from_millis(args.poll_interval_ms)).await
        }
    }
}

fn prompt_provider() -> Result<ClientProviderConfig> {
    Ok(ClientProviderConfig {
        name: prompt("name")?,
        base_url: prompt("baseUrl")?,
        api_key: prompt("apiKey")?,
        protocol: prompt("protocol")?,
    })
}

fn prompt(label: &str) -> Result<String> {
    print!("{label}: ");
    io::stdout().flush()?;
    let mut value = String::new();
    io::stdin().read_line(&mut value)?;
    Ok(value.trim().to_string())
}
