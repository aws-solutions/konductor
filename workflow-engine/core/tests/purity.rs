// SPDX-License-Identifier: Apache-2.0
//! Checks that the core crate does no IO and reads no clock, randomness or environment.
//!
//! The core may use `std` and `core` for plain data, and the crates in `ALLOWED_CRATES`. It may not import file,
//! network, process, environment, clock, thread or random code. The scan works on source text after comments and
//! string literals are removed, and it expands `use` trees, so `use std::{fs::File, io}` is read as two paths.
//!
//! This is the Rust twin of `workflow-canvas/stub-api/core/purity.test.ts`.

use std::fs;
use std::path::{Path, PathBuf};

/// The crates the core may depend on. A crate is added here only if it does no IO.
const ALLOWED_CRATES: &[&str] = &["saphyr-parser"];

/// Paths in `std` that touch the world. A `use` of one, or a use of anything under one, is a violation.
const BANNED_PATHS: &[&str] = &[
    "std::fs",
    "std::net",
    "std::process",
    "std::env",
    "std::thread",
    "std::os",
    "std::path",
    "std::backtrace",
    "std::time::SystemTime",
    "std::time::Instant",
    "std::time::UNIX_EPOCH",
    "std::io::stdin",
    "std::io::stdout",
    "std::io::stderr",
    // The default hasher of these seeds itself from the system, which makes iteration order differ between runs.
    "std::collections::HashMap",
    "std::collections::HashSet",
    "std::hash::RandomState",
];

/// Names that reach the world however they were imported.
const BANNED_IDENTS: &[&str] = &[
    "SystemTime",
    "Instant",
    "UNIX_EPOCH",
    "stdin",
    "stdout",
    "stderr",
    "RandomState",
    "HashMap",
    "HashSet",
    "unsafe",
    "extern",
];

/// Macros that print, or read a file or the environment when the crate is built.
const BANNED_MACROS: &[&str] = &[
    "print",
    "println",
    "eprint",
    "eprintln",
    "dbg",
    "include",
    "include_str",
    "include_bytes",
    "env",
    "option_env",
    "asm",
    "global_asm",
];

const ROOTS: &[&str] = &["std", "core", "alloc"];

fn core_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

// ---------------------------------------------------------------------------------------------------------------------
// Source text
// ---------------------------------------------------------------------------------------------------------------------

/// The source with comments and the insides of string and character literals blanked out. Line breaks and the character
/// count are kept.
fn blank_comments_and_literals(source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;
    let blank = |c: char| if c == '\n' { '\n' } else { ' ' };
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            let mut depth = 0;
            while i < chars.len() {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    depth += 1;
                    out.push_str("  ");
                    i += 2;
                } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    out.push_str("  ");
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    out.push(blank(chars[i]));
                    i += 1;
                }
            }
        } else if let Some(hashes) = raw_string_start(&chars, i) {
            // r"..." or r#"..."# (also br"..."): skip to the closing quote followed by the same number of hashes.
            let open = chars[i..].iter().position(|&x| x == '"').unwrap_or(0);
            out.extend(std::iter::repeat_n(' ', open + 1));
            i += open + 1;
            while i < chars.len() {
                if chars[i] == '"' && (0..hashes).all(|k| chars.get(i + 1 + k) == Some(&'#')) {
                    out.extend(std::iter::repeat_n(' ', hashes + 1));
                    i += hashes + 1;
                    break;
                }
                out.push(blank(chars[i]));
                i += 1;
            }
        } else if c == '"' {
            out.push(' ');
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    out.push(' ');
                    i += 1;
                }
                out.push(blank(chars[i]));
                i += 1;
            }
            out.push(' ');
            i += 1;
        } else if c == '\'' && is_char_literal(&chars, i) {
            out.push(' ');
            i += 1;
            while i < chars.len() && chars[i] != '\'' {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    out.push(' ');
                    i += 1;
                }
                out.push(' ');
                i += 1;
            }
            out.push(' ');
            i += 1;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// The number of `#` of a raw string that starts at `i`, or `None` if no raw string starts there.
