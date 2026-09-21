//! Cache only the two public AtCoder reference datasets. Account submissions,
//! cookies and rating history continue to be fetched through the normal path.
use std::path::Path;

use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{browser_headers, now_epoch};
use crate::models::SyncError;

const FRESH_SECONDS: i64 = 6 * 3600;
const STALE_SECONDS: i64 = 7 * 24 * 3600;

#[derive(Clone, Copy)]
pub enum Resource {
    Problems,
    Models,
}

impl Resource {
    fn filename(self) -> &'static str {
        match self {
            Self::Problems => "atcoder-problems.json",
            Self::Models => "atcoder-models.json",
        }
    }

    fn url(self) -> &'static str {
        match self {
            Self::Problems => "https://kenkoooo.com/atcoder/resources/problems.json",
            Self::Models => "https://kenkoooo.com/atcoder/resources/problem-models.json",
        }
    }

    fn valid(self, value: &Value) -> bool {
        match self {
            Self::Problems => value.as_array().is_some_and(|rows| {
                !rows.is_empty()
                    && rows.iter().all(|row| {
                        ["id", "title", "contest_id"]
                            .iter()
                            .all(|key| row.get(key).is_some_and(Value::is_string))
                    })
            }),
            Self::Models => value.as_object().is_some_and(|rows| {
                !rows.is_empty()
                    && rows.values().all(Value::is_object)
                    && rows
                        .values()
                        .any(|row| row.get("difficulty").is_some_and(Value::is_number))
            }),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Entry {
    version: u8,
    url: String,
    fetched_at: i64,
    etag: Option<String>,
    last_modified: Option<String>,
    value: Value,
}

pub struct CachedJson {
    pub value: Value,
    pub stale: bool,
}

pub async fn get(
    client: &Client,
    directory: &Path,
    resource: Resource,
    force: bool,
) -> Result<CachedJson, SyncError> {
    fetch(client, directory, resource, resource.url(), force).await
}

async fn fetch(
    client: &Client,
    directory: &Path,
    resource: Resource,
    url: &str,
    force: bool,
) -> Result<CachedJson, SyncError> {
    let path = directory.join(resource.filename());
    let now = now_epoch();
    let cached = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Entry>(&bytes).ok())
        .filter(|entry| {
            entry.version == 1
                && entry.url == url
                && entry.fetched_at > 0
                && entry.fetched_at <= now
                && resource.valid(&entry.value)
        });
    if !force
        && cached
            .as_ref()
            .is_some_and(|entry| now - entry.fetched_at < FRESH_SECONDS)
    {
        return Ok(CachedJson {
            value: cached.unwrap().value,
            stale: false,
        });
    }

    let mut request = client.get(url).headers(browser_headers());
    if let Some(entry) = &cached {
        if let Some(etag) = &entry.etag {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
        if let Some(date) = &entry.last_modified {
            request = request.header(header::IF_MODIFIED_SINCE, date);
        }
    }
    let result = async {
        let response = request
            .send()
            .await
            .map_err(|error| SyncError::error(format!("公共题库请求失败：{error}")))?;
        if response.status() == StatusCode::NOT_MODIFIED && cached.is_some() {
            return Ok(None);
        }
        let response = response
            .error_for_status()
            .map_err(|error| SyncError::error(format!("公共题库请求失败：{error}")))?;
        let etag = response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let last_modified = response
            .headers()
            .get(header::LAST_MODIFIED)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let value: Value = response
            .json()
            .await
            .map_err(|error| SyncError::error(format!("公共题库 JSON 无效：{error}")))?;
        if !resource.valid(&value) {
            return Err(SyncError::error("公共题库格式异常，保留旧缓存"));
        }
        Ok(Some(Entry {
            version: 1,
            url: url.into(),
            fetched_at: now_epoch(),
            etag,
            last_modified,
            value,
        }))
    }
    .await;

    match result {
        Ok(downloaded) => {
            let mut entry = downloaded
                .or(cached)
                .expect("304 requires a validated cache entry");
            entry.fetched_at = now_epoch();
            // Cache writes are best effort; a read-only/full disk must not fail a sync.
            // The app's operation gate serializes syncs, including multiple accounts.
            if std::fs::create_dir_all(directory).is_ok() {
                let temporary = path.with_extension("json.tmp");
                if let Ok(bytes) = serde_json::to_vec(&entry) {
                    if std::fs::write(&temporary, bytes).is_ok() {
                        let _ = std::fs::rename(&temporary, &path);
                    }
                }
                let _ = std::fs::remove_file(&temporary);
            }
            Ok(CachedJson {
                value: entry.value,
                stale: false,
            })
        }
        Err(error) => match cached {
            Some(entry) if now - entry.fetched_at <= STALE_SECONDS => Ok(CachedJson {
                value: entry.value,
                stale: true,
            }),
            _ => Err(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        path::PathBuf,
        thread,
        time::{Duration, Instant},
    };

    const PROBLEMS: &str = r#"[{"id":"abc001_1","title":"A","contest_id":"abc001"}]"#;
    const MODELS: &str = r#"{"abc001_1":{"difficulty":100}}"#;

    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "oji-public-cache-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn age(&self, resource: Resource, seconds: i64) {
            let path = self.0.join(resource.filename());
            let mut entry: Entry = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            entry.fetched_at = now_epoch() - seconds;
            std::fs::write(path, serde_json::to_vec(&entry).unwrap()).unwrap();
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn response(status: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nETag: \"v1\"\r\nLast-Modified: Mon, 14 Sep 2026 00:00:00 GMT\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    fn server(responses: Vec<String>) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/reference.json", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(1))
                        }
                        Err(error) => panic!("missing test request: {error}"),
                    }
                };
                // Accepted sockets inherit nonblocking mode on Windows.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    stream.read_exact(&mut byte).unwrap();
                    bytes.push(byte[0]);
                }
                requests.push(String::from_utf8(bytes).unwrap().to_lowercase());
                stream.write_all(response.as_bytes()).unwrap();
            }
            requests
        });
        (url, handle)
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    fn client() -> Client {
        Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap()
    }

    #[test]
    fn fresh_cache_survives_a_new_client_without_any_network_request() {
        let dir = Directory::new();
        let (url, server) = server(vec![response("200 OK", PROBLEMS)]);
        let first = runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Problems, &url, false))
            .unwrap();
        assert!(!first.stale);
        assert_eq!(server.join().unwrap().len(), 1); // The server is now offline.
        let second = runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Problems, &url, false))
            .unwrap();
        assert!(!second.stale);
        assert_eq!(first.value, second.value);
    }

    #[test]
    fn expired_cache_revalidates_with_etag_and_last_modified() {
        let dir = Directory::new();
        let (url, server) = server(vec![
            response("200 OK", MODELS),
            response("304 Not Modified", ""),
        ]);
        let first = runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Models, &url, false))
            .unwrap();
        dir.age(Resource::Models, FRESH_SECONDS + 1);
        let second = runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Models, &url, false))
            .unwrap();
        assert_eq!(first.value, second.value);
        assert!(!second.stale);
        let requests = server.join().unwrap();
        assert!(requests[1].contains("if-none-match: \"v1\""));
        assert!(requests[1].contains("if-modified-since:"));
        let third = runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Models, &url, false))
            .unwrap();
        assert!(!third.stale); // 304 renewed the six-hour lifetime.
    }

    #[test]
    fn force_refresh_bypasses_fresh_cache_and_replaces_the_file() {
        let dir = Directory::new();
        let changed = PROBLEMS.replace("\"A\"", "\"Updated A\"");
        let (url, server) = server(vec![
            response("200 OK", PROBLEMS),
            response("200 OK", &changed),
        ]);
        runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Problems, &url, false))
            .unwrap();
        let result = runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Problems, &url, true))
            .unwrap();
        assert_eq!(result.value[0]["title"], "Updated A");
        assert_eq!(server.join().unwrap().len(), 2);
        let from_disk = runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Problems, &url, false))
            .unwrap();
        assert_eq!(from_disk.value, result.value);
    }

    #[test]
    fn network_and_invalid_payloads_preserve_valid_cache_without_extending_its_age() {
        let dir = Directory::new();
        let (url, server) = server(vec![
            response("200 OK", PROBLEMS),
            response("503 Unavailable", "{}"),
            response("200 OK", r#"{"error":"upstream failure"}"#),
            response("200 OK", "<html>login</html>"),
        ]);
        runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Problems, &url, false))
            .unwrap();
        dir.age(Resource::Problems, FRESH_SECONDS + 1);
        let original = std::fs::read(dir.0.join(Resource::Problems.filename())).unwrap();
        for _ in 0..3 {
            let result = runtime()
                .block_on(fetch(&client(), &dir.0, Resource::Problems, &url, false))
                .unwrap();
            assert!(result.stale);
            assert_eq!(result.value[0]["title"], "A");
            assert_eq!(
                std::fs::read(dir.0.join(Resource::Problems.filename())).unwrap(),
                original
            );
        }
        server.join().unwrap();
        dir.age(Resource::Problems, STALE_SECONDS + 1);
        assert!(runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Problems, &url, false))
            .is_err());
    }

    #[test]
    fn corrupt_cache_is_rebuilt_and_disk_failure_does_not_fail_the_download() {
        let dir = Directory::new();
        let path = dir.0.join(Resource::Models.filename());
        std::fs::write(&path, "{truncated").unwrap();
        let (url, server) = server(vec![response("200 OK", MODELS), response("200 OK", MODELS)]);
        let result = runtime()
            .block_on(fetch(&client(), &dir.0, Resource::Models, &url, false))
            .unwrap();
        assert_eq!(result.value["abc001_1"]["difficulty"], 100);
        // A regular file cannot be used as the cache directory.
        let result = runtime()
            .block_on(fetch(&client(), &path, Resource::Models, &url, false))
            .unwrap();
        assert_eq!(result.value["abc001_1"]["difficulty"], 100);
        server.join().unwrap();
    }

    #[test]
    #[ignore = "downloads the public AtCoder reference datasets"]
    fn live_public_metadata_cache_reuses_downloads() {
        let dir = Directory::new();
        let client = Client::builder()
            .timeout(Duration::from_secs(35))
            .build()
            .unwrap();
        let offline = Client::builder()
            .proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap())
            .timeout(Duration::from_secs(1))
            .build()
            .unwrap();
        for resource in [Resource::Problems, Resource::Models] {
            let start = Instant::now();
            let first = runtime()
                .block_on(get(&client, &dir.0, resource, false))
                .unwrap();
            let cold = start.elapsed();
            let start = Instant::now();
            let warm = runtime()
                .block_on(get(&offline, &dir.0, resource, false))
                .unwrap();
            assert!(!warm.stale);
            assert_eq!(first.value, warm.value);
            println!(
                "{}: download {:?}, offline cache {:?}",
                resource.filename(),
                cold,
                start.elapsed()
            );
        }
    }
}
