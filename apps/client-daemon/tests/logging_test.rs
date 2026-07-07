use brainx_client_daemon::logging::format_log_event;
use serde_json::{json, Value};

#[test]
fn format_log_event_includes_stable_diagnostic_fields() {
    let line = format_log_event(
        "info",
        "execution.completed",
        json!({
            "runId": "run_1",
            "executionId": "exec_1",
            "toolName": "read_files",
            "durationMs": 12
        }),
    );

    let parsed: Value = serde_json::from_str(&line).expect("log line should be json");

    assert_eq!(parsed["schema"], "brainx.client.log.v1");
    assert_eq!(parsed["level"], "info");
    assert_eq!(parsed["event"], "execution.completed");
    assert_eq!(parsed["fields"]["runId"], "run_1");
    assert_eq!(parsed["fields"]["executionId"], "exec_1");
    assert_eq!(parsed["fields"]["toolName"], "read_files");
}