fn raw_string_start(chars: &[char], i: usize) -> Option<usize> {
    let mut j = i;
    if chars.get(j) == Some(&'b') {
        j += 1;
    }
    if chars.get(j) != Some(&'r') {
        return None;
    }
    // `r` must start a token: not the tail of an identifier such as `for` or `bar`.
    if i > 0 && (chars[i - 1].is_alphanumeric() || chars[i - 1] == '_') {
        return None;
    }
    j += 1;
    let mut hashes = 0;
    while chars.get(j) == Some(&'#') {
        hashes += 1;
        j += 1;
    }
    (chars.get(j) == Some(&'"')).then_some(hashes)
}

/// Tells a character literal (`'a'`, `'\n'`) from a lifetime (`'a`).
fn is_char_literal(chars: &[char], i: usize) -> bool {
    match chars.get(i + 1) {
        Some('\\') => true,
        Some(_) => chars.get(i + 2) == Some(&'\''),
        None => false,
    }
}

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Ident(String),
    PathSep,
    Open,
    Close,
    Comma,
    Star,
    Semi,
    Bang,
    Other,
}

fn tokenize(blanked: &str) -> Vec<Token> {
    let chars: Vec<char> = blanked.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if is_ident_char(c) {
            let start = i;
            while i < chars.len() && is_ident_char(chars[i]) {
                i += 1;
            }
            tokens.push(Token::Ident(chars[start..i].iter().collect()));
        } else if c == ':' && chars.get(i + 1) == Some(&':') {
            tokens.push(Token::PathSep);
            i += 2;
        } else {
            tokens.push(match c {
                '{' => Token::Open,
                '}' => Token::Close,
                ',' => Token::Comma,
                '*' => Token::Star,
                ';' => Token::Semi,
                '!' => Token::Bang,
                _ => Token::Other,
            });
            i += 1;
        }
    }
    tokens
}

// ---------------------------------------------------------------------------------------------------------------------
// `use` trees
// ---------------------------------------------------------------------------------------------------------------------

/// Every path that a `use` item names, with groups expanded: `use std::{fs::File, io}` gives `std::fs::File` and
/// `std::io`. A glob ends in `::*`. A rename is dropped, and a trailing `::self` is removed.
fn used_paths(tokens: &[Token]) -> Vec<String> {
    let mut paths = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let starts_use = tokens[i] == Token::Ident("use".into());
        i += 1;
        if starts_use {
            let mut at = i;
            parse_use_tree(tokens, &mut at, &mut Vec::new(), &mut paths);
            i = at;
        }
    }
    paths
}

fn parse_use_tree(
    tokens: &[Token],
    at: &mut usize,
    prefix: &mut Vec<String>,
    out: &mut Vec<String>,
) {
    let base = prefix.len();
    let mut glob = false;
    loop {
        match tokens.get(*at) {
            Some(Token::PathSep) => *at += 1,
            Some(Token::Ident(word)) if word == "as" => {
                *at += 2;
            }
            Some(Token::Ident(word)) => {
                prefix.push(word.clone());
                *at += 1;
            }
            Some(Token::Star) => {
                glob = true;
                *at += 1;
            }
            Some(Token::Open) => {
                *at += 1;
                loop {
                    parse_use_tree(tokens, at, prefix, out);
                    match tokens.get(*at) {
                        Some(Token::Comma) => *at += 1,
                        Some(Token::Close) => {
                            *at += 1;
                            break;
                        }
                        _ => break,
                    }
                }
                prefix.truncate(base);
                return;
            }
            _ => break,
        }
    }
    if prefix.len() > base {
        let mut path: Vec<&str> = prefix.iter().map(String::as_str).collect();
        if path.last() == Some(&"self") && path.len() > 1 {
            path.pop();
        }
        out.push(format!(
            "{}{}",
            path.join("::"),
            if glob { "::*" } else { "" }
        ));
    }
    prefix.truncate(base);
}

fn path_violation(path: &str) -> Option<String> {
    if ROOTS.contains(&path) {
        return Some(format!(
            "imports the root `{path}` as a name, which hides what is used"
        ));
    }
    if let Some(root) = path.strip_suffix("::*") {
        let hit = BANNED_PATHS
            .iter()
            .find(|b| **b == root || b.starts_with(&format!("{root}::")));
        return hit.map(|b| format!("glob-imports `{root}`, which holds `{b}`"));
    }
    let hit = BANNED_PATHS
        .iter()
        .find(|b| path == **b || path.starts_with(&format!("{b}::")));
    hit.map(|b| format!("imports `{path}` (`{b}` touches the world)"))
}

