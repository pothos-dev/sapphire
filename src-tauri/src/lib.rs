mod cli;

use std::path::PathBuf;
use std::sync::Arc;

use sapphire_core::app_state::AppState;
use sapphire_core::bundle::{self, TreeNode};
use sapphire_core::config::{self, BundleState, WindowState};
use sapphire_core::git::{self, FileAtRev, FileHistory};
use sapphire_core::index::TagCount;
use sapphire_core::render::{self, RenderPayload};
use sapphire_core::rewrite::{self, AnchorRename, RewriteSummary};
use sapphire_core::search::{self, SearchHit};
use sapphire_core::watcher::{self, FILE_CHANGED_EVENT};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, State, WindowEvent};

/// Absolute path of the opened Bundle root.
#[tauri::command]
fn bundle_root(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    Ok(state.bundle_root.to_string_lossy().into_owned())
}

/// Recursive directory tree of the Bundle.
#[tauri::command]
fn list_tree(state: State<'_, Arc<AppState>>) -> Result<TreeNode, String> {
    bundle::list_tree(&state.bundle_root)
}

/// Raw markdown of a single Concept, by bundle-relative path.
#[tauri::command]
fn read_concept(state: State<'_, Arc<AppState>>, path: String) -> Result<String, String> {
    bundle::read_concept(&state.bundle_root, &path)
}

/// Write a Concept's raw markdown back to disk (autosave). Records the write in
/// the self-write tracker so the filesystem watcher suppresses its own echo.
#[tauri::command]
fn write_concept(state: State<'_, Arc<AppState>>, path: String, content: String) -> Result<(), String> {
    let resolved = bundle::write_concept(&state.bundle_root, &path, &content)?;
    state.note_self_write(resolved);
    Ok(())
}

/// Create a new, empty Concept (`.md`) at `path` (bundle-relative). The minimal
/// stub is an empty file; the rich frontmatter scaffold is a later slice. NOT
/// recorded as a self-write: a structural create SHOULD refresh the tree.
#[tauri::command]
fn create_concept(state: State<'_, Arc<AppState>>, path: String) -> Result<(), String> {
    bundle::create_concept(&state.bundle_root, &path)?;
    Ok(())
}

/// Create a new folder (and any missing parents) at `path` (bundle-relative).
#[tauri::command]
fn create_folder(state: State<'_, Arc<AppState>>, path: String) -> Result<(), String> {
    bundle::create_folder(&state.bundle_root, &path)?;
    Ok(())
}

/// Rename/move `from` to `to` (both bundle-relative). Performs the filesystem
/// rename AND automatically rewrites every link affected by the move (inbound
/// links from other Concepts, plus the moved Concept's own relative outbound
/// links — folder moves apply this to every contained Concept). Works for both
/// Concepts and folders. Returns a summary of how many links across how many
/// files were rewritten.
#[tauri::command]
fn rename_path(
    state: State<'_, Arc<AppState>>,
    from: String,
    to: String,
) -> Result<RewriteSummary, String> {
    rewrite::rename_and_rewrite(&state, &from, &to)
}

/// Move `from` into the folder `toDir` (bundle-relative; '' for the root),
/// keeping the original name, then auto-rewrite affected links. Convenience over
/// `rename_path`; returns the same rewrite summary.
#[tauri::command]
fn move_path(
    state: State<'_, Arc<AppState>>,
    from: String,
    to_dir: String,
) -> Result<RewriteSummary, String> {
    rewrite::move_into(&state, &from, &to_dir)
}

/// Delete `path` (a Concept or a folder, recursively). The frontend confirms
/// before calling this.
#[tauri::command]
fn delete_path(state: State<'_, Arc<AppState>>, path: String) -> Result<(), String> {
    bundle::delete_path(&state.bundle_root, &path)
}

/// Rewrite inbound link anchors after a heading in `target` was renamed in the
/// editor (slice: slug-anchor-rewrite). `renames` maps each changed heading's old
/// slug to its new slug; every concept linking to `target` has its matching
/// `#anchor`s rewritten. Returns a summary of how many anchors across how many
/// files changed. The target's own same-file anchors are handled in the buffer.
#[tauri::command]
fn rewrite_anchors(
    state: State<'_, Arc<AppState>>,
    target: String,
    renames: Vec<AnchorRename>,
) -> Result<RewriteSummary, String> {
    rewrite::rewrite_anchors(&state, &target, &renames)
}

