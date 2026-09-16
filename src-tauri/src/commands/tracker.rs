pub(crate) const TRACKER_INIT_SCRIPT: &str = r#"
(() => {
  if (window.location.origin === 'https://cftracker.netlify.app') {
    const handle = new URLSearchParams(window.location.search).get('oji_handle');
    if (handle) {
      try {
        const state = JSON.parse(window.localStorage.getItem('statev2') || '{}');
        const oldList = state.userList && typeof state.userList === 'object' ? state.userList : {};
        state.userList = { ...oldList, handles: [handle], error: '', id: oldList.id || 0 };
        window.localStorage.setItem('statev2', JSON.stringify(state));
      } catch (_) {}
    }
  }
  const trackerHosts = new Set(['cftracker.netlify.app', 'kenkoooo.com', 'www.nowcoder.com', 'ac.nowcoder.com']);
  if (trackerHosts.has(window.location.hostname)) {
    const openOutside = (url) => {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
      window.top.postMessage({ type: 'oj-insight:open-external', url }, '*');
      return true;
    };
    window.open = (url) => {
      if (openOutside(typeof url === 'string' ? url : '')) return null;
      return null;
    };
    window.addEventListener('click', (event) => {
      const target = event.target;
      const anchor = target && target.closest ? target.closest('a[href]') : null;
      if (!anchor || !anchor.href) return;
      if (!openOutside(anchor.href)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
})();
"#;

fn cookie_pairs(secret: &str) -> Vec<(String, String)> {
    let raw = secret
        .trim()
        .trim_matches(|character| character == '"' || character == '\'');
    let header = raw
        .split_once(':')
        .filter(|(prefix, _)| prefix.trim().eq_ignore_ascii_case("cookie"))
        .map(|(_, value)| value.trim())
        .unwrap_or(raw);
    let ignored = [
        "path",
        "domain",
        "expires",
        "max-age",
        "secure",
        "httponly",
        "samesite",
    ];

    header
        .split(';')
        .filter_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            let name = name.trim();
            let valid_name = !name.is_empty()
                && name.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric()
                        || matches!(
                            byte,
                            b'!' | b'#'
                                | b'$'
                                | b'%'
                                | b'&'
                                | b'\''
                                | b'*'
                                | b'+'
                                | b'-'
                                | b'.'
                                | b'^'
                                | b'_'
                                | b'`'
                                | b'|'
                                | b'~'
                        )
                });
            if !valid_name || ignored.iter().any(|item| name.eq_ignore_ascii_case(item)) {
                return None;
            }
            Some((name.to_string(), value.trim().to_string()))
        })
        .collect()
}

#[tauri::command]
pub(crate) fn prepare_tracker_session(
    webview: tauri::WebviewWindow,
    tracker: String,
    secret: String,
) -> Result<(), String> {
    if tracker != "nowcoder" || secret.trim().is_empty() {
        return Ok(());
    }

    let mut written = 0usize;
    let mut last_error = None;
    for (name, value) in cookie_pairs(&secret) {
        let cookie = tauri::webview::Cookie::build((name, value))
            .domain("nowcoder.com")
            .path("/")
            .secure(true)
            .same_site(tauri::webview::cookie::SameSite::None)
            .build();
        match webview.set_cookie(cookie) {
            Ok(()) => written += 1,
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    if written == 0 {
        return Err(last_error
            .map(|error| format!("写入牛客登录状态失败：{error}"))
            .unwrap_or_else(|| "Cookie 内容中没有可用字段".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::cookie_pairs;

    #[test]
    fn cookie_pairs_accepts_header_and_ignores_attributes() {
        let pairs = cookie_pairs("Cookie: token=abc; session=xyz; Path=/; Secure=true");
        assert_eq!(
            pairs,
            vec![
                ("token".to_string(), "abc".to_string()),
                ("session".to_string(), "xyz".to_string())
            ]
        );
    }

    #[test]
    fn cookie_pairs_rejects_invalid_names() {
        let pairs = cookie_pairs("valid=1; invalid name=2; Domain=nowcoder.com");
        assert_eq!(pairs, vec![("valid".to_string(), "1".to_string())]);
    }
}
