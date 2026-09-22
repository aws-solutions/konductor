// SPDX-License-Identifier: Apache-2.0
//
// Loopback HTTPS sink standing in for the real telemetry endpoint in
// tests, shared by `cli/konductor-rs` and `mcp/lib/skill-lookup-core`.
//
// HTTPS, not plain HTTP: the production allowlist requires an
// endpoint to start with `https://`. Both crates ship a
// `KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT` debug escape hatch that
// already accepts a loopback endpoint without code changes; this sink
// only has to speak real TLS to be reachable through that seam.
//
// Certs are generated in-process via `rcgen` (ECDSA P-256, using
// `ring`, matching the `rustls` backend below) rather than shelling
// out to `openssl`, keeping this crate's build self-contained with no
// native `openssl` dependency or subprocess.
//
// TLS termination uses `rustls` with the `ring` backend, matching
// `cli/konductor-rs`'s own dependency via `ureq`.
//
// `TelemetrySink::env_vars()` returns the three env vars
// (`KONDUCTOR_METRICS_ENDPOINT`, `KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT`,
// `CURL_CA_BUNDLE`) a caller sets to reach this sink from an in-process
// unit test or a spawned binary.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A running loopback HTTPS sink. Dropping this stops accepting new
/// connections and removes the temp directory holding the generated
/// certificate. The private key is never written to disk.
pub struct TelemetrySink {
    local_addr: std::net::SocketAddr,
    ca_bundle_path: PathBuf,
    received: Arc<Mutex<Vec<String>>>,
    _cert_dir: tempfile_lite::TempDir,
    _accept_thread: std::thread::JoinHandle<()>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
}

/// One environment variable this sink's callers must set for a real
/// send to reach it and be trusted.
#[derive(Debug, Clone)]
pub struct EnvVar {
    pub name: &'static str,
    pub value: String,
}

impl TelemetrySink {
    /// Generates a throwaway cert+key via `rcgen`, writes the cert's
    /// PEM to a temp file (for `CURL_CA_BUNDLE`), keeps the key in
    /// memory, binds a loopback listener on an ephemeral port, and
    /// spawns a background accept thread.
    ///
    /// # Panics
    /// Panics if certificate generation fails or the loopback listener
    /// cannot be bound.
    pub fn start() -> Self {
        let certified_key = generate_self_signed_cert();

        let cert_dir = tempfile_lite::TempDir::new("konductor-telemetry-sink");
        let cert_path = cert_dir.path().join("cert.pem");
        std::fs::write(&cert_path, certified_key.cert.pem())
            .unwrap_or_else(|e| panic!("failed to write CA cert PEM to {cert_path:?}: {e}"));

        let listener =
            TcpListener::bind("127.0.0.1:0").expect("failed to bind loopback TCP listener");
        let local_addr = listener
            .local_addr()
            .expect("listener must have a local addr");
        listener
            .set_nonblocking(false)
            .expect("failed to set listener blocking mode");

        let server_config = build_server_config(&certified_key);
        let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let thread_received = received.clone();
        let thread_shutdown = shutdown.clone();
        let accept_thread = std::thread::spawn(move || {
            listener
                .set_nonblocking(true)
                .expect("failed to set listener non-blocking for the shutdown-poll loop");
            loop {
                if thread_shutdown.load(std::sync::atomic::Ordering::Relaxed) {
                    return;
                }
                match listener.accept() {
                    Ok((stream, _addr)) => {
                        stream
                            .set_nonblocking(false)
                            .expect("failed to set accepted stream blocking mode");
                        handle_connection(stream, server_config.clone(), &thread_received);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                }
            }
        });

        TelemetrySink {
            local_addr,
            ca_bundle_path: cert_path,
            received,
            _cert_dir: cert_dir,
            _accept_thread: accept_thread,
            shutdown,
        }
    }

    /// The `https://127.0.0.1:<port>/generic` URL this sink listens
    /// on -- pass as `KONDUCTOR_METRICS_ENDPOINT`.
    pub fn endpoint_url(&self) -> String {
        format!("https://127.0.0.1:{}/generic", self.local_addr.port())
    }

    /// Path to the throwaway CA certificate curl must trust -- pass
    /// as `CURL_CA_BUNDLE`.
    pub fn ca_bundle_path(&self) -> &Path {
        &self.ca_bundle_path
    }

    /// The environment variables a caller must apply for a real
    /// telemetry send to reach this sink and be trusted.
    pub fn env_vars(&self) -> Vec<EnvVar> {
        vec![
            EnvVar {
                name: "KONDUCTOR_METRICS_ENDPOINT",
                value: self.endpoint_url(),
            },
            EnvVar {
                name: "KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT",
                value: "1".to_string(),
            },
            EnvVar {
                name: "CURL_CA_BUNDLE",
                value: self.ca_bundle_path.display().to_string(),
            },
        ]
    }

    /// Every request body received so far, in arrival order.
    pub fn received_bodies(&self) -> Vec<String> {
        self.received
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Blocks (bounded by `timeout`) until at least `count` bodies
    /// have been received. The send this sink stands in for is
    /// fire-and-forget, so a test must poll rather than assume it
    /// has already arrived. Returns `false` on timeout.
    pub fn wait_for_bodies(&self, count: usize, timeout: Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if self.received_bodies().len() >= count {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for TelemetrySink {
    fn drop(&mut self) {
        self.shutdown
            .store(true, std::sync::atomic::Ordering::Relaxed);
        // Not joined: the accept thread polls shutdown every 10ms and
        // exits promptly on its own.
    }
}

/// Handles one accepted TCP connection: TLS handshake, HTTP/1.1
/// request parse, records the body, and writes back a minimal `200
/// OK` response.
fn handle_connection(
    mut stream: TcpStream,
    config: Arc<rustls::ServerConfig>,
    received: &Arc<Mutex<Vec<String>>>,
) {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    let mut conn = match rustls::ServerConnection::new(config) {
        Ok(c) => c,
        Err(_) => return,
    };
    let mut tls_stream = rustls::Stream::new(&mut conn, &mut stream);

    let Some(body) = read_http_request_body(&mut tls_stream) else {
        return;
    };

    let response = b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let _ = tls_stream.write_all(response);
    let _ = tls_stream.flush();

    received
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .push(body);
}

/// Reads a complete HTTP/1.1 request off `stream` and returns the
/// body. Returns `None` on a malformed request rather than panicking,
/// matching production telemetry's own fire-and-forget posture.
fn read_http_request_body<S: Read + Write>(stream: &mut S) -> Option<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end;
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
        if buf.len() > 64 * 1024 {
            return None;
        }
    }

    let header_text = String::from_utf8_lossy(&buf[..header_end]);
    let content_length: usize = header_text
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);
    Some(String::from_utf8_lossy(&body).into_owned())
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Generates a throwaway self-signed cert+key valid for `127.0.0.1`
/// (via a `subjectAltName` entry, which curl's hostname verification
/// requires for an IP-literal target), entirely in-process.
///
/// # Panics
/// Panics if certificate generation fails.
fn generate_self_signed_cert() -> rcgen::CertifiedKey {
    rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_string()])
        .expect("failed to generate a throwaway self-signed certificate for this sink")
}

/// Builds a `rustls::ServerConfig` directly from the DER bytes `rcgen`
/// generated -- no PEM round-trip, no client-auth, no ALPN beyond
/// rustls's defaults.
fn build_server_config(certified_key: &rcgen::CertifiedKey) -> Arc<rustls::ServerConfig> {
    let cert = certified_key.cert.der().clone();
    let key_der = certified_key.key_pair.serialize_der();
    let key = rustls::pki_types::PrivateKeyDer::try_from(key_der)
        .expect("rcgen-generated key must parse as a valid PKCS#8 private key");

    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .expect("failed to build rustls ServerConfig from the generated cert/key pair");
    Arc::new(config)
}

/// Dependency-free temp-directory RAII helper: a fresh, process-unique
/// directory under `std::env::temp_dir()`, removed on drop.
mod tempfile_lite {
    use std::path::{Path, PathBuf};

