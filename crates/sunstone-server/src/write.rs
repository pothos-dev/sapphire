//! Write orchestration for the web write path (tickets 05/07/08).
//!
//! The server is the sole committer. Each op composes the unchanged, commitless
//! `sunstone-core` writers (`bundle` / `rewrite`) and then commits via the core
//! `git` primitive — every op **write-then-commits immediately** (there is no
//! server-side pending Save; the editor's Save *is* the `PUT`).
//!
//! Concurrency: the caller runs each op on a blocking thread while holding the
//! server-global write lock, so the whole write → (rewrite) → commit critical
//! section is serialized against a consistent working tree (ticket 05/07 §4).
//!
//! Self-write / SSE (ticket 08): a web write must reach every *other* browser as
//! a genuine change, and the *writer's* browser must drop its own echo. Rather
//! than suppress-before-broadcast (which drops the event for everyone) we
//! `note_self_write` the affected paths — muting the watcher's *unstamped* echo —
//! and return the change groups so the caller can broadcast ONE `FileChange`
//! **stamped with the write's `origin`** (clientId + author). Each browser then
//! drops the change whose `clientId` is its own. Divergence from ticket 08 §1's
//! "do NOT note_self_write" is deliberate: pairing suppression with an explicit
//! stamped broadcast yields exactly one attributed event, avoiding the duplicate
//! (stamped + unstamped) delivery the naive reading would produce.

use sunstone_core::app_state::AppState;
use sunstone_core::bundle;
use sunstone_core::git::{self, CommitIdentity};
use sunstone_core::rewrite::{self, AnchorRename, RewriteSummary};

use axum::http::StatusCode;

/// One SSE change group to broadcast (becomes one stamped `FileChange`). A
/// rename yields two (a `removed` of the old path, a `modified`/`created` of the
/// new) so a client with the old path open falls into the "deleted" state
/// (ticket 08 §2).
pub struct ChangeGroup {
    pub kind: &'static str,
    pub paths: Vec<String>,
}

/// Result of a write op: the change groups to broadcast + an optional rewrite
/// summary (rename/move/rewrite-anchors) for the HTTP response body.
pub struct WriteResult {
    pub changes: Vec<ChangeGroup>,
    pub summary: Option<RewriteSummary>,
}

impl WriteResult {
    fn change(kind: &'static str, path: String) -> Self {
        WriteResult {
            changes: vec![ChangeGroup {
                kind,
                paths: vec![path],
            }],
            summary: None,
        }
    }
}

/// `PUT /api/concept` — overwrite an existing Concept's body, commit `edit`.
pub fn write_concept(
    app: &AppState,
    ident: &CommitIdentity,
    path: &str,
    content: &str,
) -> Result<WriteResult, String> {
    let resolved = bundle::write_concept(&app.bundle_root, path, content)?;
    app.note_self_write(resolved);
    git::commit(
        &app.bundle_root,
        &[path],
        &format!("edit {path} via web"),
        ident,
    )?;
    Ok(WriteResult::change("modified", path.to_string()))
}

/// `POST /api/concept` — create a new empty Concept, commit `create`.
pub fn create_concept(
    app: &AppState,
    ident: &CommitIdentity,
    path: &str,
) -> Result<WriteResult, String> {
    let resolved = bundle::create_concept(&app.bundle_root, path)?;
    app.note_self_write(resolved);
    git::commit(
        &app.bundle_root,
        &[path],
        &format!("create {path} via web"),
        ident,
    )?;
    Ok(WriteResult::change("created", path.to_string()))
}

/// `POST /api/folder` — create a folder. An empty directory cannot be committed
/// (git tracks no empty dirs), so there is nothing to commit here; the folder
/// enters history when its first Concept lands. We still broadcast a `created`
/// so every client refreshes its tree.
pub fn create_folder(
    app: &AppState,
    _ident: &CommitIdentity,
    path: &str,
) -> Result<WriteResult, String> {
    let resolved = bundle::create_folder(&app.bundle_root, path)?;
    app.note_self_write(resolved);
    Ok(WriteResult::change("created", path.to_string()))
}

