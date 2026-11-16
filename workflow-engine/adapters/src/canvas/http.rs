// SPDX-License-Identifier: Apache-2.0
//! A small HTTP/1.1 reader and writer for the canvas server. It handles what the contract needs and nothing else:
//! one request on a connection, a body that has a `Content-Length`, and a response that closes the connection.
//!
//! The contract is silent on the size of a request line and of the headers, so they are capped here. A request that
//! breaks a cap, or that this reader does not understand, is refused with `bad_request` and never read further.

use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::{Duration, Instant};

/// The longest request line, in bytes.
pub const MAX_REQUEST_LINE: usize = 8 * 1024;
/// The longest header block, request line included, in bytes.
pub const MAX_HEAD_BYTES: usize = 32 * 1024;
/// The most header lines.
pub const MAX_HEADERS: usize = 64;
/// The largest request body (the contract's 1 MiB).
pub const MAX_BODY_BYTES: usize = 1_048_576;
/// How much of a body that is too large is read and thrown away, so that the client can read its answer.
pub const MAX_DRAIN_BYTES: usize = 16 * MAX_BODY_BYTES;
/// How long one request may take to arrive, from the first byte the server waits for to the last.
pub const READ_TIMEOUT: Duration = Duration::from_secs(15);
/// How long a connection may stay silent before its first byte, so that idle sockets do not hold the connection cap.
pub const FIRST_BYTE_TIMEOUT: Duration = Duration::from_secs(5);

/// Why a request could not be read.
#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    /// Malformed, over a cap, or a feature this reader does not take (such as a chunked body).
    Bad,
    /// The peer was too slow, or went away.
    Gone,
}

/// A request line and headers. Header names are lower case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
    /// Bytes already read that belong to the body.
    pub surplus: Vec<u8>,
}

impl Head {
    /// The value of a header that appears once. `Err` when it appears more than once.
    pub fn header(&self, name: &str) -> Result<Option<&str>, ()> {
        let mut found = self.headers.iter().filter(|(n, _)| n == name);
        let first = found.next().map(|(_, v)| v.as_str());
        if found.next().is_some() {
            return Err(());
        }
        Ok(first)
    }

    /// The declared body length: 0 without a `Content-Length`. A `Transfer-Encoding` or a length that is not a plain
    /// number, or that is given twice, is `Err`.
    pub fn content_length(&self) -> Result<usize, ReadError> {
        if self.headers.iter().any(|(n, _)| n == "transfer-encoding") {
            return Err(ReadError::Bad);
        }
        match self.header("content-length").map_err(|()| ReadError::Bad)? {
            None => Ok(0),
            Some(text) if !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()) => {
                // A value too long for a number is far over the cap, and the caller refuses it as too large.
                Ok(text.parse().unwrap_or(usize::MAX))
            }
            Some(_) => Err(ReadError::Bad),
        }
    }
}

/// Reads from `stream` until `deadline`.
fn read_some(
    stream: &mut TcpStream,
    buf: &mut [u8],
    deadline: Instant,
) -> Result<usize, ReadError> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(ReadError::Gone);
    }
    stream
        .set_read_timeout(Some(left))
        .map_err(|_| ReadError::Gone)?;
    match stream.read(buf) {
        Ok(0) => Err(ReadError::Gone),
        Ok(n) => Ok(n),
        Err(e) if e.kind() == io::ErrorKind::Interrupted => Ok(0),
        Err(_) => Err(ReadError::Gone),
    }
}

