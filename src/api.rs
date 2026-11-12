//! HTTP API used by the browser UI.

use crate::levels::{Book, Kind, Level, World};
use crate::progress::{Completion, Progress, RANKS, Settings, today};
use crate::runner;
use crate::teacher::{self, Mode};
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::ReceiverStream;

pub const REVIEW_BONUS_XP: u32 = 15;
const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

pub struct AppState {
    /// Where progress and scratch files live (`save/`, or `FERRIS_SAVE_DIR`).
    pub save_dir: PathBuf,
    pub worlds: Vec<World>,
    pub book: Book,
    pub progress: Mutex<Progress>,
    pub usage: Arc<Mutex<Option<Value>>>,
    /// Set when the last save failed (shown in the game), cleared when a save works again.
    pub save_error: Mutex<Option<String>>,
    /// A one-time message from startup, e.g. that a damaged save was backed up.
    pub notice: Mutex<Option<String>>,
    /// The compiler's version ("1.99.0"), shown on the sign on the title screen.
    pub rustc: Option<String>,
}

type Shared = Arc<AppState>;

impl AppState {
    fn save_path(&self) -> PathBuf {
        self.save_dir.join("progress.json")
    }
    fn work_dir(&self) -> PathBuf {
        self.save_dir.join("tmp")
    }
    fn ferris_dir(&self) -> PathBuf {
        self.save_dir.join("ferris")
    }
    fn save(&self, progress: &Progress) {
        let result = progress.save(&self.save_path());
        if let Err(e) = &result {
            eprintln!("⚠ Saving failed: {e}");
        }
        *self.save_error.lock().unwrap() = result.err();
    }
    fn level(&self, id: &str) -> Result<(&World, usize, &Level), ApiError> {
        World::find(&self.worlds, id)
            .ok_or(ApiError(StatusCode::NOT_FOUND, format!("no level {id}")))
    }

    /// Find a level the player is allowed to play right now.
    fn playable(&self, id: &str) -> Result<(&World, usize, &Level), ApiError> {
        let (world, li, level) = self.level(id)?;
        let wi = self
            .worlds
            .iter()
            .position(|w| w.id == world.id)
            .unwrap_or(0);
        let p = self.progress.lock().unwrap();
        if !self.level_unlocked(&p, wi, li) && !p.is_done(id) {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "That level is still locked.".into(),
            ));
        }
        Ok((world, li, level))
    }

    fn world_unlocked(&self, p: &Progress, idx: usize) -> bool {
        idx == 0
            || self.worlds[idx - 1]
                .levels
                .last()
                .is_some_and(|l| p.has_reached(&l.id))
    }

    fn level_unlocked(&self, p: &Progress, world_idx: usize, level_idx: usize) -> bool {
        self.world_unlocked(p, world_idx)
            && (level_idx == 0 || p.has_reached(&self.worlds[world_idx].levels[level_idx - 1].id))
    }

    /// The player-visible state of a level: "done" (cleared), "skipped", "open" (playable
    /// now) or "locked". Skipping and replaying never re-lock a level, because unlocking
    /// looks at `reached`, not at the current completion state.
    fn level_status(&self, p: &Progress, world_idx: usize, level_idx: usize) -> &'static str {
        let id = &self.worlds[world_idx].levels[level_idx].id;
        if p.completed.contains_key(id) {
            "done"
        } else if p.skipped.contains(id) {
            "skipped"
        } else if self.level_unlocked(p, world_idx, level_idx) {
            "open"
        } else {
            "locked"
        }
    }

    /// The first unfinished level that is open to play.
    fn next_level(&self, p: &Progress) -> Option<String> {
        for (wi, w) in self.worlds.iter().enumerate() {
            for (li, l) in w.levels.iter().enumerate() {
                if !p.is_done(&l.id) && self.level_unlocked(p, wi, li) {
                    return Some(l.id.clone());
                }
            }
        }
        None
    }

    fn level_after(&self, id: &str) -> Option<String> {
        let all: Vec<&Level> = self.worlds.iter().flat_map(|w| &w.levels).collect();
        let i = all.iter().position(|l| l.id == id)?;
        all.get(i + 1).map(|l| l.id.clone())
    }

    /// Bonus XP for idiomatic code, once per finished level.
    fn award_review_bonus(&self, level_id: &str) -> bool {
        let mut p = self.progress.lock().unwrap();
        if !p.completed.contains_key(level_id) || !p.review_bonus.insert(level_id.to_string()) {
            return false;
        }
        p.xp += REVIEW_BONUS_XP;
        if let Some(c) = p.completed.get_mut(level_id) {
            c.xp += REVIEW_BONUS_XP;
        }
        self.save(&p);
        true
    }

    /// Apply a finished compile to the save. `generation` is the replay count the level had
    /// when the compile started: if the level was replayed since (including in a previous
    /// run of the game, because the count is persisted), the result is stale — it neither
    /// clears the level, awards XP nor records error codes, and the response says so.
    fn finish_run(
        &self,
        level: &Level,
        level_idx: usize,
        result: runner::RunResult,
        generation: u64,
    ) -> Value {
        let world_idx = self
            .worlds
            .iter()
            .position(|w| w.levels.iter().any(|l| l.id == level.id))
            .unwrap_or(0);
        let mut p = self.progress.lock().unwrap();
        if p.is_stale_attempt(&level.id, generation) {
            return json!({
                "result": result, "xp_gained": 0, "first_clear": false, "world_cleared": false,
                "stale": true, "player": self.player(&p), "next_id": self.level_after(&level.id),
            });
        }
        p.days_played.insert(today());
        p.record_errors(&level.id, &result.error_codes);
        let first_clear = result.passed && !p.completed.contains_key(&level.id);
        let mut xp_gained = 0;
        if !p.completed.contains_key(&level.id) {
            *p.attempts.entry(level.id.clone()).or_default() += 1;
        }
        if first_clear {
            xp_gained = p.xp_for(&level.id, level.xp);
            p.xp += xp_gained;
            let completion = Completion {
                xp: xp_gained,
                hints_used: p.hint_tier.get(&level.id).copied().unwrap_or(0),
                attempts: p.attempts.get(&level.id).copied().unwrap_or(1),
            };
            p.completed.insert(level.id.clone(), completion);
            p.skipped.remove(&level.id);
            p.reached.insert(level.id.clone());
        }
        let world_cleared = first_clear && level_idx + 1 == self.worlds[world_idx].levels.len();
        self.save(&p);
        json!({
            "result": result, "xp_gained": xp_gained, "first_clear": first_clear,
            "world_cleared": world_cleared, "stale": false,
            "player": self.player(&p), "next_id": self.level_after(&level.id),
        })
    }

    fn player(&self, p: &Progress) -> Value {
        let (rank, next) = p.rank();
        let total: usize = self.worlds.iter().map(|w| w.levels.len()).sum();
        json!({
            "name": p.name,
            "xp": p.xp,
            "rank": rank,
            "next_rank": next.map(|(xp, name)| json!({"xp": xp, "name": name})),
            "ranks": RANKS.iter().map(|(xp, name)| json!({"xp": xp, "name": name})).collect::<Vec<_>>(),
            "streak": p.streak(),
            "days": p.days_played.len(),
            "completed": p.completed.len(),
            "total_levels": total,
            "save_error": *self.save_error.lock().unwrap(),
        })
    }
}