    pub struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        pub fn new(prefix: &str) -> Self {
            static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("{prefix}-{}-{nanos}-{count}", std::process::id()));
            std::fs::create_dir_all(&path)
                .unwrap_or_else(|e| panic!("failed to create temp dir {}: {e}", path.display()));
            TempDir { path }
        }

        pub fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real `curl` invocation shaped like the transport script's
    /// own reaches this sink, and the sink observes the exact body.
    #[test]
    fn curl_shaped_like_the_transport_script_reaches_this_sink_and_body_is_captured() {
        let sink = TelemetrySink::start();
        let body = r#"{"Solution":"SO0370","UUID":"test"}"#;

        let mut command = std::process::Command::new("curl");
        command.args([
            "--max-time",
            "3",
            "--silent",
            "--show-error",
            "--request",
            "POST",
            "--header",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ]);
        command.arg(sink.endpoint_url());
        for var in sink.env_vars() {
            command.env(var.name, &var.value);
        }
        command.stdin(std::process::Stdio::piped());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        let mut child = command.spawn().expect("failed to spawn curl");
        {
            let mut stdin = child.stdin.take().expect("curl stdin must be piped");
            stdin
                .write_all(body.as_bytes())
                .expect("failed to write body to curl stdin");
        }
        let output = child.wait_with_output().expect("failed to wait for curl");

        assert!(
            output.status.success(),
            "curl must succeed against this sink; stderr={}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            sink.wait_for_bodies(1, Duration::from_secs(3)),
            "the sink must observe exactly the body curl sent"
        );
        assert_eq!(sink.received_bodies(), vec![body.to_string()]);
    }

    /// `env_vars()` must name exactly the three variables a real send
    /// needs to reach this sink and trust its certificate.
    #[test]
    fn env_vars_names_exactly_the_three_required_variables() {
        let sink = TelemetrySink::start();
        let names: Vec<&str> = sink.env_vars().iter().map(|v| v.name).collect();
        assert_eq!(
            names,
            vec![
                "KONDUCTOR_METRICS_ENDPOINT",
                "KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT",
                "CURL_CA_BUNDLE",
            ]
        );
    }

    /// `wait_for_bodies` must time out (return `false`), not hang, when
    /// nothing is ever sent.
    #[test]
    fn wait_for_bodies_times_out_when_nothing_is_sent() {
        let sink = TelemetrySink::start();
        let start = std::time::Instant::now();
        let arrived = sink.wait_for_bodies(1, Duration::from_millis(200));
        assert!(!arrived);
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "wait_for_bodies must return promptly at its own bound, not hang"
        );
    }
}
