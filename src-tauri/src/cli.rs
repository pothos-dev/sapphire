//! Command-line argument parsing.
//!
//! Sapphire is CLI-launched (`sapphire ./docs`). The only arguments are an
//! optional positional Bundle path plus the conventional `--help`/`--version`
//! flags. We hand-roll the parse (no `clap`) to keep the dependency surface
//! small; the grammar is tiny and the logic is pure so it can be unit-tested.

/// What the parsed command line tells the binary to do.
#[derive(Debug, PartialEq, Eq)]
pub enum CliAction {
    /// Launch the app. The optional path is the Bundle root from the command
    /// line; `None` means "fall back to `SAPPHIRE_BUNDLE` / the per-build
    /// default" (see `resolve_bundle_root`).
    Run(Option<String>),
    /// Print version information to stdout and exit successfully.
    Version,
    /// Print usage help to stdout and exit successfully.
    Help,
    /// An argument error: print the message to stderr and exit non-zero.
    Error(String),
}

/// Parse the CLI arguments, which MUST already have the program name stripped
/// (i.e. pass `std::env::args().skip(1)`).
///
/// Grammar: at most one positional Bundle path, plus the flags `-h`/`--help`
/// and `-V`/`--version`. `--help`/`--version` take precedence wherever they
/// appear. Any unrecognised flag, or a second positional argument, is rejected.
pub fn parse_args<I, S>(args: I) -> CliAction
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut path: Option<String> = None;
    for arg in args {
        let a = arg.as_ref();
        match a {
            "-h" | "--help" => return CliAction::Help,
            "-V" | "--version" => return CliAction::Version,
            // Anything else starting with '-' is an unknown option. A lone "-"
            // is treated as a positional (harmless; not a recognised flag).
            _ if a.starts_with('-') && a != "-" => {
                return CliAction::Error(format!(
                    "unknown option '{a}'\n\nTry 'sapphire --help' for usage."
                ));
            }
            _ => {
                if path.is_some() {
                    return CliAction::Error(format!(
                        "unexpected extra argument '{a}'\n\nTry 'sapphire --help' for usage."
                    ));
                }
                path = Some(a.to_string());
            }
        }
    }
    CliAction::Run(path)
}

/// The `--version` line, e.g. `sapphire 0.10.0`.
pub fn version_string() -> String {
    format!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"))
}

/// The `--help` text.
pub fn help_string() -> String {
    format!(
        "\
{name} {version}
A CLI-launched markdown editor with first-class Open Knowledge Format support.

Usage:
  {name} [BUNDLE]

Arguments:
  BUNDLE        Path to the folder to open as a Bundle (default: current directory)

Options:
  -h, --help    Print this help and exit
  -V, --version Print version information and exit
",
        name = env!("CARGO_PKG_NAME"),
        version = env!("CARGO_PKG_VERSION"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_args_runs_with_no_path() {
        assert_eq!(parse_args(Vec::<String>::new()), CliAction::Run(None));
    }

    #[test]
    fn positional_is_the_bundle_path() {
        assert_eq!(
            parse_args(["./docs"]),
            CliAction::Run(Some("./docs".to_string()))
        );
    }

    #[test]
    fn version_flags_request_version() {
        assert_eq!(parse_args(["--version"]), CliAction::Version);
        assert_eq!(parse_args(["-V"]), CliAction::Version);
    }

    #[test]
    fn help_flags_request_help() {
        assert_eq!(parse_args(["--help"]), CliAction::Help);
        assert_eq!(parse_args(["-h"]), CliAction::Help);
    }

    #[test]
    fn version_takes_precedence_over_a_path() {
        assert_eq!(parse_args(["./docs", "--version"]), CliAction::Version);
    }

    #[test]
    fn unknown_flag_is_rejected() {
        match parse_args(["--nope"]) {
            CliAction::Error(msg) => assert!(msg.contains("unknown option '--nope'")),
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn unknown_short_flag_is_rejected() {
        match parse_args(["-x"]) {
            CliAction::Error(msg) => assert!(msg.contains("unknown option '-x'")),
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn second_positional_is_rejected() {
        match parse_args(["./a", "./b"]) {
            CliAction::Error(msg) => assert!(msg.contains("unexpected extra argument './b'")),
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn lone_dash_is_a_positional_not_a_flag() {
        assert_eq!(parse_args(["-"]), CliAction::Run(Some("-".to_string())));
    }

    #[test]
    fn version_string_is_name_and_semver() {
        let v = version_string();
        assert!(v.starts_with("sapphire "));
        assert_eq!(v, format!("sapphire {}", env!("CARGO_PKG_VERSION")));
    }
}
