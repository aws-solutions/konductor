// SPDX-License-Identifier: Apache-2.0
//! The built page. The server serves the files under one folder and nothing else: a path that leaves it, in any
//! spelling, and a link anywhere on the way, is not there.

use std::fs;
use std::io::Read;
use std::path::PathBuf;

use crate::run_store::open_no_follow;

/// The largest file served.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// What the policy is when the page's own `<meta>` tag has none.
const FALLBACK_POLICY: &str = "default-src 'self'; base-uri 'none'; form-action 'none'";

#[derive(Debug)]
pub struct Pages {
    dir: PathBuf,
    csp: String,
}

/// A file to send.
pub struct Page {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

impl Pages {
    /// The page folder `dir`, which must hold a regular `index.html`. The policy of the `Content-Security-Policy`
    /// header is the one in the `<meta>` tag of that file, plus `frame-ancestors 'none'`, which a `<meta>` tag cannot
    /// set.
    pub fn open(dir: PathBuf) -> Result<Pages, String> {
        let pages = Pages {
            dir,
            csp: String::new(),
        };
        let index = pages
            .read("/")
            .ok_or_else(|| format!("{} has no index.html", pages.dir.display()))?;
        let html = String::from_utf8_lossy(&index.bytes);
        let policy = meta_policy(&html).unwrap_or(FALLBACK_POLICY);
        let csp = format!("{policy}; frame-ancestors 'none'");
        Ok(Pages { csp, ..pages })
    }

    /// The `Content-Security-Policy` header value.
    pub fn policy(&self) -> &str {
        &self.csp
    }

    /// The file for a request path, or `None`. `/` is `index.html`.
    pub fn read(&self, url_path: &str) -> Option<Page> {
        let segments = segments(url_path)?;
        let mut path = self.dir.clone();
        for (n, segment) in segments.iter().enumerate() {
            path.push(segment);
            // A link is neither a file nor a folder here, wherever it points.
            let meta = fs::symlink_metadata(&path).ok()?;
            let last = n + 1 == segments.len();
            if (last && !meta.is_file()) || (!last && !meta.is_dir()) {
                return None;
            }
            if last && meta.len() > MAX_FILE_BYTES {
                return None;
            }
        }
        let file = open_no_follow(&path).ok()?;
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).ok()?;
        let name = segments.last().copied().unwrap_or("");
        Some(Page {
            bytes,
            content_type: content_type(name),
        })
    }
}

/// The parts of a request path below the page folder. Anything that could leave the folder is refused, whether it
/// is spelled with `..`, a backslash, a percent escape or an absolute path: the page has no file that needs one.
fn segments(url_path: &str) -> Option<Vec<&str>> {
    if url_path == "/" {
        return Some(vec!["index.html"]);
    }
    let rest = url_path.strip_prefix('/')?;
    let plain = |c: char| !c.is_control() && !matches!(c, '%' | '\\' | ':' | '?' | '#');
    let ok = rest
        .split('/')
        .all(|s| !s.is_empty() && s != "." && s != ".." && s.chars().all(plain));
    ok.then(|| rest.split('/').collect())
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit_once('.').map(|(_, e)| e) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// The policy in `<meta http-equiv="Content-Security-Policy" content="...">`.
fn meta_policy(html: &str) -> Option<&str> {
    let at = html.find("http-equiv=\"Content-Security-Policy\"")?;
    let rest = &html[at..];
    let start = rest.find("content=\"")? + "content=\"".len();
    let end = rest[start..].find('"')?;
    Some(&rest[start..start + end])
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("canvas-pages-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("page/assets")).unwrap();
        fs::write(
            dir.join("page/index.html"),
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; base-uri 'none'\">",
        )
        .unwrap();
        fs::write(dir.join("page/assets/app.js"), "x").unwrap();
        fs::write(dir.join("secret.txt"), "secret").unwrap();
        dir
    }

    #[test]
    fn the_root_is_index_html_and_the_policy_adds_frame_ancestors() {
        let dir = scratch("root");
        let pages = Pages::open(dir.join("page")).unwrap();
        assert_eq!(
            pages.policy(),
            "default-src 'self'; base-uri 'none'; frame-ancestors 'none'"
        );
        let index = pages.read("/").unwrap();
        assert!(index.content_type.starts_with("text/html"));
        assert_eq!(
            pages.read("/assets/app.js").unwrap().content_type,
            "text/javascript; charset=utf-8"
        );
        assert!(pages.read("/assets/missing.js").is_none());
        assert!(pages.read("/assets").is_none(), "a folder is not a page");
    }

    #[test]
    fn a_folder_without_index_html_is_refused() {
        let dir = scratch("noindex");
        fs::remove_file(dir.join("page/index.html")).unwrap();
        assert!(Pages::open(dir.join("page")).is_err());
    }

    #[test]
    fn a_path_that_leaves_the_folder_is_not_there_in_any_spelling() {
        let dir = scratch("escape");
        let pages = Pages::open(dir.join("page")).unwrap();
        for path in [
            "/../secret.txt",
            "/assets/../../secret.txt",
            "/%2e%2e/secret.txt",
            "/assets/%2e%2e/%2e%2e/secret.txt",
            "/..%2fsecret.txt",
            "/%2fetc/passwd",
            "//etc/passwd",
            "/\\..\\secret.txt",
            "/assets//app.js",
            "/assets/./app.js",
            "/assets/",
            "/index.html\0",
            "secret.txt",
            "",
        ] {
            assert!(pages.read(path).is_none(), "{path:?}");
        }
    }

    #[test]
    fn a_link_that_points_out_is_not_followed() {
        let dir = scratch("link");
        symlink(dir.join("secret.txt"), dir.join("page/assets/out.txt")).unwrap();
        symlink(&dir, dir.join("page/up")).unwrap();
        let pages = Pages::open(dir.join("page")).unwrap();
        assert!(pages.read("/assets/out.txt").is_none());
        assert!(pages.read("/up/secret.txt").is_none());
    }
}