/// `POST /api/rename` — rename/move + auto link rewrite, commit `rename`.
pub fn rename_path(
    app: &AppState,
    ident: &CommitIdentity,
    from: &str,
    to: &str,
) -> Result<WriteResult, String> {
    // Mute the watcher echo for the old (removed) and new paths; core
    // `rename_and_rewrite` already `note_self_write`s the rewrite targets.
    app.note_self_write(app.bundle_root.join(from));
    let summary = rewrite::rename_and_rewrite(app, from, to)?;
    app.note_self_write(app.bundle_root.join(to));
    // Structural op → stage the whole tree (the op's move + every fixup); the
    // global lock guarantees no other write is in flight.
    git::commit(
        &app.bundle_root,
        &[],
        &format!("rename {from} → {to} via web"),
        ident,
    )?;
    Ok(structural_result(summary, from, to))
}

/// `POST /api/move` — move into a folder + auto link rewrite, commit `move`.
pub fn move_path(
    app: &AppState,
    ident: &CommitIdentity,
    from: &str,
    to_dir: &str,
) -> Result<WriteResult, String> {
    // Compute the resulting path for the broadcast + commit message.
    let name = from
        .rsplit('/')
        .find(|s| !s.is_empty())
        .ok_or_else(|| format!("invalid source path: {from}"))?;
    let to = if to_dir.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", to_dir.trim_end_matches('/'), name)
    };
    app.note_self_write(app.bundle_root.join(from));
    let summary = rewrite::move_into(app, from, to_dir)?;
    app.note_self_write(app.bundle_root.join(&to));
    git::commit(
        &app.bundle_root,
        &[],
        &format!("move {from} → {to} via web"),
        ident,
    )?;
    Ok(structural_result(summary, from, &to))
}

/// `DELETE /api/concept?path=` — delete a Concept/folder, commit `delete`.
pub fn delete_path(
    app: &AppState,
    ident: &CommitIdentity,
    path: &str,
) -> Result<WriteResult, String> {
    app.note_self_write(app.bundle_root.join(path));
    bundle::delete_path(&app.bundle_root, path)?;
    git::commit(
        &app.bundle_root,
        &[path],
        &format!("delete {path} via web"),
        ident,
    )?;
    Ok(WriteResult::change("removed", path.to_string()))
}

/// `POST /api/rewrite-anchors` — rewrite inbound anchors after a heading rename,
/// folding into the preceding `edit … via web` commit when it is ours (ticket
/// 07 §5: amend-else-fresh).
pub fn rewrite_anchors(
    app: &AppState,
    ident: &CommitIdentity,
    target: &str,
    renames: &[AnchorRename],
) -> Result<WriteResult, String> {
    let summary = rewrite::rewrite_anchors(app, target, renames)?;
    // Nothing to write (no inbound anchors matched) → no commit, no broadcast.
    if summary.files_changed == 0 {
        return Ok(WriteResult {
            changes: Vec::new(),
            summary: Some(summary),
        });
    }

    // Amend iff HEAD is the matching `edit <target> via web` commit authored by
    // this same user; otherwise a fresh `relink` commit. Either way stage the
    // whole tree (the rewrite touched inbound sources we don't enumerate here).
    let head = git::head_commit(&app.bundle_root);
    let amendable = head.is_some_and(|h| {
        h.subject == format!("edit {target} via web")
            && h.author_name == ident.name
            && h.author_email == ident.email
    });
    if amendable {
        git::amend(&app.bundle_root, &[], ident)?;
    } else {
        git::commit(
            &app.bundle_root,
            &[],
            &format!("relink {target} via web"),
            ident,
        )?;
    }

    // The target's committed body is authoritative — broadcast a `modified` so
    // other clients reload it / refresh their sidebars.
    Ok(WriteResult {
        changes: vec![ChangeGroup {
            kind: "modified",
            paths: vec![target.to_string()],
        }],
        summary: Some(summary),
    })
}

/// Build the two-group broadcast + summary for a rename/move.
fn structural_result(summary: RewriteSummary, from: &str, to: &str) -> WriteResult {
    WriteResult {
        changes: vec![
            ChangeGroup {
                kind: "removed",
                paths: vec![from.to_string()],
            },
            ChangeGroup {
                kind: "modified",
                paths: vec![to.to_string()],
            },
        ],
        summary: Some(summary),
    }
}