#[derive(Debug)]
pub struct ApiError(StatusCode, String);

/// The longest code the game accepts to save or run (far more than any level needs).
const MAX_CODE_BYTES: usize = 200_000;

fn check_code_size(code: &str) -> Result<(), ApiError> {
    if code.len() > MAX_CODE_BYTES {
        return Err(ApiError(
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "That's more than {} KB of code. Please keep it shorter.",
                MAX_CODE_BYTES / 1000
            ),
        ));
    }
    Ok(())
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

pub fn router(state: Shared) -> Router {
    Router::new()
        .route("/api/state", get(get_state))
        .route("/api/level/{id}", get(get_level))
        .route("/api/lesson/{id}", get(get_lesson))
        .route("/api/run", post(run_level))
        .route("/api/play", post(play))
        .route("/api/quiz", post(quiz))
        .route("/api/skip", post(skip))
        .route("/api/replay", post(replay))
        .route("/api/draft", post(save_draft))
        .route("/api/name", post(set_name))
        .route("/api/settings", post(set_settings))
        .route("/api/models", get(models))
        .route("/api/models/test", post(test_model))
        .route("/api/models/refresh", post(refresh_models))
        .route("/api/explain/{code}", get(explain))
        .route("/api/ferris", post(ferris))
        .route("/api/vim", get(crate::nvim::vim_ws))
        .with_state(state)
}

async fn get_state(State(s): State<Shared>) -> Json<Value> {
    let p = s.progress.lock().unwrap();
    let worlds: Vec<Value> = s
        .worlds
        .iter()
        .enumerate()
        .map(|(wi, w)| {
            let levels: Vec<Value> = w
                .levels
                .iter()
                .enumerate()
                .map(|(li, l)| {
                    let status = s.level_status(&p, wi, li);
                    json!({
                        "id": l.id, "num": format!("{}.{}", w.id, li + 1),
                        "title": l.title, "kind": l.kind, "xp": l.xp, "status": status,
                        "earned": p.completed.get(&l.id).map(|c| c.xp),
                        "replays": p.replay_count(&l.id),
                    })
                })
                .collect();
            let done = w.levels.iter().filter(|l| p.is_done(&l.id)).count();
            let cleared = w.levels.iter().filter(|l| p.completed.contains_key(&l.id)).count();
            let skipped = w.levels.iter().filter(|l| p.skipped.contains(&l.id)).count();
            let replayed = w
                .levels
                .iter()
                .map(|l| p.replay_count(&l.id))
                .filter(|n| *n > 0)
                .sum::<u64>();
            let planned: Vec<Value> = w
                .planned
                .iter()
                .map(|pl| json!({"title": pl.title, "kind": pl.kind, "about": pl.about, "book": s.book.labels(&pl.book)}))
                .collect();
            json!({
                "id": w.id, "name": w.name, "blurb": w.blurb, "tag": w.tag,
                "available": !w.levels.is_empty(),
                "unlocked": !w.levels.is_empty() && s.world_unlocked(&p, wi),
                "done": done, "cleared": cleared, "skipped": skipped, "replayed": replayed,
                "levels": levels, "planned": planned,
                "chapters": world_chapters(&s.book, w),
            })
        })
        .collect();
    let codex: Vec<Value> = p
        .codex
        .iter()
        .map(|(code, e)| json!({"code": code, "count": e.count, "first_level": e.first_level}))
        .collect();
    Json(json!({
        "player": s.player(&p),
        "rustc": s.rustc,
        "settings": p.settings,
        "usage": *s.usage.lock().unwrap(),
        "worlds": worlds,
        "codex": codex,
        "next_level": s.next_level(&p),
        "notice": s.notice.lock().unwrap().take(),
    }))
}

