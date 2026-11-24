// SPDX-License-Identifier: Apache-2.0
//! The listener and the order in which a request is checked. The contract fixes the order, so two servers answer one
//! bad call with one status: `Host`, the path, the method, `Origin`, the token, the content type, the size of the
//! body, the body's shape, and then what the operation finds out about the file or the run.

use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use workflow_core::json::{self, Json};

use super::api::{self, ApiError, Reply};
use super::guards::{bearer, json_content_type, local_host, origin_allowed};
use super::http::{
    read_body, read_head, respond, Head, ReadError, Response, MAX_BODY_BYTES, READ_TIMEOUT,
};
use super::Shared;

/// The most connections open at once. Another one is closed as soon as it is accepted.
pub const MAX_CONNECTIONS: usize = 32;

/// Accepts connections until the server stops.
pub(super) fn accept_loop(shared: Arc<Shared>, listener: TcpListener) {
    let open = Arc::new(AtomicUsize::new(0));
    while !shared.stopping.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if open.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
                    open.fetch_sub(1, Ordering::SeqCst);
                    drop(stream);
                    continue;
                }
                let (shared, open) = (Arc::clone(&shared), Arc::clone(&open));
                // A thread that cannot start drops the closure, which drops the connection and its count.
                let _ = std::thread::Builder::new()
                    .name("canvas-connection".to_string())
                    .spawn(move || {
                        // The count goes down however the handler ends.
                        struct Count(Arc<AtomicUsize>);
                        impl Drop for Count {
                            fn drop(&mut self) {
                                self.0.fetch_sub(1, Ordering::SeqCst);
                            }
                        }
                        let _count = Count(open);
                        handle(&shared, stream);
                    });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}

/// The `operationId` of each operation of the contract that this server serves. The session lists them as its
/// capabilities, so an operation that is not served is not here. A test calls each of them on its path.
pub(super) const OPERATIONS: [&str; 7] = [
    "createSession",
    "getWorkflow",
    "saveWorkflow",
    "checkWorkflow",
    "startRun",
    "getRun",
    "listAgents",
];

/// What the router decided a path is.
enum Route {
    Session,
    Workflow,
    Validate,
    Agents,
    Run,
    RunStatus(String),
    Page,
}

fn route_of(path: &str) -> Option<Route> {
    match path {
        "/api/session" => Some(Route::Session),
        "/api/workflow" => Some(Route::Workflow),
        "/api/validate" => Some(Route::Validate),
        "/api/agents" => Some(Route::Agents),
        "/api/run" => Some(Route::Run),
        p if p == "/api" || p.starts_with("/api/") => match p.strip_prefix("/api/runs/") {
            Some(id) if !id.is_empty() && !id.contains('/') => {
                Some(Route::RunStatus(id.to_string()))
            }
            _ => None,
        },
        _ => Some(Route::Page),
    }
}

fn allowed_methods(route: &Route) -> &'static [&'static str] {
    match route {
        Route::Workflow => &["GET", "PUT"],
        Route::Session | Route::Validate | Route::Run => &["POST"],
        Route::Agents | Route::RunStatus(_) | Route::Page => &["GET"],
    }
}

fn json_response(status: u16, body: &Json, allow: Option<&str>) -> Response {
    let mut headers = vec![
        ("Cache-Control", "no-store".to_string()),
        ("X-Konductor-Api", "1".to_string()),
    ];
    if let Some(allow) = allow {
        headers.push(("Allow", allow.to_string()));
    }
    Response {
        status,
        content_type: "application/json",
        headers,
        body: body.compact().into_bytes(),
    }
}

fn error_response(error: &ApiError) -> Response {
    let allow = error.allow.map(str::to_string);
    json_response(error.status, &error.body(), allow.as_deref())
}

fn handle(shared: &Shared, mut stream: TcpStream) {
    let deadline = Instant::now() + READ_TIMEOUT;
    let (response, drain, send_body) = match read_head(&mut stream, deadline) {
        Ok(head) => match answer(shared, &mut stream, &head, deadline) {
            Some((response, drain)) => (response, drain, head.method != "HEAD"),
            None => return,
        },
        Err(ReadError::Bad) => (error_response(&ApiError::new("bad_request")), true, true),
        Err(ReadError::Gone) => return,
    };
    respond(&mut stream, &response, drain, send_body);
}

