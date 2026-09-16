use std::io::Write;
use std::path::Path;

fn redact(input: &str, secret: &str) -> String {
    let mut value = if secret.trim().is_empty() {
        input.to_string()
    } else {
        input.replace(secret, "[REDACTED]")
    };
    if let Ok(re) = regex::Regex::new(r"(?i)UOJSESSID=[^;\s]+") {
        value = re.replace_all(&value, "UOJSESSID=[REDACTED]").into_owned();
    }
    value
}

pub(crate) fn log_event(log_dir: &Path, platform: &str, message: &str, secret: &str) {
    let path = log_dir.join("oj-insight.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let safe = redact(message, secret);
        let _ = writeln!(
            file,
            "{} [{}] {}",
            chrono::Utc::now().to_rfc3339(),
            platform,
            safe
        );
    }
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn redact_masks_explicit_secret_and_qoj_cookie() {
        let message = "token=private UOJSESSID=session-value; Path=/";
        let safe = redact(message, "private");

        assert!(!safe.contains("private"));
        assert!(!safe.contains("session-value"));
        assert!(safe.contains("token=[REDACTED]"));
        assert!(safe.contains("UOJSESSID=[REDACTED]"));
    }
}