/// The book chapters a world covers, e.g. ["Ch 4: Understanding Ownership"].
fn world_chapters(book: &Book, w: &World) -> Vec<String> {
    let mut chapters: Vec<String> = Vec::new();
    let ids = w
        .levels
        .iter()
        .flat_map(|l| &l.book)
        .chain(w.planned.iter().flat_map(|p| &p.book));
    for id in ids {
        let chapter = id.split('.').next().unwrap_or(id);
        let label = match book.get(chapter) {
            Some(s) if chapter.chars().all(|c| c.is_ascii_digit()) => {
                format!("Ch {chapter}: {}", s.title)
            }
            _ => "Appendices".to_string(),
        };
        if !chapters.contains(&label) {
            chapters.push(label);
        }
    }
    chapters
}

/// Book links for a level: id, title and URL of each section it teaches.
fn book_links(book: &Book, ids: &[String]) -> Vec<Value> {
    ids.iter()
        .filter_map(|id| book.get(id))
        .map(|sec| json!({"id": sec.id, "title": sec.title, "url": book.url(sec)}))
        .collect()
}

async fn get_level(
    State(s): State<Shared>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (world, li, level) = s.playable(&id)?;
    let wi = s.worlds.iter().position(|w| w.id == world.id).unwrap_or(0);
    let p = s.progress.lock().unwrap();
    let done = p.completed.contains_key(&id);
    Ok(Json(json!({
        "id": level.id, "num": format!("{}.{}", world.id, li + 1),
        "title": level.title, "kind": level.kind, "goal": level.goal,
        "stdin": level.stdin, "args": level.args, "env": level.env, "files": level.files.keys().collect::<Vec<_>>(),
        "lesson": level.lesson, "c_compare": level.c_compare, "py_compare": level.py_compare,
        "starter": level.starter,
        "code": p.drafts.get(&id).cloned().unwrap_or_else(|| level.starter.clone()),
        "check": level.check, "expected_output": level.expected_output, "tests": level.tests,
        "choices": level.choices, "xp": level.xp,
        "hint_count": level.hints.len().max(3), "hint_tier": p.hint_tier.get(&id).copied().unwrap_or(0),
        "done": done, "skipped": p.skipped.contains(&id),
        "status": s.level_status(&p, wi, li),
        "replays": p.replay_count(&id),
        "explanation": if done { level.explanation.clone() } else { String::new() },
        "world": {"id": world.id, "name": world.name},
        "index": li + 1, "count": world.levels.len(),
        "next_id": s.level_after(&id),
        "book": book_links(&s.book, &level.book),
    })))
}

/// The reading material for any level, even a locked one: no code, tests or answers.
async fn get_lesson(
    State(s): State<Shared>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (world, li, level) = s.level(&id)?;
    Ok(Json(json!({
        "id": level.id, "num": format!("{}.{}", world.id, li + 1),
        "title": level.title, "kind": level.kind, "goal": level.goal,
        "lesson": level.lesson, "c_compare": level.c_compare, "py_compare": level.py_compare,
        "book": book_links(&s.book, &level.book),
    })))
}

#[derive(Deserialize)]
struct CodeReq {
    id: String,
    code: String,
}

async fn run_level(
    State(s): State<Shared>,
    Json(req): Json<CodeReq>,
) -> Result<Json<Value>, ApiError> {
    check_code_size(&req.code)?;
    let (_, li, level) = s.playable(&req.id)?;
    if matches!(level.kind, Kind::Predict | Kind::Quiz) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Predict and quiz levels are answered, not run.".into(),
        ));
    }
    // Save the submitted code *before* compiling. Edits the player makes while it compiles
    // are autosaved afterwards and must win, so the result below never touches the draft.
    let generation = {
        let mut p = s.progress.lock().unwrap();
        p.drafts.insert(req.id.clone(), req.code.clone());
        s.save(&p);
        p.replay_count(&req.id)
    };
    let result = runner::check_level(level, &req.code, &s.work_dir()).await;
    Ok(Json(s.finish_run(level, li, result, generation)))
}

#[derive(Deserialize)]
struct PlayReq {
    code: String,
    /// For a level's "Run it" button: give the program that level's input and files.
    #[serde(default)]
    id: Option<String>,
}

async fn play(State(s): State<Shared>, Json(req): Json<PlayReq>) -> Result<Json<Value>, ApiError> {
    check_code_size(&req.code)?;
    let setup = req
        .id
        .as_deref()
        .and_then(|id| s.level(id).ok())
        .map(|(_, _, l)| runner::Setup::from_level(l))
        .unwrap_or_default();
    Ok(Json(json!(
        runner::play(&req.code, &setup, &s.work_dir()).await
    )))
}

#[derive(Deserialize)]
struct QuizReq {
    id: String,
    choice: usize,
}