/// The answer to one request, and whether the rest of the connection should be read and dropped. `None` when the
/// client went away.
fn answer(
    shared: &Shared,
    stream: &mut TcpStream,
    head: &Head,
    deadline: Instant,
) -> Option<(Response, bool)> {
    let done = |result: Result<Response, ApiError>, drain: bool| {
        Some((result.unwrap_or_else(|e| error_response(&e)), drain))
    };
    // 1. Host. Nothing else about the request is looked at before it passes.
    let Some(host) = local_host(head, shared.port) else {
        return done(Err(ApiError::new("forbidden_host")), true);
    };
    // 2. Path, then method.
    let (path, query) = head
        .target
        .split_once('?')
        .unwrap_or((head.target.as_str(), ""));
    let Some(route) = route_of(path) else {
        return done(Err(ApiError::new("not_found")), true);
    };
    let methods = allowed_methods(&route);
    // A path that is not the contract's is unknown, whatever the method: only a `GET` can ask for the page.
    if matches!(route, Route::Page) && head.method != "GET" {
        return done(Err(ApiError::new("not_found")), true);
    }
    if !methods.contains(&head.method.as_str()) {
        let mut error = ApiError::new("method_not_allowed");
        error.allow = Some(match methods {
            ["GET", "PUT"] => "GET, PUT",
            ["POST"] => "POST",
            _ => "GET",
        });
        return done(Err(error), true);
    }
    // 3. Origin, and Sec-Fetch-Site.
    if !origin_allowed(head, &host) {
        return done(Err(ApiError::new("forbidden_origin")), true);
    }
    if let Route::Page = route {
        return Some((page(shared, path), false));
    }
    // 4. The token, for every call but the one that makes it.
    if !matches!(route, Route::Session) {
        let accepted = shared
            .gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .accepts(bearer(head));
        if !accepted {
            return done(Err(ApiError::new("unauthorized")), true);
        }
    }
    // 5. The body: type, size, then shape.
    let body = if head.method == "GET" {
        Json::Null
    } else {
        if !json_content_type(head) {
            return done(Err(ApiError::new("bad_request")), true);
        }
        let length = match head.content_length() {
            Ok(length) => length,
            Err(_) => return done(Err(ApiError::new("bad_request")), true),
        };
        if length > MAX_BODY_BYTES {
            return done(Err(ApiError::new("too_large")), true);
        }
        let bytes = match read_body(stream, head, length, deadline) {
            Ok(bytes) => bytes,
            Err(ReadError::Gone) => return None,
            Err(ReadError::Bad) => return done(Err(ApiError::new("bad_request")), true),
        };
        let parsed = std::str::from_utf8(&bytes)
            .ok()
            .and_then(|text| json::parse(text).ok());
        match parsed {
            Some(value) => value,
            None => return done(Err(ApiError::new("bad_request")), false),
        }
    };
    let result = match &route {
        Route::Session => api::create_session(shared, &body),
        Route::Workflow if head.method == "GET" => api::get_workflow(shared, &names_in(query)),
        Route::Workflow => api::save_workflow(shared, &body),
        Route::Validate => api::check_workflow(shared, &body),
        Route::Agents => api::list_agents(),
        Route::Run => api::start_run(shared, &body),
        Route::RunStatus(id) => api::get_run(shared, id),
        Route::Page => unreachable!("a page is answered above"),
    };
    done(
        result.map(|Reply { status, body }| json_response(status, &body, None)),
        false,
    )
}

fn page(shared: &Shared, path: &str) -> Response {
    match shared.pages.read(path) {
        Some(page) => Response {
            status: 200,
            content_type: page.content_type,
            headers: vec![
                ("Cache-Control", "no-store".to_string()),
                ("X-Konductor-Api", "1".to_string()),
                ("Content-Security-Policy", shared.pages.policy().to_string()),
                ("X-Content-Type-Options", "nosniff".to_string()),
                ("Referrer-Policy", "no-referrer".to_string()),
            ],
            body: page.bytes,
        },
        None => error_response(&ApiError::new("not_found")),
    }
}

/// The values of the `name` parameter in a query string, decoded. Another parameter is ignored.
pub(super) fn names_in(query: &str) -> Vec<String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(key) == "name").then(|| decode(value))
        })
        .collect()
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len()
                && bytes[i + 1].is_ascii_hexdigit()
                && bytes[i + 2].is_ascii_hexdigit() =>
            {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00");
                out.push(u8::from_str_radix(hex, 16).unwrap_or(0));
                i += 2;
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_name_parameter_is_decoded_and_counted() {
        assert_eq!(names_in(""), Vec::<String>::new());
        assert_eq!(names_in("name=hello"), ["hello"]);
        assert_eq!(names_in("other=1&name=a%2Db"), ["a-b"]);
        assert_eq!(names_in("name=a&name=b"), ["a", "b"]);
        assert_eq!(names_in("name"), [""]);
        assert_eq!(names_in("nam%65=x"), ["x"]);
    }

    #[test]
    fn a_path_is_a_route_only_when_the_contract_names_it() {
        assert!(matches!(route_of("/api/session"), Some(Route::Session)));
        assert!(matches!(
            route_of("/api/runs/20261024-0412-a7b3c"),
            Some(Route::RunStatus(_))
        ));
        assert!(route_of("/api/runs/").is_none());
        assert!(route_of("/api/runs/a/b").is_none());
        assert!(route_of("/api/other").is_none());
        assert!(route_of("/api").is_none());
        assert!(matches!(route_of("/"), Some(Route::Page)));
        assert!(matches!(route_of("/assets/app.js"), Some(Route::Page)));
    }
}