// ---------------------------------------------------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------------------------------------------------

/// Every way that a core source breaks the rules.
fn problems_in(file: &str, source: &str) -> Vec<String> {
    let blanked = blank_comments_and_literals(source);
    let tokens = tokenize(&blanked);
    let mut problems = Vec::new();

    for path in used_paths(&tokens) {
        if let Some(why) = path_violation(&path) {
            problems.push(format!("{file}: {why}"));
        }
    }

    // A banned path written out in code, such as `std::fs::read(..)` or `::std::env::var(..)`.
    let squeezed: String = blanked.chars().filter(|c| !c.is_whitespace()).collect();
    for banned in BANNED_PATHS {
        let mut from = 0;
        while let Some(found) = squeezed[from..].find(banned) {
            let end = from + found + banned.len();
            let before = squeezed[..from + found].chars().last();
            let after = squeezed[end..].chars().next();
            let whole = !before.is_some_and(is_ident_char) && !after.is_some_and(is_ident_char);
            if whole {
                problems.push(format!("{file}: uses `{banned}`"));
                break;
            }
            from = end;
        }
    }

    for (n, token) in tokens.iter().enumerate() {
        let Token::Ident(word) = token else { continue };
        if BANNED_IDENTS.contains(&word.as_str()) {
            problems.push(format!("{file}: uses `{word}`"));
        }
        if tokens.get(n + 1) == Some(&Token::Bang) && BANNED_MACROS.contains(&word.as_str()) {
            problems.push(format!("{file}: calls `{word}!`"));
        }
    }

    problems.sort();
    problems.dedup();
    problems
}

/// The `.rs` files under a directory, at any depth, as (path relative to the directory, text).
fn rust_sources_under(dir: &Path) -> Vec<(String, String)> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .expect("read dir")
            .map(|e| e.expect("entry").path())
            .collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                walk(base, &path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                let rel = path
                    .strip_prefix(base)
                    .expect("under base")
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, fs::read_to_string(&path).expect("read source")));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out
}

// ---------------------------------------------------------------------------------------------------------------------
// Cargo.toml
// ---------------------------------------------------------------------------------------------------------------------

/// The crates that a manifest depends on, in any dependency section, and the sections that can redirect a crate.
fn manifest_dependencies(manifest: &str) -> (Vec<String>, Vec<String>) {
    let mut crates = Vec::new();
    let mut redirects = Vec::new();
    let mut in_dependencies = false;
    let mut table_dependency: Option<usize> = None;
    for raw in manifest.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(header) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            let header = header
                .trim_matches('[')
                .trim_matches(']')
                .replace(['"', '\''], "");
            table_dependency = None;
            in_dependencies = false;
            if header.starts_with("patch") || header.starts_with("replace") {
                redirects.push(header.clone());
            }
            let parts: Vec<&str> = header.split('.').collect();
            // `[dependencies]`, `[target.x.dev-dependencies]`, `[workspace.dependencies]`
            if parts.last().is_some_and(|p| p.ends_with("dependencies")) {
                in_dependencies = true;
            }
            // `[dependencies.foo]`
            if let Some(at) = parts.iter().position(|p| p.ends_with("dependencies")) {
                if at + 1 < parts.len() {
                    crates.push(parts[at + 1..].join("."));
                    table_dependency = Some(crates.len() - 1);
                }
            }
            continue;
        }
        if let (Some(index), Some(real)) = (table_dependency, package_rename(line)) {
            crates[index] = real;
        }
        if in_dependencies && table_dependency.is_none() {
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let name = key
                .trim()
                .split('.')
                .next()
                .unwrap_or("")
                .trim()
                .replace(['"', '\''], "");
            crates.push(package_rename(value).unwrap_or(name));
        }
    }
    (crates, redirects)
}

/// The crate named by `package = "name"`, which a dependency uses to rename itself.
fn package_rename(text: &str) -> Option<String> {
    let at = text.find("package")?;
    let rest = text[at + "package".len()..]
        .trim_start()
        .strip_prefix('=')?
        .trim_start();
    let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let body = &rest[1..];
    Some(body[..body.find(quote)?].to_string())
}