async fn quiz(State(s): State<Shared>, Json(req): Json<QuizReq>) -> Result<Json<Value>, ApiError> {
    let (world, li, level) = s.playable(&req.id)?;
    let correct = level.answer == Some(req.choice);
    let mut p = s.progress.lock().unwrap();
    p.days_played.insert(today());
    let mut xp_gained = 0;
    let first_clear = correct && !p.completed.contains_key(&req.id);
    if first_clear {
        let wrong = p.wrong_guesses.get(&req.id).copied().unwrap_or(0);
        let base = if wrong == 0 { level.xp } else { level.xp / 2 };
        xp_gained = p.xp_for(&req.id, base);
        p.xp += xp_gained;
        let completion = Completion {
            xp: xp_gained,
            hints_used: p.hint_tier.get(&req.id).copied().unwrap_or(0),
            attempts: wrong + 1,
        };
        p.completed.insert(req.id.clone(), completion);
        p.skipped.remove(&req.id);
        p.reached.insert(req.id.clone());
    } else if !correct && !p.completed.contains_key(&req.id) {
        *p.wrong_guesses.entry(req.id.clone()).or_default() += 1;
        *p.attempts.entry(req.id.clone()).or_default() += 1;
    }
    s.save(&p);
    Ok(Json(json!({
        "correct": correct,
        "explanation": if correct { level.explanation.clone() } else { String::new() },
        "xp_gained": xp_gained, "first_clear": first_clear,
        "world_cleared": first_clear && li + 1 == world.levels.len(),
        "player": s.player(&p), "next_id": s.level_after(&req.id),
    })))
}

#[derive(Deserialize)]
struct IdReq {
    id: String,
}

async fn skip(State(s): State<Shared>, Json(req): Json<IdReq>) -> Result<Json<Value>, ApiError> {
    let (world, li, level) = s.playable(&req.id)?;
    if level.kind == Kind::Boss {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Bosses can't be skipped — you've got this!".into(),
        ));
    }
    let wi = s.worlds.iter().position(|w| w.id == world.id).unwrap_or(0);
    let mut p = s.progress.lock().unwrap();
    let already_done = p.completed.contains_key(&req.id);
    if !already_done {
        p.skipped.insert(req.id.clone());
        p.reached.insert(req.id.clone());
    }
    s.save(&p);
    let status = s.level_status(&p, wi, li);
    // Skipping marks the level as reached, so the level right after it must now be open.
    let next_status = s
        .level_after(&req.id)
        .and_then(|id| World::find(&s.worlds, &id))
        .map(|(nw, nli, _)| {
            let nwi = s.worlds.iter().position(|w| w.id == nw.id).unwrap_or(0);
            s.level_status(&p, nwi, nli)
        });
    Ok(Json(json!({
        "next_id": s.level_after(&req.id),
        "status": status,
        "next_status": next_status,
        "replays": p.replay_count(&req.id),
        "player": s.player(&p),
    })))
}

/// Play a level again from scratch (its XP is taken back and can be earned again).
async fn replay(State(s): State<Shared>, Json(req): Json<IdReq>) -> Result<Json<Value>, ApiError> {
    let (world, li, _) = s.playable(&req.id)?;
    let wi = s.worlds.iter().position(|w| w.id == world.id).unwrap_or(0);
    let mut p = s.progress.lock().unwrap();
    let xp_returned = p.replay(&req.id);
    s.save(&p);
    let status = s.level_status(&p, wi, li);
    // Replaying never re-locks later levels: report the following level's state so the UI
    // can show it is still playable.
    let next_status = s
        .level_after(&req.id)
        .and_then(|id| World::find(&s.worlds, &id))
        .map(|(nw, nli, _)| {
            let nwi = s.worlds.iter().position(|w| w.id == nw.id).unwrap_or(0);
            s.level_status(&p, nwi, nli)
        });
    Ok(Json(json!({
        "xp_returned": xp_returned,
        "replays": p.replay_count(&req.id),
        "status": status,
        "next_status": next_status,
        "player": s.player(&p),
    })))
}

/// Autosave. Fails loudly (500) when the save file can't be written, so the page can say so.
async fn save_draft(
    State(s): State<Shared>,
    Json(req): Json<CodeReq>,
) -> Result<StatusCode, ApiError> {
    // Only real levels get drafts, so the save file can't grow without bound.
    s.level(&req.id)?;
    check_code_size(&req.code)?;
    let mut p = s.progress.lock().unwrap();
    p.drafts.insert(req.id, req.code);
    s.save(&p);
    match s.save_error.lock().unwrap().clone() {
        Some(e) => Err(ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Couldn't save: {e}"),
        )),
        None => Ok(StatusCode::NO_CONTENT),
    }
}

#[derive(Deserialize)]
struct NameReq {
    name: String,
}

async fn set_name(State(s): State<Shared>, Json(req): Json<NameReq>) -> StatusCode {
    let mut p = s.progress.lock().unwrap();
    p.name = req.name.trim().chars().take(24).collect();
    s.save(&p);
    StatusCode::NO_CONTENT
}

async fn set_settings(
    State(s): State<Shared>,
    Json(new): Json<Settings>,
) -> Result<Json<Settings>, ApiError> {
    if !EFFORTS.contains(&new.effort.as_str()) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "unknown effort level".into(),
        ));
    }
    if !["claude_code", "offline"].contains(&new.teacher.as_str()) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "unknown teacher mode".into(),
        ));
    }
    let model = new.model.trim();
    if model.is_empty()
        || model.len() > 80
        || !model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.[]".contains(c))
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "that doesn't look like a model name".into(),
        ));
    }
    let mut p = s.progress.lock().unwrap();
    p.settings = Settings {
        model: model.to_string(),
        ..new
    };
    s.save(&p);
    Ok(Json(p.settings.clone()))
}