fn is_token(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

/// Reads the request line and the headers.
pub fn read_head(stream: &mut TcpStream, deadline: Instant) -> Result<Head, ReadError> {
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 4096];
    let end = loop {
        if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break at;
        }
        // The request line must end within its own cap.
        let first_line = buf.iter().position(|&b| b == b'\n').unwrap_or(buf.len());
        if first_line > MAX_REQUEST_LINE || buf.len() > MAX_HEAD_BYTES {
            return Err(ReadError::Bad);
        }
        let until = if buf.is_empty() {
            deadline.min(Instant::now() + FIRST_BYTE_TIMEOUT)
        } else {
            deadline
        };
        let n = read_some(stream, &mut chunk, until)?;
        buf.extend_from_slice(&chunk[..n]);
    };
    if end + 4 > MAX_HEAD_BYTES {
        return Err(ReadError::Bad);
    }
    let surplus = buf[end + 4..].to_vec();
    let text = std::str::from_utf8(&buf[..end]).map_err(|_| ReadError::Bad)?;
    let mut lines = text.split("\r\n");
    let line = lines.next().ok_or(ReadError::Bad)?;
    if line.len() > MAX_REQUEST_LINE {
        return Err(ReadError::Bad);
    }
    let mut parts = line.split(' ');
    let (method, target, version) = (parts.next(), parts.next(), parts.next());
    let (Some(method), Some(target), Some("HTTP/1.1"), None) =
        (method, target, version, parts.next())
    else {
        return Err(ReadError::Bad);
    };
    if !is_token(method) || target.is_empty() || target.bytes().any(|b| b <= b' ' || b == 0x7f) {
        return Err(ReadError::Bad);
    }
    let mut headers = Vec::new();
    for line in lines {
        if headers.len() >= MAX_HEADERS {
            return Err(ReadError::Bad);
        }
        // A folded line starts with white space, and a header with no colon is not one.
        let Some((name, value)) = line.split_once(':') else {
            return Err(ReadError::Bad);
        };
        if !is_token(name) || value.bytes().any(|b| (b < b' ' && b != b'\t') || b == 0x7f) {
            return Err(ReadError::Bad);
        }
        headers.push((
            name.to_ascii_lowercase(),
            value.trim_matches([' ', '\t']).to_string(),
        ));
    }
    Ok(Head {
        method: method.to_string(),
        target: target.to_string(),
        headers,
        surplus,
    })
}

/// Reads a body of `length` bytes, of which `head.surplus` may already be there.
pub fn read_body(
    stream: &mut TcpStream,
    head: &Head,
    length: usize,
    deadline: Instant,
) -> Result<Vec<u8>, ReadError> {
    let mut body = head.surplus.clone();
    if body.len() > length {
        // A second request pipelined behind this one is not served.
        body.truncate(length);
    }
    let mut chunk = [0u8; 16 * 1024];
    while body.len() < length {
        let want = (length - body.len()).min(chunk.len());
        let n = read_some(stream, &mut chunk[..want], deadline)?;
        body.extend_from_slice(&chunk[..n]);
    }
    Ok(body)
}

/// One response. `body` is sent as it is.
pub struct Response {
    pub status: u16,
    pub content_type: &'static str,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        413 => "Content Too Large",
        422 => "Unprocessable Content",
        _ => "Internal Server Error",
    }
}

/// Writes the response and ends the connection. After the answer the rest of what the client sends, up to a cap, is
/// read and dropped: closing a socket with unread data resets the connection, and the client could lose the answer.
pub fn respond(stream: &mut TcpStream, response: &Response, drain: bool, send_body: bool) {
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        reason(response.status),
        response.content_type,
        response.body.len()
    );
    for (name, value) in &response.headers {
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    let sent = stream
        .write_all(head.as_bytes())
        .and_then(|()| {
            // The answer to a `HEAD` has the headers of the `GET` and no body.
            if send_body {
                stream.write_all(&response.body)
            } else {
                Ok(())
            }
        })
        .and_then(|()| stream.flush());
    if sent.is_err() {
        return;
    }
    let _ = stream.shutdown(Shutdown::Write);
    if drain {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut chunk = [0u8; 16 * 1024];
        let mut total = 0;
        while total < MAX_DRAIN_BYTES {
            match read_some(stream, &mut chunk, deadline) {
                Ok(n) => total += n,
                Err(_) => break,
            }
        }
    }
}