fn crate_is_allowed(name: &str) -> bool {
    ALLOWED_CRATES
        .iter()
        .any(|a| a.replace('-', "_") == name.replace('-', "_"))
}

fn manifest_problems(manifest: &str) -> Vec<String> {
    let (crates, redirects) = manifest_dependencies(manifest);
    let mut problems: Vec<String> = crates
        .into_iter()
        .filter(|name| !crate_is_allowed(name))
        .map(|name| format!("Cargo.toml depends on `{name}`, which is not in the allow list"))
        .collect();
    problems.extend(
        redirects
            .into_iter()
            .map(|h| format!("Cargo.toml has a `[{h}]` section")),
    );
    if manifest
        .lines()
        .any(|l| l.trim_start().starts_with("build") && l.contains('='))
    {
        problems.push("Cargo.toml names a build script".into());
    }
    problems
}

// ---------------------------------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_core_has_sources_to_check() {
    assert!(!rust_sources_under(&core_dir().join("src")).is_empty());
}

#[test]
fn the_core_imports_and_uses_nothing_that_touches_the_world() {
    let problems: Vec<String> = rust_sources_under(&core_dir().join("src"))
        .iter()
        .flat_map(|(file, source)| problems_in(file, source))
        .collect();
    assert_eq!(problems, Vec::<String>::new());
}

#[test]
fn the_core_depends_only_on_allowed_crates() {
    let manifest = fs::read_to_string(core_dir().join("Cargo.toml")).expect("read manifest");
    assert_eq!(manifest_problems(&manifest), Vec::<String>::new());
}

#[test]
fn the_core_has_no_build_script() {
    assert!(!core_dir().join("build.rs").exists());
}

#[test]
fn the_core_forbids_unsafe_code() {
    let lib = fs::read_to_string(core_dir().join("src/lib.rs")).expect("read lib.rs");
    assert!(lib.contains("#![forbid(unsafe_code)]"));
}

mod the_scan {
    use super::*;

    fn bad(source: &str) -> bool {
        !problems_in("x.rs", source).is_empty()
    }

    #[test]
    fn accepts_plain_data_code() {
        let source = r##"
            use std::collections::BTreeMap;
            use std::fmt::{self, Display};
            use std::time::Duration;
            use std::io::{self, Write};
            // std::fs::read is named in a comment, and so is "std::env" in a string.
            /* println!("nested /* comment */ still a comment") */
            pub fn f(map: &BTreeMap<String, u8>) -> &'static str { let _c = 'x'; "std::fs" }
            pub fn raw() -> &'static str { r#"std::process::exit(1)"# }
        "##;
        assert_eq!(problems_in("x.rs", source), Vec::<String>::new());
    }

    #[test]
    fn rejects_imports_of_the_world() {
        for line in [
            "use std::fs;",
            "use std::fs::File;",
            "use std::{fs::File, io};",
            "use std::{io, net::TcpStream};",
            "use std::{collections::BTreeMap, process};",
            "use std::process::Command;",
            "use std::env;",
            "use std::env::var;",
            "use std::thread;",
            "use std::time::Instant;",
            "use std::time::SystemTime;",
            "use std::time::{Duration, SystemTime};",
            "use std::time::{Instant as Tick};",
            "use std::time::*;",
            "use std::io::stdin;",
            "use std::io::{stdout, Write};",
            "use std::collections::HashMap;",
            "use std::collections::HashSet;",
            "use std::collections::hash_map::RandomState;",
            "use std::hash::RandomState;",
            "use std::path::Path;",
            "use std::os::unix::fs::PermissionsExt;",
            "use ::std::fs;",
            "pub use std::fs::File;",
            "pub(crate) use std::fs::File;",
            "use std as s;",
            "use std::*;",
            "use core as c;",
        ] {
            assert!(bad(line), "should reject: {line}");
        }
    }

    #[test]
    fn rejects_uses_written_out_in_code() {
        for code in [
            "fn f() { let _ = std::fs::read(\"x\"); }",
            "fn f() { let _ = ::std::env::var(\"X\"); }",
            "fn f() { let _ = std :: process :: id(); }",
            "fn f() { std::thread::sleep(d); }",
            "fn f() { let _ = std::time::Instant::now(); }",
            "fn f() { let _ = std::time::SystemTime::now(); }",
            "fn f() { let _ = std::net::TcpStream::connect(a); }",
            "fn f() { let _: std::collections::HashMap<u8, u8>; }",
        ] {
            assert!(bad(code), "should reject: {code}");
        }
    }