/// The model cards. Each card is a Claude Code alias, which always means the newest model
/// in that family. The fallback name is only shown until Claude Code has told us which
/// model the alias really is (after a reply, a test, or "Check for new versions").
const MODEL_CARDS: &[(&str, &str, &str, &str)] = &[
    (
        "fable",
        "Claude Fable",
        "Wizard",
        "The most capable model. Deepest explanations, slowest replies, uses the most of your plan's limits.",
    ),
    (
        "opus",
        "Claude Opus",
        "Sage",
        "Excellent teacher. Thoughtful and clear — the recommended default.",
    ),
    (
        "sonnet",
        "Claude Sonnet",
        "Ranger",
        "Fast and smart. A great everyday choice that's lighter on your limits.",
    ),
    (
        "haiku",
        "Claude Haiku",
        "Sprite",
        "The quickest replies and the lightest on your limits. Best for quick hints.",
    ),
];

/// "claude-opus-5-5" -> "Claude Opus 5.5", "claude-haiku-4-5-20251001" -> "Claude Haiku 4.5".
fn model_name(id: &str) -> String {
    let (mut words, mut version) = (Vec::new(), Vec::new());
    for part in id.split(['-', '_']) {
        if part.chars().all(|c| c.is_ascii_digit()) {
            // Long numbers are release dates, not versions.
            if part.len() < 6 {
                version.push(part);
            }
        } else {
            let mut chars = part.chars();
            let first = chars.next().map(|c| c.to_ascii_uppercase());
            words.push(first.into_iter().chain(chars).collect::<String>());
        }
    }
    let name = words.join(" ");
    if version.is_empty() {
        name
    } else {
        format!("{name} {}", version.join("."))
    }
}

impl AppState {
    fn model_cards(&self) -> Value {
        let p = self.progress.lock().unwrap();
        MODEL_CARDS
            .iter()
            .map(|(alias, family, tag, blurb)| {
                let resolved = p.models.get(*alias);
                json!({
                    "id": alias, "tag": tag, "blurb": blurb,
                    "name": resolved.map(|m| model_name(m)).unwrap_or_else(|| family.to_string()),
                    "resolved": resolved,
                })
            })
            .collect()
    }

    /// Remember which model an alias turned out to be.
    fn note_model(&self, alias: &str, model: &str) {
        if !MODEL_CARDS.iter().any(|(a, ..)| *a == alias) || !model.starts_with("claude-") {
            return;
        }
        let mut p = self.progress.lock().unwrap();
        if p.models.get(alias).map(String::as_str) != Some(model) {
            p.models.insert(alias.to_string(), model.to_string());
            self.save(&p);
        }
    }
}

async fn models(State(s): State<Shared>) -> Json<Value> {
    Json(s.model_cards())
}

/// Ask every alias once (a tiny prompt each) to learn the newest model behind it.
async fn refresh_models(State(s): State<Shared>) -> Json<Value> {
    let mut checks = tokio::task::JoinSet::new();
    for (alias, ..) in MODEL_CARDS {
        let s = s.clone();
        checks.spawn(async move {
            let result = teacher::test_model(alias, "low", &s.ferris_dir(), &s.usage).await;
            (*alias, result)
        });
    }
    let mut errors = Vec::new();
    while let Some(Ok((alias, result))) = checks.join_next().await {
        match result {
            Ok((model, _)) => s.note_model(alias, &model),
            Err(e) => errors.push(json!({"id": alias, "error": e})),
        }
    }
    Json(json!({ "models": s.model_cards(), "errors": errors }))
}

#[derive(Deserialize)]
struct TestReq {
    model: String,
    effort: String,
}

async fn test_model(State(s): State<Shared>, Json(req): Json<TestReq>) -> Json<Value> {
    let effort = if EFFORTS.contains(&req.effort.as_str()) {
        req.effort.as_str()
    } else {
        "low"
    };
    match teacher::test_model(&req.model, effort, &s.ferris_dir(), &s.usage).await {
        Ok((model, reply)) => {
            s.note_model(&req.model, &model);
            Json(json!({"ok": true, "model": model, "reply": reply}))
        }
        Err(e) => Json(json!({"ok": false, "error": e})),
    }
}

async fn explain(Path(code): Path<String>) -> Json<Value> {
    Json(json!({ "code": code, "text": runner::explain(&code).await }))
}

#[derive(Deserialize)]
struct FerrisReq {
    id: String,
    mode: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    output: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    history: Vec<(String, String)>,
    #[serde(default)]
    choice: Option<usize>,
}

