use std::future::Future;

/// Refill each completed slot immediately so a slow board does not block the
/// next batch. JoinSet aborts outstanding downloads if the caller is cancelled.
pub async fn collect<I, F, Fut, T>(
    items: impl IntoIterator<Item = I>,
    limit: usize,
    mut fetch: F,
) -> Vec<T>
where
    F: FnMut(I) -> Fut,
    Fut: Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    assert!(limit > 0);
    let mut items = items.into_iter();
    let mut tasks = tokio::task::JoinSet::new();
    for item in items.by_ref().take(limit) {
        tasks.spawn(fetch(item));
    }
    let mut results = Vec::new();
    while let Some(result) = tasks.join_next().await {
        if let Some(item) = items.next() {
            tasks.spawn(fetch(item));
        }
        if let Ok(value) = result {
            results.push(value);
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;

    #[test]
    fn refills_slots_while_a_slow_request_is_pending_and_keeps_the_limit() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let third_started = Arc::new(AtomicBool::new(false));
            let active = Arc::new(AtomicUsize::new(0));
            let peak = Arc::new(AtomicUsize::new(0));
            let mut results = collect(0..9, 2, |index| {
                let third = third_started.clone();
                let active = active.clone();
                let peak = peak.clone();
                async move {
                    let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(count, Ordering::SeqCst);
                    if index == 0 {
                        tokio::time::timeout(Duration::from_secs(2), async {
                            while !third.load(Ordering::SeqCst) {
                                tokio::time::sleep(Duration::from_millis(1)).await;
                            }
                        })
                        .await
                        .expect(
                            "a free slot must start the third job before the first job finishes",
                        );
                    } else if index == 2 {
                        third.store(true, Ordering::SeqCst);
                    }
                    active.fetch_sub(1, Ordering::SeqCst);
                    // An upstream failure also frees a slot for the remaining work.
                    if index == 1 {
                        Err(index)
                    } else {
                        Ok(index)
                    }
                }
            })
            .await;
            assert_eq!(peak.load(Ordering::SeqCst), 2);
            assert_eq!(active.load(Ordering::SeqCst), 0);
            assert_eq!(results.len(), 9);
            results.sort_by_key(|value| *value.as_ref().unwrap_or_else(|error| error));
            assert_eq!(results[1], Err(1));
        });
    }
}
