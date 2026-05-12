use std::collections::HashMap;

use serde_json::{Map, Value};
use sqlx::PgPool;

use crate::common::sc_ids::normalize_sc_track_id;
use crate::error::AppResult;

const STALE_SECS: i64 = 300;

#[derive(Debug, Clone, Copy, Default)]
pub struct Counters {
    pub play_count: Option<i64>,
    pub likes_count: Option<i64>,
    pub reposts_count: Option<i64>,
    pub comment_count: Option<i64>,
    /// Возраст записи в секундах (для определения staleness).
    pub age_secs: i64,
}

fn read_i64_from(obj: &Map<String, Value>, key: &str) -> Option<i64> {
    let n = obj.get(key)?;
    if n.is_null() {
        return None;
    }
    n.as_i64().or_else(|| n.as_u64().map(|u| u as i64))
}

fn read_fresh_counters(
    obj: &Map<String, Value>,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    let play = read_i64_from(obj, "playback_count").or_else(|| read_i64_from(obj, "play_count"));
    let likes =
        read_i64_from(obj, "likes_count").or_else(|| read_i64_from(obj, "favoritings_count"));
    let reposts = read_i64_from(obj, "reposts_count");
    let comments = read_i64_from(obj, "comment_count");
    (play, likes, reposts, comments)
}

/// Извлекает счётчики из треков и запускает UPSERT в фоне (fire-and-forget).
/// Не блокирует основной поток — ошибки логируются, не возвращаются.
pub fn spawn_upsert(pg: &PgPool, tracks: &[Value]) {
    // Собираем данные до spawn (синхронно, без DB)
    let mut ids: Vec<String> = Vec::new();
    let mut play: Vec<Option<i64>> = Vec::new();
    let mut likes: Vec<Option<i64>> = Vec::new();
    let mut reposts: Vec<Option<i64>> = Vec::new();
    let mut comments: Vec<Option<i64>> = Vec::new();

    for t in tracks.iter() {
        let Some(urn) = t.get("urn").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(sc_id) = normalize_sc_track_id(urn) else {
            continue;
        };
        let Some(obj) = t.as_object() else { continue };
        let (p, l, r, c) = read_fresh_counters(obj);
        if p.is_none() && l.is_none() && r.is_none() && c.is_none() {
            continue; // нет свежих данных — не пишем
        }
        ids.push(sc_id);
        play.push(p);
        likes.push(l);
        reposts.push(r);
        comments.push(c);
    }

    if ids.is_empty() {
        return;
    }

    let pg = pg.clone();
    tokio::spawn(async move {
        if let Err(e) = do_upsert(&pg, ids, play, likes, reposts, comments).await {
            tracing::warn!(error = %e, "counters background upsert failed");
        }
    });
}

async fn do_upsert(
    pg: &PgPool,
    ids: Vec<String>,
    play: Vec<Option<i64>>,
    likes: Vec<Option<i64>>,
    reposts: Vec<Option<i64>>,
    comments: Vec<Option<i64>>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO sc_track_counters (sc_track_id, play_count, likes_count, reposts_count, comment_count, fetched_at)
         SELECT u.id, u.p, u.l, u.r, u.c, now()
         FROM UNNEST($1::text[], $2::bigint[], $3::bigint[], $4::bigint[], $5::bigint[]) AS u(id, p, l, r, c)
         ORDER BY u.id
         ON CONFLICT (sc_track_id) DO UPDATE SET
            play_count    = COALESCE(EXCLUDED.play_count, sc_track_counters.play_count),
            likes_count   = COALESCE(EXCLUDED.likes_count, sc_track_counters.likes_count),
            reposts_count = COALESCE(EXCLUDED.reposts_count, sc_track_counters.reposts_count),
            comment_count = COALESCE(EXCLUDED.comment_count, sc_track_counters.comment_count),
            fetched_at    = now()",
    )
    .bind(&ids)
    .bind(&play)
    .bind(&likes)
    .bind(&reposts)
    .bind(&comments)
    .execute(pg)
    .await?;
    Ok(())
}

/// Загружает сохранённые счётчики из DB для списка sc_track_id.
/// Возвращает HashMap<sc_track_id, Counters>.
pub async fn select_stored(pg: &PgPool, sc_ids: &[String]) -> AppResult<HashMap<String, Counters>> {
    if sc_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(
        String,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        chrono::DateTime<chrono::Utc>,
    )> = sqlx::query_as(
        "SELECT sc_track_id, play_count, likes_count, reposts_count, comment_count, fetched_at
             FROM sc_track_counters WHERE sc_track_id = ANY($1)",
    )
    .bind(sc_ids)
    .fetch_all(pg)
    .await?;

    let now = chrono::Utc::now();
    let map = rows
        .into_iter()
        .map(|(id, p, l, r, c, fetched)| {
            let age_secs = (now - fetched).num_seconds();
            (
                id,
                Counters {
                    play_count: p,
                    likes_count: l,
                    reposts_count: r,
                    comment_count: c,
                    age_secs,
                },
            )
        })
        .collect();
    Ok(map)
}

/// Применяет сохранённые счётчики к одному треку.
/// Логика: если в треке уже есть свежие данные из SC API — не трогаем.
/// Заполняем только отсутствующие или устаревшие.
pub fn apply_to_track(track: &mut Value, sc_id: &str, stored: &HashMap<String, Counters>) {
    let Some(c) = stored.get(sc_id) else { return };
    let Some(obj) = track.as_object_mut() else {
        return;
    };

    let stale = c.age_secs > STALE_SECS;
    let (cur_play, cur_likes, cur_reposts, cur_comments) = read_fresh_counters(obj);

    if let Some(v) = c.play_count {
        if cur_play.is_none() || (!stale && cur_play != Some(v)) {
            obj.insert("playback_count".into(), Value::from(v));
        }
    }
    if let Some(v) = c.likes_count {
        if cur_likes.is_none() || (!stale && cur_likes != Some(v)) {
            obj.insert("likes_count".into(), Value::from(v));
            obj.insert("favoritings_count".into(), Value::from(v));
        }
    }
    if let Some(v) = c.reposts_count {
        if cur_reposts.is_none() || (!stale && cur_reposts != Some(v)) {
            obj.insert("reposts_count".into(), Value::from(v));
        }
    }
    if let Some(v) = c.comment_count {
        if cur_comments.is_none() || (!stale && cur_comments != Some(v)) {
            obj.insert("comment_count".into(), Value::from(v));
        }
    }
}

/// Совместимая версия для случаев, где нужен полный sync (UPSERT + SELECT + apply).
/// Используется там, где нельзя сделать параллельное исполнение.
pub async fn sync(pg: &PgPool, tracks: &mut [Value]) -> AppResult<()> {
    if tracks.is_empty() {
        return Ok(());
    }
    let sc_ids: Vec<String> = tracks
        .iter()
        .filter_map(|t| {
            t.get("urn")
                .and_then(|v| v.as_str())
                .and_then(normalize_sc_track_id)
        })
        .collect();
    if sc_ids.is_empty() {
        return Ok(());
    }
    // UPSERT в фоне
    spawn_upsert(pg, tracks);
    // SELECT и применение
    let stored = select_stored(pg, &sc_ids).await?;
    for t in tracks.iter_mut() {
        let Some(urn) = t.get("urn").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(sc_id) = normalize_sc_track_id(urn) else {
            continue;
        };
        apply_to_track(t, &sc_id, &stored);
    }
    Ok(())
}