/// Streams Ferris' reply as newline-delimited JSON events.
async fn ferris(State(s): State<Shared>, Json(req): Json<FerrisReq>) -> Result<Response, ApiError> {
    check_code_size(&req.code)?;
    let (world, _, level) = s.playable(&req.id)?;
    let (world, level) = (world.clone(), level.clone());

    // Hints cost XP, so the server keeps track of the tier.
    let (mode, settings, profile) = {
        let mut p = s.progress.lock().unwrap();
        let tier = if req.mode == "hint" {
            let t = p.hint_tier.entry(req.id.clone()).or_default();
            *t = (*t + 1).min(3);
            *t
        } else {
            0
        };
        let mode = Mode::parse(&req.mode, tier)
            .ok_or(ApiError(StatusCode::BAD_REQUEST, "unknown mode".into()))?;
        s.save(&p);
        (mode, p.settings.clone(), p.learner_profile())
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Value>(512);
    let state = s.clone();
    tokio::spawn(async move {
        if let Mode::Hint(tier) = mode {
            let _ = tx.send(json!({"type": "hint_tier", "tier": tier})).await;
        }
        let ctx = teacher::Context {
            world: &world,
            level: &level,
            code: &req.code,
            output: &req.output,
            message: &req.message,
            history: &req.history,
            choice: req.choice,
            profile,
            book: state.book.labels(&level.book),
        };

        let reply = if settings.teacher == "offline" {
            Err(None)
        } else {
            let prompt = teacher::build_prompt(mode, &ctx);
            teacher::ask(
                prompt,
                &settings.model,
                &settings.effort,
                &state.ferris_dir(),
                &tx,
                &state.usage,
            )
            .await
            .map_err(Some)
        };

        match reply {
            Ok(teacher::Reply { text, model }) => {
                if let Some(m) = &model {
                    state.note_model(&settings.model, m);
                }
                if mode == Mode::Review
                    && verdict_is_idiomatic(&text)
                    && state.award_review_bonus(&level.id)
                {
                    let _ = tx
                        .send(json!({"type": "bonus", "xp": REVIEW_BONUS_XP}))
                        .await;
                }
            }
            Err(Some(message)) if message == teacher::CANCELLED => {}
            Err(err) => {
                if let Some(message) = err {
                    let _ = tx.send(json!({"type": "error", "message": message})).await;
                }
                let _ = tx.send(json!({"type": "offline"})).await;
                let text = offline_reply(mode, &ctx);
                let _ = tx.send(json!({"type": "delta", "text": text})).await;
            }
        }
        let _ = tx.send(json!({"type": "done"})).await;
    });

    let stream = ReceiverStream::new(rx).map(|v| Ok::<_, std::io::Error>(format!("{v}\n")));
    Ok(Response::builder()
        .header("content-type", "application/x-ndjson")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(stream))
        .unwrap())
}

/// Reads the `VERDICT: idiomatic|improvable` line at the end of a code review.
fn verdict_is_idiomatic(text: &str) -> bool {
    text.rfind("VERDICT")
        .map(|i| text[i..].to_lowercase())
        .is_some_and(|rest| rest.contains("idiomatic") && !rest.contains("improvable"))
}

/// What Ferris says without Claude: built-in hints and error notes.
fn offline_reply(mode: Mode, ctx: &teacher::Context) -> String {
    let level = ctx.level;
    match mode {
        Mode::Hint(tier) => {
            let i = tier as usize - 1;
            match level.hints.get(i) {
                Some(h) => h.clone(),
                None if !level.solution.is_empty() => {
                    format!("Here's one way to solve it:\n```rust\n{}\n```", level.solution.trim())
                }
                None => level.hints.last().cloned().unwrap_or_else(|| "Read the goal once more, slowly. 🦀".into()),
            }
        }
        Mode::Explain => explain_offline(ctx.output),
        Mode::Review => {
            if level.solution.is_empty() {
                "Nicely done! 🎉 (I'm in offline mode, so no detailed review this time.)".into()
            } else {
                format!(
                    "Nicely done! 🎉 I'm in offline mode, so compare your code with my version:\n```rust\n{}\n```",
                    level.solution.trim()
                )
            }
        }
        Mode::Chat => "I'm in **offline mode** right now, so I can't chat. Try a hint (💡) — or switch my brain back on in Settings ⚙.".into(),
        Mode::Quiz => "Not quite! Read the code once more, line by line, and ask: *who owns each value, and when does each line run?* Then try again.".into(),
    }
}