/// Every Concept path in the Bundle index. The frontend seeds its synchronous
/// broken-link existence cache from this (one query instead of per-link calls).
#[tauri::command]
fn list_concept_paths(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    Ok(state.read_index()?.concept_paths())
}

/// Whether a Concept exists at `path` (bundle-relative). Convenience companion
/// to `list_concept_paths`; the broken-link decoration uses the cached set.
#[tauri::command]
fn concept_exists(state: State<'_, Arc<AppState>>, path: String) -> Result<bool, String> {
    Ok(state.read_index()?.concept_exists(&path))
}

/// Sources linking TO `path` (backlinks). Used by the backlinks panel (slice 7).
#[tauri::command]
fn backlinks(state: State<'_, Arc<AppState>>, path: String) -> Result<Vec<String>, String> {
    Ok(state.read_index()?.backlinks(&path))
}

/// All tags across the Bundle with per-tag counts. Used by the tags view (slice 8).
#[tauri::command]
fn all_tags(state: State<'_, Arc<AppState>>) -> Result<Vec<TagCount>, String> {
    Ok(state.read_index()?.all_tags())
}

/// Concept paths carrying `tag`. Used by the tag browser (slice 8) to reveal
/// the Concepts under a selected tag.
#[tauri::command]
fn concepts_by_tag(state: State<'_, Arc<AppState>>, tag: String) -> Result<Vec<String>, String> {
    Ok(state.read_index()?.concepts_by_tag(&tag))
}

/// All distinct frontmatter `type` values. Used by new-concept autocomplete (slice 12).
#[tauri::command]
fn all_types(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    Ok(state.read_index()?.all_types())
}

/// All distinct top-level frontmatter keys across the Bundle. Used by the
/// Properties panel's key-name autocomplete (key-and-tag autocomplete slice);
/// the OKF recommended keys are merged in client-side.
#[tauri::command]
fn all_keys(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    Ok(state.read_index()?.all_keys())
}

/// Full-text (body content) search across the Bundle, on demand. Scans every
/// `.md` Concept body with the ripgrep libraries (no external binary) and
/// returns matches (path + 1-based line + matching line snippet), ordered by
/// path then line and capped server-side. Case-insensitive literal search.
#[tauri::command]
fn search(state: State<'_, Arc<AppState>>, query: String) -> Result<Vec<SearchHit>, String> {
    search::search(&state.bundle_root, &query)
}

/// Commit history (newest first) of the commits touching the bundle-relative
/// `path`, via `git log --follow`. The backend does NO diffing. Every edge
/// (not-a-repo / untracked / no-history / git-missing) comes back as a
/// distinguishable `FileHistory` variant so the review-diff toggle can disable
/// itself; only a path-escape is a hard error. Paths are bundle-relative,
/// '/'-separated.
#[tauri::command]
fn file_history(state: State<'_, Arc<AppState>>, path: String) -> Result<FileHistory, String> {
    // Reject `..`/absolute escapes the same way the other path commands do; the
    // target need not exist on disk (history can outlive the working tree).
    bundle::resolve_new(&state.bundle_root, &path)?;
    Ok(git::file_history(&state.bundle_root, &path))
}

/// Full text of the bundle-relative `path` at revision `rev`, via
/// `git show <rev>:<path>`. The working-tree side is the ordinary
/// `read_concept`; the frontend diffs the two. Edge cases surface as
/// `FileAtRev` variants (not-a-repo / not-found / git-missing) rather than
/// errors; only a path-escape is a hard error.
#[tauri::command]
fn file_at_rev(
    state: State<'_, Arc<AppState>>,
    path: String,
    rev: String,
) -> Result<FileAtRev, String> {
    bundle::resolve_new(&state.bundle_root, &path)?;
    Ok(git::file_at_rev(&state.bundle_root, &path, &rev))
}

/// Render the Concept at `path` (bundle-relative) to server-quality HTML: the
/// body rendered with CriticMarkup annotations and resolved wikilinks, plus the
/// parsed frontmatter and heading outline. Same core render the web viewer uses
/// (`sapphire_core::render`); feeds the desktop "Export as PDF" print path. Links
/// resolve against the in-memory index; the read lock is held only for the call.
#[tauri::command]
fn render_concept(state: State<'_, Arc<AppState>>, path: String) -> Result<RenderPayload, String> {
    let index = state.read_index()?;
    render::render_concept(&state.bundle_root, &index, &path)
}

