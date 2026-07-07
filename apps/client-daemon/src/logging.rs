use serde_json::{json, Value};

pub fn format_log_event(level: &str, event: &str, fields: Value) -> String {
    json!({
        "schema": "brainx.client.log.v1",
        "level": level,
        "event": event,
        "fields": fields
    })
    .to_string()
}

pub fn log_event(level: &str, event: &str, fields: Value) {
    eprintln!("{}", format_log_event(level, event, fields));
}