    #[test]
    fn rejects_names_that_reach_the_world_however_they_were_imported() {
        for code in [
            "fn f() { let t = Instant::now(); }",
            "fn f() { let t = SystemTime::now(); }",
            "fn f() { let _ = UNIX_EPOCH; }",
            "fn f() { let _ = io::stdin(); }",
            "fn f() { let _ = io::stdout(); }",
            "fn f() { let m: HashMap<u8, u8>; }",
        ] {
            assert!(bad(code), "should reject: {code}");
        }
    }

    #[test]
    fn rejects_macros_that_print_or_read_files() {
        for code in [
            "fn f() { println!(\"x\"); }",
            "fn f() { eprintln!(\"x\"); }",
            "fn f() { print!(\"x\"); }",
            "fn f() { dbg!(1); }",
            "const A: &str = include_str!(\"a.txt\");",
            "const A: &[u8] = include_bytes!(\"a.bin\");",
            "const A: &str = env!(\"CARGO_PKG_NAME\");",
            "const A: Option<&str> = option_env!(\"X\");",
        ] {
            assert!(bad(code), "should reject: {code}");
        }
    }

    #[test]
    fn rejects_unsafe_and_foreign_code() {
        for code in [
            "fn f() { unsafe { g() } }",
            "extern \"C\" { fn getpid() -> i32; }",
            "extern crate libc;",
        ] {
            assert!(bad(code), "should reject: {code}");
        }
    }

    #[test]
    fn is_not_fooled_by_names_that_only_contain_a_banned_word() {
        let source =
            "fn standard_env_name() { let process_id = 1; let fsync = 2; let instantly = 3; }";
        assert_eq!(problems_in("x.rs", source), Vec::<String>::new());
    }

    #[test]
    fn expands_use_groups() {
        let tokens = tokenize("use std::{fs::File, io::{self, Read}, time::Duration as D};");
        assert_eq!(
            used_paths(&tokens),
            [
                "std::fs::File",
                "std::io",
                "std::io::Read",
                "std::time::Duration"
            ]
        );
    }
}

mod the_manifest_scan {
    use super::*;

    #[test]
    fn accepts_the_allowed_crate_in_every_form() {
        for manifest in [
            "[dependencies]\nsaphyr-parser = \"=0.3.3\"\n",
            "[dependencies]\nsaphyr-parser = { version = \"0.3\", default-features = false }\n",
            "[dependencies]\nsaphyr-parser.workspace = true\n",
            "[dependencies.saphyr-parser]\nversion = \"0.3\"\n",
            "[package]\nname = \"workflow-core\"\n[dependencies]\n",
        ] {
            assert_eq!(
                manifest_problems(manifest),
                Vec::<String>::new(),
                "{manifest}"
            );
        }
    }

    #[test]
    fn rejects_any_other_crate_in_any_section() {
        for manifest in [
            "[dependencies]\nrand = \"0.8\"\n",
            "[dependencies]\nrand.workspace = true\n",
            "[dependencies.rand]\nversion = \"0.8\"\n",
            "[dev-dependencies]\ntempfile = \"3\"\n",
            "[build-dependencies]\ncc = \"1\"\n",
            "[target.'cfg(unix)'.dependencies]\nlibc = \"0.2\"\n",
            "[workspace.dependencies]\nureq = \"2\"\n",
            "[dependencies]\nfine = { package = \"getrandom\", version = \"0.2\" }\n",
            "[dependencies.fine]\npackage = \"getrandom\"\nversion = \"0.2\"\n",
            "[dependencies]\nsaphyr-parser = \"0.3\"\nserde = \"1\"\n",
        ] {
            assert!(
                !manifest_problems(manifest).is_empty(),
                "should reject:\n{manifest}"
            );
        }
    }

    #[test]
    fn rejects_patches_and_build_scripts() {
        assert!(
            !manifest_problems("[patch.crates-io]\nsaphyr-parser = { path = \"x\" }\n").is_empty()
        );
        assert!(!manifest_problems("[package]\nbuild = \"build.rs\"\n").is_empty());
    }
}
