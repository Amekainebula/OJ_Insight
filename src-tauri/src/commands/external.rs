use reqwest::Url;
use tauri_plugin_opener::OpenerExt;

fn is_allowed_url(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    let path = url.path();
    url.scheme() == "https"
        && match host {
            "github.com" => {
                path.starts_with("/Whalica/OJ_Insight")
                    || path.starts_with("/Hei-MaoM/xcpcrating")
            }
            "codeforces.com" | "www.codeforces.com" => {
                path.starts_with("/contest/")
                    || path.starts_with("/gym/")
                    || path.starts_with("/problemset/problem/")
            }
            "atcoder.jp" | "www.atcoder.jp" => path.starts_with("/contests/"),
            "leetcode.com" | "www.leetcode.com" => path.starts_with("/contest/"),
            "qoj.ac" | "www.qoj.ac" => {
                path.starts_with("/problem/") || path.starts_with("/contest/")
            }
            "cftracker.netlify.app"
            | "kenkoooo.com"
            | "www.nowcoder.com"
            | "ac.nowcoder.com" => true,
            _ => false,
        }
}

#[tauri::command]
pub(crate) fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "链接格式无效".to_string())?;
    if !is_allowed_url(&parsed) {
        return Err("不允许打开该链接".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_url;
    use reqwest::Url;

    #[test]
    fn external_url_policy_accepts_expected_links() {
        let allowed = [
            "https://github.com/Whalica/OJ_Insight/releases",
            "https://github.com/Hei-MaoM/xcpcrating",
            "https://codeforces.com/contest/1",
            "https://qoj.ac/problem/1",
        ];
        for value in allowed {
            assert!(is_allowed_url(&Url::parse(value).unwrap()), "{value}");
        }
    }

    #[test]
    fn external_url_policy_rejects_untrusted_or_insecure_links() {
        let rejected = [
            "http://github.com/Whalica/OJ_Insight",
            "https://github.com/another/repository",
            "https://codeforces.com/profile/tourist",
            "https://example.com/Whalica/OJ_Insight",
        ];
        for value in rejected {
            assert!(!is_allowed_url(&Url::parse(value).unwrap()), "{value}");
        }
    }
}
