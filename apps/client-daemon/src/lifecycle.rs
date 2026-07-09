use crate::auth::{default_state_dir, ClientConfig};
use anyhow::{anyhow, Context, Result};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonStatus {
    NotStarted,
    Running(u32),
    Stale(u32),
}

pub fn default_pid_path() -> Result<PathBuf> {
    Ok(default_state_dir()?.join("client.pid"))
}

pub fn default_log_path() -> Result<PathBuf> {
    Ok(default_state_dir()?.join("client.log"))
}

pub fn daemon_status(pid_path: &Path) -> Result<DaemonStatus> {
    let pid = match read_pid(pid_path)? {
        Some(pid) => pid,
        None => return Ok(DaemonStatus::NotStarted),
    };

    if process_exists(pid) {
        Ok(DaemonStatus::Running(pid))
    } else {
        Ok(DaemonStatus::Stale(pid))
    }
}

pub fn clear_stale_pidfile(pid_path: &Path) -> Result<DaemonStatus> {
    let status = daemon_status(pid_path)?;
    if matches!(status, DaemonStatus::Stale(_)) {
        fs::remove_file(pid_path).with_context(|| format!("failed to remove stale pidfile {}", pid_path.display()))?;
    }
    Ok(status)
}

pub fn ensure_daemon_stopped(pid_path: &Path) -> Result<()> {
    match clear_stale_pidfile(pid_path)? {
        DaemonStatus::Running(pid) => Err(anyhow!("client daemon is already running as pid {pid}; run brainx stop first")),
        DaemonStatus::NotStarted | DaemonStatus::Stale(_) => Ok(()),
    }
}

pub fn stop_daemon(pid_path: &Path) -> Result<DaemonStatus> {
    match daemon_status(pid_path)? {
        DaemonStatus::NotStarted => Ok(DaemonStatus::NotStarted),
        DaemonStatus::Stale(pid) => {
            fs::remove_file(pid_path).with_context(|| format!("failed to remove stale pidfile {}", pid_path.display()))?;
            Ok(DaemonStatus::Stale(pid))
        }
        DaemonStatus::Running(pid) => {
            terminate_process(pid)?;
            fs::remove_file(pid_path).with_context(|| format!("failed to remove pidfile {}", pid_path.display()))?;
            Ok(DaemonStatus::Running(pid))
        }
    }
}

pub fn build_start_command_args(config: &ClientConfig, config_path: &Path, poll_interval_ms: u64) -> Result<Vec<OsString>> {
    Ok(vec![
        "--server-url".into(),
        config.server_url.clone().into(),
        "--device-name".into(),
        config.device_name.clone().into(),
        "--poll-interval-ms".into(),
        poll_interval_ms.to_string().into(),
        "--config-path".into(),
        config_path.as_os_str().to_os_string(),
        "run-foreground".into(),
    ])
}

pub fn start_daemon_background(
    config: &ClientConfig,
    config_path: &Path,
    pid_path: &Path,
    log_path: &Path,
    poll_interval_ms: u64,
) -> Result<u32> {
    ensure_daemon_stopped(pid_path)?;
    if let Some(parent) = pid_path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("failed to create state directory {}", parent.display()))?;
    }
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("failed to create log directory {}", parent.display()))?;
    }

    let executable = std::env::current_exe().context("failed to locate current brainx executable")?;
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .with_context(|| format!("failed to open log file {}", log_path.display()))?;
    let log_file_for_stderr = log_file
        .try_clone()
        .with_context(|| format!("failed to clone log file {}", log_path.display()))?;
    let mut command = Command::new(executable);
    command
        .args(build_start_command_args(config, config_path, poll_interval_ms)?)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_for_stderr));
    #[cfg(unix)]
    command.process_group(0);
    let child = command.spawn().context("failed to start client daemon")?;

    let pid = child.id();
    fs::write(pid_path, pid.to_string()).with_context(|| format!("failed to write pidfile {}", pid_path.display()))?;
    Ok(pid)
}

fn read_pid(pid_path: &Path) -> Result<Option<u32>> {
    if !pid_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(pid_path).with_context(|| format!("failed to read pidfile {}", pid_path.display()))?;
    let pid = raw
        .trim()
        .parse::<u32>()
        .with_context(|| format!("failed to parse pidfile {}", pid_path.display()))?;
    Ok(Some(pid))
}

#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    let proc_path = PathBuf::from("/proc").join(pid.to_string());
    if proc_path.exists() {
        return true;
    }
    if Path::new("/proc").exists() {
        return false;
    }
    Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn process_exists(_pid: u32) -> bool {
    false
}

#[cfg(unix)]
fn terminate_process(pid: u32) -> Result<()> {
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status()
        .context("failed to send stop signal to client daemon")?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("failed to stop client daemon pid {pid}"))
    }
}

#[cfg(not(unix))]
fn terminate_process(pid: u32) -> Result<()> {
    Err(anyhow!("brainx stop is not implemented for this platform yet; pid {pid} is still running"))
}