fn explain_offline(output: &str) -> String {
    const NOTES: &[(&str, &str)] = &[
        (
            "E0382",
            "**Use after move.** A value was moved to a new owner, and then the old name was used again. In C this would be a use-after-free waiting to happen; Rust stops it at compile time. Try `.clone()` or (later) borrowing with `&`.",
        ),
        (
            "E0384",
            "**Assigning twice to an immutable variable.** Rust variables can't change unless you say so: `let mut x`.",
        ),
        (
            "E0308",
            "**Mismatched types.** Rust expected one type and got another. Check what each side should be — and watch for a stray `;` at the end of a function, which turns the value into `()`.",
        ),
        (
            "E0425",
            "**Unknown name.** You used a variable or function that doesn't exist here. Check spelling and scope — a name declared inside `{ }` disappears at the `}`.",
        ),
        (
            "E0423",
            "**Expected a function, found a macro.** Macros like `println!` need a `!` after their name.",
        ),
        (
            "E0277",
            "**A trait is missing.** Often this means mixing types, e.g. `i32 * f64`. Rust never converts numbers silently — use `as f64`.",
        ),
        (
            "E0502",
            "**Borrow conflict.** You can't borrow something mutably while it's also borrowed immutably.",
        ),
        (
            "E0499",
            "**Two mutable borrows at once.** Only one `&mut` can exist at a time.",
        ),
        (
            "E0596",
            "**Borrowing as mutable something that isn't `mut`.** Add `mut` where the variable is declared.",
        ),
        (
            "E0599",
            "**No such method.** That type doesn't have a method with this name. Check the spelling and the type.",
        ),
    ];
    let mut out = String::from("I'm in offline mode, but here's what I can tell you:\n\n");
    let mut found = false;
    for (code, note) in NOTES {
        if output.contains(&format!("[{code}]")) {
            out.push_str(&format!("- `{code}` — {note}\n"));
            found = true;
        }
    }
    if !found {
        let first = output
            .lines()
            .find(|l| l.starts_with("error") || l.contains("panicked") || l.contains("FAILED"))
            .unwrap_or("Compare your output with the expected output, line by line.");
        out.push_str(&format!("Start with the **first** problem:\n```\n{first}\n```\nThe `-->` line tells you the line number."));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::model_name;

    #[test]
    fn model_names_come_from_ids() {
        assert_eq!(model_name("claude-opus-5-5"), "Claude Opus 5.5");
        assert_eq!(model_name("claude-fable-5-1"), "Claude Fable 5.1");
        assert_eq!(model_name("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
        assert_eq!(model_name("claude-sonnet-6"), "Claude Sonnet 6");
    }

    use super::verdict_is_idiomatic;

    #[test]
    fn reads_the_review_verdict() {
        assert!(verdict_is_idiomatic("Nice!\n\nVERDICT: idiomatic"));
        assert!(verdict_is_idiomatic("Nice!\n---\n**VERDICT: idiomatic**"));
        assert!(!verdict_is_idiomatic("Close.\nVERDICT: improvable"));
        assert!(!verdict_is_idiomatic(
            "No verdict at all, but idiomatic code"
        ));
    }

    use super::*;
    use crate::levels::Kind;
    use crate::progress::{Completion, Progress};
    use serde_json::Value;

    /// An AppState backed by the real curriculum but a throwaway save folder, so the
    /// skip/replay/run rules can be exercised through the same handlers the UI uses.
    fn test_state(name: &str) -> Shared {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let worlds = crate::levels::load_worlds(&root.join("levels")).unwrap();
        let book = crate::levels::Book::load(&root.join("levels").join("book.toml")).unwrap();
        let save_dir = std::env::temp_dir().join(format!(
            "ferris-forge-api-test-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&save_dir);
        std::fs::create_dir_all(save_dir.join("tmp")).unwrap();
        let save_dir = save_dir.canonicalize().unwrap();
        Arc::new(AppState {
            save_dir,
            worlds,
            book,
            progress: Mutex::new(Progress::default()),
            usage: Arc::new(Mutex::new(None)),
            save_error: Mutex::new(None),
            notice: Mutex::new(None),
            rustc: None,
        })
    }

    fn id_req(id: &str) -> Json<IdReq> {
        Json(IdReq { id: id.to_string() })
    }

    fn find_level<'a>(s: &'a AppState, id: &str) -> (&'a World, usize, &'a Level) {
        World::find(&s.worlds, id).unwrap()
    }

    fn level_json(s: &AppState) -> Value {
        let p = s.progress.lock().unwrap();
        let mut out = serde_json::Map::new();
        for (wi, w) in s.worlds.iter().enumerate() {
            for (li, l) in w.levels.iter().enumerate() {
                out.insert(l.id.clone(), json!(s.level_status(&p, wi, li)));
            }
        }
        Value::Object(out)
    }

    fn assert_status(s: &AppState, id: &str, expected: &str) {
        assert_eq!(
            level_json(s).get(id).and_then(Value::as_str),
            Some(expected),
            "level {id} should be {expected}, full state: {}",
            level_json(s)
        );
    }

    fn complete(s: &Shared, id: &str, xp: u32) {
        let mut p = s.progress.lock().unwrap();
        p.xp += xp;
        p.completed.insert(
            id.to_string(),
            Completion {
                xp,
                hints_used: 0,
                attempts: 1,
            },
        );
        p.reached.insert(id.to_string());
    }

    #[tokio::test]
    async fn skip_marks_the_level_and_unlocks_the_next_one() {
        let s = test_state("skip");
        assert_status(&s, "0.1", "open");
        assert_status(&s, "0.2", "locked");

        let res = skip(State(s.clone()), id_req("0.1")).await.unwrap().0;
        assert_eq!(res["status"], "skipped");
        assert_eq!(res["next_id"], json!("0.2"));
        assert_eq!(
            res["next_status"], "open",
            "skipping unlocks the next level"
        );

        let p = s.progress.lock().unwrap();
        assert!(p.skipped.contains("0.1"));
        assert!(p.has_reached("0.1"));
        drop(p);
        assert_status(&s, "0.1", "skipped");
        assert_status(&s, "0.2", "open");
    }

    #[tokio::test]
    async fn boss_levels_cannot_be_skipped() {
        let s = test_state("boss");
        // Mark every level before the boss as reached, so the boss is playable rather than
        // merely locked (the 403 path is covered separately).
        let all: Vec<&Level> = s.worlds.iter().flat_map(|w| &w.levels).collect();
        let boss_at = all.iter().position(|l| l.id == "1.8").unwrap();
        assert_eq!(all[boss_at].kind, Kind::Boss);
        for l in &all[..boss_at] {
            s.progress.lock().unwrap().reached.insert(l.id.clone());
        }

        let err = skip(State(s.clone()), id_req("1.8")).await.unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
        assert!(
            !s.progress.lock().unwrap().skipped.contains("1.8"),
            "a refused skip changes nothing"
        );
    }

    #[tokio::test]
    async fn locked_levels_reject_skip_and_replay_with_403() {
        let s = test_state("locked");
        // Nothing has been reached, so every level after the first is locked.
        let err = skip(State(s.clone()), id_req("0.2")).await.unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
        let err = replay(State(s.clone()), id_req("0.2")).await.unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn replay_returns_xp_persists_and_keeps_later_levels_open() {
        let s = test_state("replay");
        complete(&s, "0.1", 20);
        // The level after it is open thanks to `reached`, even before it is finished too.
        assert_status(&s, "0.1", "done");
        assert_status(&s, "0.2", "open");

        let before = s.progress.lock().unwrap().xp;
        let res = replay(State(s.clone()), id_req("0.1")).await.unwrap().0;
        assert_eq!(res["xp_returned"], 20);
        assert_eq!(res["replays"], 1);
        assert_eq!(res["status"], "open", "a replayed level is playable again");
        assert_eq!(
            res["next_status"], "open",
            "replaying never re-locks what came after"
        );

        let p = s.progress.lock().unwrap();
        assert_eq!(p.xp, before - 20, "the returned XP left the player total");
        assert!(!p.is_done("0.1"));
        assert!(p.has_reached("0.1"), "the level stays reached");
        assert_eq!(p.replay_count("0.1"), 1);
        // Persisted to disk: a freshly loaded save still carries the replay count.
        s.save(&p);
        drop(p);
        let (loaded, _) = Progress::load(&s.save_path()).unwrap();
        assert_eq!(loaded.replay_count("0.1"), 1);
        assert!(loaded.has_reached("0.1"));
        assert_status(&s, "0.2", "open");
    }

    #[tokio::test]
    async fn replaying_a_cleared_level_twice_never_drives_xp_negative() {
        let s = test_state("replay-twice");
        complete(&s, "0.1", 20);
        let first = replay(State(s.clone()), id_req("0.1")).await.unwrap().0;
        assert_eq!(first["xp_returned"], 20);
        let second = replay(State(s.clone()), id_req("0.1")).await.unwrap().0;
        assert_eq!(second["xp_returned"], 0, "nothing left to take back");
        assert_eq!(second["replays"], 2);
        assert_eq!(s.progress.lock().unwrap().xp, 0);
    }

    #[tokio::test]
    async fn stale_compile_results_are_flagged_and_change_nothing() {
        let s = test_state("stale");
        let (_, li, level) = find_level(&s, "0.1");
        complete(&s, "0.1", level.xp);

        // A compile began in the old attempt (generation 0); the replay bumps the count and
        // takes the earned XP back.
        s.progress.lock().unwrap().replay("0.1");
        let xp_after_replay = s.progress.lock().unwrap().xp;
        assert_eq!(xp_after_replay, 0);

        // A failing result from the old attempt: stale, so its error codes aren't recorded.
        let failing = runner::RunResult {
            compiled: false,
            error_codes: vec!["E0384".to_string()],
            ..Default::default()
        };
        let res = s.finish_run(level, li, failing, 0);
        assert_eq!(res["stale"], json!(true));
        assert_eq!(res["xp_gained"], 0);
        assert_eq!(res["first_clear"], false);

        // A passing result from the same old attempt: stale too, so it must not clear.
        let passing = runner::RunResult {
            passed: true,
            ..Default::default()
        };
        let res = s.finish_run(level, li, passing, 0);
        assert_eq!(res["stale"], json!(true));
        assert_eq!(res["first_clear"], false);

        let p = s.progress.lock().unwrap();
        assert_eq!(p.xp, xp_after_replay, "a stale result awards no XP");
        assert!(!p.completed.contains_key("0.1"), "the replay still stands");
        assert!(p.codex.is_empty(), "a stale result records no error codes");
        assert!(
            p.attempts.get("0.1").is_none(),
            "a stale result adds no attempt"
        );
    }

    #[tokio::test]
    async fn current_compile_results_clear_the_level_and_pay_xp() {
        let s = test_state("current");
        let (_, li, level) = find_level(&s, "0.1");
        let passing = runner::RunResult {
            passed: true,
            ..Default::default()
        };
        let generation = s.progress.lock().unwrap().replay_count("0.1");
        let res = s.finish_run(level, li, passing, generation);
        assert_eq!(res["stale"], json!(false));
        assert_eq!(res["first_clear"], true);
        assert_eq!(res["xp_gained"], json!(level.xp));
        let p = s.progress.lock().unwrap();
        assert!(p.completed.contains_key("0.1"));
        assert_eq!(p.xp, level.xp);
    }

    #[tokio::test]
    async fn stale_after_a_simulated_restart_still_blocks_the_old_result() {
        let s = test_state("restart");
        let (_, li, level) = find_level(&s, "0.1");
        complete(&s, "0.1", level.xp);
        s.progress.lock().unwrap().replay("0.1");
        // Write the save, then reload it the way `main` does on startup.
        {
            let p = s.progress.lock().unwrap();
            s.save(&p);
        }
        let (loaded, _) = Progress::load(&s.save_path()).unwrap();
        assert_eq!(loaded.replay_count("0.1"), 1);
        *s.progress.lock().unwrap() = loaded;

        // The old compile's generation (0) is now stale even though the process "restarted".
        let passing = runner::RunResult {
            passed: true,
            ..Default::default()
        };
        let res = s.finish_run(level, li, passing, 0);
        assert_eq!(res["stale"], json!(true));
        assert!(!s.progress.lock().unwrap().completed.contains_key("0.1"));
    }
}