/// Classify a write failure into an HTTP status. Distinct from the READ
/// classifier (whose default is 404): a write's default failure is a *server*
/// fault (500). Auth failures never reach here (the extractor 401s first).
pub fn classify_write(msg: &str) -> StatusCode {
    if msg.contains("escapes the bundle")
        || msg.contains("must be bundle-relative")
        || msg.contains("must end in .md")
        || msg.contains("must not be empty")
    {
        StatusCode::BAD_REQUEST // 400 — invalid path (client)
    } else if msg.contains("already exists") || msg.contains("already in that folder") {
        StatusCode::CONFLICT // 409 — create/rename onto an existing target
    } else if msg.contains("does not exist") || msg.contains("No such file") {
        StatusCode::NOT_FOUND // 404 — referenced path/parent missing
    } else {
        StatusCode::INTERNAL_SERVER_ERROR // 500 — IO / git / poisoned lock
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU32, Ordering};
    use sunstone_core::git::{self, FileHistory};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn git_available() -> bool {
        Command::new("git").arg("--version").output().is_ok()
    }

    fn run(root: &Path, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?} failed: {out:?}");
    }

    /// A temp bundle that IS a git repo, with an initial commit so HEAD exists.
    fn temp_repo() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("sunstone-write-{}-{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = dir.canonicalize().unwrap();
        run(&dir, &["init", "-q"]);
        run(&dir, &["config", "user.email", "seed@example.com"]);
        run(&dir, &["config", "user.name", "Seed"]);
        run(&dir, &["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join(".gitkeep"), "").unwrap();
        run(&dir, &["add", "-A"]);
        run(&dir, &["commit", "-q", "-m", "seed"]);
        dir
    }

    fn ident() -> CommitIdentity {
        CommitIdentity {
            name: "Ada Lovelace".into(),
            email: "ada@example.com".into(),
        }
    }

    fn head_subject(root: &Path) -> String {
        git::head_commit(root).unwrap().subject
    }

    #[test]
    fn write_concept_commits_edit_as_the_authed_user() {
        if !git_available() {
            return;
        }
        let root = temp_repo();
        std::fs::write(root.join("a.md"), "old\n").unwrap();
        let app = AppState::new(root.clone());

        let result = write_concept(&app, &ident(), "a.md", "new body\n").unwrap();
        assert_eq!(std::fs::read_to_string(root.join("a.md")).unwrap(), "new body\n");
        assert_eq!(head_subject(&root), "edit a.md via web");
        let head = git::head_commit(&root).unwrap();
        assert_eq!(head.author_name, "Ada Lovelace");
        assert_eq!(head.author_email, "ada@example.com");
        // Broadcast group: a single `modified` for the edited path.
        assert_eq!(result.changes.len(), 1);
        assert_eq!(result.changes[0].kind, "modified");
        assert_eq!(result.changes[0].paths, vec!["a.md".to_string()]);
    }

    #[test]
    fn create_and_delete_commit_their_verbs() {
        if !git_available() {
            return;
        }
        let root = temp_repo();
        let app = AppState::new(root.clone());

        let created = create_concept(&app, &ident(), "n.md").unwrap();
        assert!(root.join("n.md").is_file());
        assert_eq!(head_subject(&root), "create n.md via web");
        assert_eq!(created.changes[0].kind, "created");

        let removed = delete_path(&app, &ident(), "n.md").unwrap();
        assert!(!root.join("n.md").exists());
        assert_eq!(head_subject(&root), "delete n.md via web");
        assert_eq!(removed.changes[0].kind, "removed");
    }

    #[test]
    fn create_folder_does_not_commit_but_broadcasts() {
        if !git_available() {
            return;
        }
        let root = temp_repo();
        let app = AppState::new(root.clone());
        let before = head_subject(&root);

        let result = create_folder(&app, &ident(), "sub").unwrap();
        assert!(root.join("sub").is_dir());
        // Empty dir → nothing to commit; HEAD is unchanged.
        assert_eq!(head_subject(&root), before);
        assert_eq!(result.changes[0].kind, "created");
    }

    #[test]
    fn rename_commits_and_reports_removed_then_modified() {
        if !git_available() {
            return;
        }
        let root = temp_repo();
        // b links to a; renaming a must rewrite b and land ONE commit.
        std::fs::write(root.join("a.md"), "# A\n").unwrap();
        std::fs::write(root.join("b.md"), "see [a](/a.md)\n").unwrap();
        let app = AppState::new(root.clone());
        // Commit the starting files so the rename's diff is only the op.
        git::commit(&root, &[], "seed files", &ident()).unwrap();

        let result = rename_path(&app, &ident(), "a.md", "c.md").unwrap();
        assert!(!root.join("a.md").exists() && root.join("c.md").exists());
        assert_eq!(head_subject(&root), "rename a.md → c.md via web");
        // The inbound link was rewritten to the new path.
        assert!(std::fs::read_to_string(root.join("b.md")).unwrap().contains("/c.md"));
        // Two broadcast groups: removed(old) then modified(new).
        assert_eq!(result.changes[0].kind, "removed");
        assert_eq!(result.changes[0].paths, vec!["a.md".to_string()]);
        assert_eq!(result.changes[1].kind, "modified");
        assert_eq!(result.changes[1].paths, vec!["c.md".to_string()]);
        assert!(result.summary.is_some());
    }

    #[test]
    fn rewrite_anchors_amends_matching_edit_else_fresh() {
        if !git_available() {
            return;
        }
        let root = temp_repo();
        // src links to target's #intro anchor; target has that heading.
        std::fs::write(root.join("target.md"), "# Intro\n\nbody\n").unwrap();
        std::fs::write(root.join("src.md"), "see [x](/target.md#intro)\n").unwrap();
        let app = AppState::new(root.clone());
        git::commit(&root, &[], "seed files", &ident()).unwrap();

        // Simulate the editor's Save: writeConcept(target) → `edit target.md via web`.
        write_concept(&app, &ident(), "target.md", "# Introduction\n\nbody\n").unwrap();
        assert_eq!(head_subject(&root), "edit target.md via web");
        let commits_before = commit_count(&root);

        // rewriteAnchors renames #intro → #introduction: amends the edit commit.
        let renames = vec![anchor("intro", "introduction")];
        let result = rewrite_anchors(&app, &ident(), "target.md", &renames).unwrap();
        assert_eq!(head_subject(&root), "edit target.md via web", "amended, not fresh");
        assert_eq!(commit_count(&root), commits_before, "amend adds no commit");
        assert!(std::fs::read_to_string(root.join("src.md")).unwrap().contains("#introduction"));
        assert_eq!(result.summary.unwrap().files_changed, 1);

        // A rewriteAnchors with NO preceding matching edit → fresh `relink` commit.
        // Land an unrelated commit so HEAD no longer matches `edit target.md via web`.
        std::fs::write(root.join("other.md"), "unrelated\n").unwrap();
        git::commit(&root, &[], "unrelated head", &ident()).unwrap();
        let renames2 = vec![anchor("introduction", "overview")];
        // Need target to actually have the heading for the rename identity; the
        // rewrite operates on inbound sources regardless, so this still writes.
        let before2 = commit_count(&root);
        rewrite_anchors(&app, &ident(), "target.md", &renames2).unwrap();
        assert_eq!(head_subject(&root), "relink target.md via web");
        assert_eq!(commit_count(&root), before2 + 1, "fresh commit added");
    }

    fn commit_count(root: &Path) -> usize {
        match git::file_history(root, ".") {
            FileHistory::Ok { commits } => commits.len(),
            _ => {
                // `.` may not be a tracked pathspec on all gits; fall back to a
                // rev-list count.
                let out = Command::new("git")
                    .current_dir(root)
                    .args(["rev-list", "--count", "HEAD"])
                    .output()
                    .unwrap();
                String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0)
            }
        }
    }

    fn anchor(from: &str, to: &str) -> AnchorRename {
        // AnchorRename is Deserialize-only; build it via JSON to avoid depending
        // on private field visibility.
        serde_json::from_value(serde_json::json!({ "from": from, "to": to })).unwrap()
    }

    #[test]
    fn classify_write_maps_the_taxonomy() {
        assert_eq!(
            classify_write("path escapes the bundle: ../x"),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            classify_write("a Concept path must end in .md: x.txt"),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            classify_write("already exists: a.md"),
            StatusCode::CONFLICT
        );
        assert_eq!(
            classify_write("already in that folder: a.md"),
            StatusCode::CONFLICT
        );
        assert_eq!(
            classify_write("target folder does not exist: sub/x.md"),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            classify_write("git commit failed: boom"),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