/// Percent-encode a string for use in a URL query value (RFC 3986 unreserved
/// set passes through; everything else is `%XX`). Small local helper so the
/// print-window URL below needs no extra dependency.
fn encode_query(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Open a chrome-free print/PDF preview of the Concept at `path` in a SEPARATE
/// native window (WebKitGTK has no rich PDF chrome of its own, so the preview
/// carries its own reader controls). The window loads the same SPA shell with
/// `?print=<path>&toolbar=1`, which the root route resolves to `PrintView`.
/// If a print window is already open it is reused (navigated + focused).
#[tauri::command]
fn open_print_window(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let query = format!("?print={}&toolbar=1", encode_query(&path));
    if let Some(existing) = app.get_webview_window("print") {
        existing
            .eval(&format!("window.location.replace('index.html{query}')"))
            .map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "print",
        tauri::WebviewUrl::App(format!("index.html{query}").into()),
    )
    .title("Print — Sapphire")
    .inner_size(900.0, 1100.0)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Export the print window's current rendering straight to a PDF FILE, skipping
/// the OS print dialog. Prompts for a destination with a native save-file
/// chooser (default name `default_name`), then writes the PDF. Returns the saved
/// path, or `None` if the chooser was cancelled. Direct export is implemented
/// via WebKitGTK on Linux; other platforms return an error so the frontend can
/// fall back to the print dialog (`window.print()`).
#[tauri::command]
async fn save_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    default_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let chosen = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&default_name)
        .blocking_save_file();
    let Some(chosen) = chosen else {
        return Ok(None); // user cancelled the save dialog
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    export_webview_pdf(&window, &path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// WebKitGTK-backed PDF export: drive the webview's `WebKitPrintOperation` with
/// GTK print settings pointed at a "Print to File" PDF output, so `print()`
/// writes the file WITHOUT showing a dialog. Runs on the GTK main thread via
/// `with_webview`.
#[cfg(target_os = "linux")]
fn export_webview_pdf(
    window: &tauri::WebviewWindow,
    path: &std::path::Path,
) -> Result<(), String> {
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    let uri = format!("file://{}", path.to_string_lossy());
    window
        .with_webview(move |platform| {
            let webview = platform.inner();
            let settings = gtk::PrintSettings::new();
            settings.set("output-uri", Some(uri.as_str()));
            settings.set("output-file-format", Some("pdf"));
            let op = PrintOperation::new(&webview);
            op.set_print_settings(&settings);
            // `print()` is asynchronous; keep the operation alive until it emits
            // `finished` (otherwise dropping the wrapper here cancels the export).
            // A self-reference held in the `finished` handler is released once the
            // file is written, letting the operation drop.
            let hold = std::rc::Rc::new(std::cell::RefCell::new(None));
            let hold_in = hold.clone();
            op.connect_finished(move |_| {
                hold_in.borrow_mut().take();
            });
            *hold.borrow_mut() = Some(op.clone());
            op.print();
        })
        .map_err(|e| e.to_string())
}

/// macOS PDF export via `WKWebView.createPDFWithConfiguration:completionHandler:`
/// (macOS 11+). The completion block writes the returned `NSData` to `path`.
/// Best-effort: implemented to the documented API but not runtime-verified.
#[cfg(target_os = "macos")]
fn export_webview_pdf(
    window: &tauri::WebviewWindow,
    path: &std::path::Path,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::WKWebView;

    let out = path.to_owned();
    window
        .with_webview(move |platform| {
            let ptr = platform.inner() as *const WKWebView;
            let Some(webview) = (unsafe { ptr.as_ref() }) else {
                return;
            };
            let out = out.clone();
            // WKWebView copies the completion block, so it outlives this scope.
            let handler = RcBlock::new(move |data: *mut NSData, _err: *mut NSError| {
                if let Some(data) = unsafe { data.as_ref() } {
                    let _ = std::fs::write(&out, data.to_vec());
                }
            });
            unsafe {
                webview.createPDFWithConfiguration_completionHandler(None, &handler);
            }
        })
        .map_err(|e| e.to_string())
}

/// Windows PDF export via WebView2 `ICoreWebView2_7::PrintToPdf`, which writes
/// the PDF straight to a file path (no dialog). Best-effort: implemented to the
/// documented API but not runtime-verified.
#[cfg(windows)]
fn export_webview_pdf(
    window: &tauri::WebviewWindow,
    path: &std::path::Path,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PrintSettings, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let file = HSTRING::from(path.to_string_lossy().as_ref());
    window
        .with_webview(move |platform| {
            let run = || -> windows::core::Result<()> {
                let core = unsafe { platform.controller().CoreWebView2()? };
                let wv7: ICoreWebView2_7 = core.cast()?;
                let handler = PrintToPdfCompletedHandler::create(Box::new(|_hr, _ok| Ok(())));
                let no_settings: Option<&ICoreWebView2PrintSettings> = None;
                unsafe { wv7.PrintToPdf(&file, no_settings, &handler)? };
                Ok(())
            };
            if let Err(e) = run() {
                eprintln!("WebView2 PrintToPdf failed: {e}");
            }
        })
        .map_err(|e| e.to_string())
}

/// Platforms without a wired-up webview PDF exporter: report unsupported so the
/// frontend falls back to the print dialog (`window.print()`).
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn export_webview_pdf(
    _window: &tauri::WebviewWindow,
    _path: &std::path::Path,
) -> Result<(), String> {
    Err("direct PDF export is not supported on this platform".into())
}

/// Load the persisted per-Bundle session state (last-open Concept, expanded
/// folders, window geometry) for the open Bundle. Robust to a missing/corrupt
/// store: returns defaults. See `config.rs` — never written into the Bundle.
#[tauri::command]
fn load_bundle_state(state: State<'_, Arc<AppState>>) -> Result<BundleState, String> {
    Ok(config::load_bundle_state(&state.bundle_root))
}

/// Persist the per-Bundle session state for the open Bundle. Merges into the
/// global store (other Bundles' entries + app config are preserved). The
/// frontend calls this (debounced) when the open Concept or expanded folders
/// change. Window geometry is owned by Rust and merged separately, so the
/// frontend's saved value here carries the window through untouched.
#[tauri::command]
fn save_bundle_state(state: State<'_, Arc<AppState>>, bundle_state: BundleState) -> Result<(), String> {
    config::save_bundle_state(&state.bundle_root, bundle_state)
}

/// Capture the current window geometry into a `WindowState`. Uses logical
/// (DPI-independent) units so a restore on a differently-scaled display is sane.
fn capture_window_state(window: &tauri::WebviewWindow) -> Option<WindowState> {
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let pos = window
        .outer_position()
        .ok()
        .map(|p| p.to_logical::<f64>(scale));
    Some(WindowState {
        width: size.width.round() as u32,
        height: size.height.round() as u32,
        x: pos.map(|p| p.x.round() as i32),
        y: pos.map(|p| p.y.round() as i32),
    })
}

/// Resolve the Bundle root, then canonicalize it. Resolution order:
///   1. `SAPPHIRE_BUNDLE` env var, if set,
///   2. the positional CLI path (already parsed by `cli::parse_args`), if given,
///   3. the per-build default (see `default_bundle_root`).
fn resolve_bundle_root(cli_path: Option<String>) -> PathBuf {
    let explicit = std::env::var("SAPPHIRE_BUNDLE")
        .ok()
        .filter(|s| !s.is_empty())
        .or(cli_path);
    let path = explicit.map(PathBuf::from).unwrap_or_else(default_bundle_root);
    path.canonicalize().unwrap_or(path)
}

/// Default Bundle root for a DEV build: the `examples/` vault at the repo root
/// (one level up from this crate). `tauri dev` runs the binary from `src-tauri/`,
/// so a bare `.` would open the crate dir; pointing at the bundled example vault
/// makes `bun tauri dev` land in a real Bundle. Override with `SAPPHIRE_BUNDLE`
/// or a path argument. `CARGO_MANIFEST_DIR` is the absolute `src-tauri/` path
/// baked in at compile time.
#[cfg(debug_assertions)]
fn default_bundle_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../examples")
}

/// Default Bundle root for a RELEASE build: the current working directory.
#[cfg(not(debug_assertions))]
fn default_bundle_root() -> PathBuf {
    PathBuf::from(".")
}

/// Env marker set on the re-spawned child of a `--detached` launch, so the child
/// runs the UI normally instead of detaching again (which would loop forever).
const DETACHED_CHILD_ENV: &str = "SAPPHIRE_DETACHED_CHILD";

/// Re-spawn this executable as a console-independent child and let the parent
/// return immediately, freeing the terminal (`--detached` / `-d`). The child is
/// given its own process group (so terminal job-control signals — Ctrl+C, and
/// SIGHUP on terminal close — don't reach it) with stdio detached to null; on
/// Windows it gets `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`. The Bundle
/// path is forwarded; `SAPPHIRE_BUNDLE` and the rest of the environment are
/// inherited. The `DETACHED_CHILD_ENV` marker stops the child from detaching
/// again.
fn spawn_detached(bundle: &Option<String>) -> std::io::Result<()> {
    use std::process::{Command, Stdio};
    let exe = std::env::current_exe()?;
    let mut cmd = Command::new(exe);
    if let Some(path) = bundle {
        cmd.arg(path);
    }
    cmd.env(DETACHED_CHILD_ENV, "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // New process group, detached from the terminal's job control.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Parse the command line BEFORE starting Tauri so `--version`/`--help` print
    // to the terminal and exit without ever opening a window, and unknown options
    // are rejected instead of being treated as a Bundle path.
    let opts = match cli::parse_args(std::env::args().skip(1)) {
        cli::CliAction::Run(opts) => opts,
        cli::CliAction::Version => {
            println!("{}", cli::version_string());
            return;
        }
        cli::CliAction::Help => {
            print!("{}", cli::help_string());
            return;
        }
        cli::CliAction::Error(msg) => {
            eprintln!("error: {msg}");
            std::process::exit(2);
        }
    };

    // `--detached`: re-spawn ourselves as a console-independent process and let
    // this (parent) process exit, returning the shell prompt. Skip when we ARE
    // the re-spawned child (marker set), so the child runs the UI normally.
    if opts.detached && std::env::var_os(DETACHED_CHILD_ENV).is_none() {
        match spawn_detached(&opts.bundle) {
            Ok(()) => return,
            Err(e) => {
                eprintln!("error: failed to launch detached: {e}");
                std::process::exit(1);
            }
        }
    }

    let cli_path = opts.bundle;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let bundle_root = resolve_bundle_root(cli_path);

            // Restore the saved window geometry for this Bundle (size always;
            // position only if we have one). Window state lives in Rust so the
            // frontend never imports window APIs (ARCHITECTURE.md).
            if let Some(win) = config::load_window_state(&bundle_root) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_size(LogicalSize::new(win.width, win.height));
                    if let (Some(x), Some(y)) = (win.x, win.y) {
                        let _ = window.set_position(LogicalPosition::new(x, y));
                    }
                }
            }

            // Save window geometry on resize / move / close. We persist the
            // window slice independently of the frontend's session state so the
            // two never clobber each other.
            if let Some(window) = app.get_webview_window("main") {
                let root_for_events = bundle_root.clone();
                let window_for_events = window.clone();
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::Resized(_)
                            | WindowEvent::Moved(_)
                            | WindowEvent::CloseRequested { .. }
                    ) {
                        if let Some(ws) = capture_window_state(&window_for_events) {
                            let _ = config::save_window_state(&root_for_events, ws);
                        }
                    }
                });
            }

            // The AppState is shared (behind an `Arc`) between the command layer
            // (managed in Tauri state) and the filesystem watcher, so both the
            // index and the self-write tracker observe one source of truth.
            let state = Arc::new(AppState::new(bundle_root));
            app.manage(state.clone());

            // Start the filesystem watcher and keep the handle alive for the
            // app's lifetime by managing it in Tauri state. `sapphire-core`'s
            // watcher is host-agnostic: it hands us each `FileChange` through a
            // sink; the desktop sink emits it to the frontend as a Tauri event.
            let app_handle = app.handle().clone();
            let watch_root = state.bundle_root.clone();
            match watcher::start(watch_root, state.clone(), move |change| {
                let _ = app_handle.emit(FILE_CHANGED_EVENT, change);
            }) {
                Ok(w) => {
                    app.manage(watcher::WatcherHandle::new(w));
                }
                Err(e) => {
                    eprintln!("failed to start filesystem watcher: {e}");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bundle_root,
            list_tree,
            read_concept,
            write_concept,
            create_concept,
            create_folder,
            rename_path,
            move_path,
            delete_path,
            rewrite_anchors,
            list_concept_paths,
            concept_exists,
            backlinks,
            all_tags,
            concepts_by_tag,
            all_types,
            all_keys,
            search,
            file_history,
            file_at_rev,
            render_concept,
            open_print_window,
            save_pdf,
            load_bundle_state,
            save_bundle_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
