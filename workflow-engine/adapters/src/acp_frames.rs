// SPDX-License-Identifier: Apache-2.0
//! Newline-delimited frames for the ACP client: one JSON message per line on the adapter's standard output.
//!
//! [`Frames`] cuts the bytes it is given into lines. A line over [`MAX_FRAME_BYTES`] is an error and nothing after it
//! is read, so one line is never held beyond that size. How many frames wait for the client is bounded by the caller.
//! The text of a line is not parsed here.

/// The longest frame the client reads, without its line break (4 MiB).
pub const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

/// Why a frame could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameError {
    /// The line is longer than [`MAX_FRAME_BYTES`].
    TooLong,
    /// The line is not UTF-8.
    NotUtf8,
}

/// Cuts a byte stream into frames, whatever the size of the reads that the bytes arrive in.
#[derive(Debug, Default)]
pub struct Frames {
    /// The start of a line that has not ended yet.
    pending: Vec<u8>,
    /// Set after a line that was too long: the stream has no known line boundary any more.
    stopped: bool,
}

impl Frames {
    pub fn new() -> Frames {
        Frames::default()
    }

    /// Adds the next bytes and returns the frames they complete, in order. A blank line is not a frame. After a
    /// [`FrameError::TooLong`] nothing more is returned.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<Result<String, FrameError>> {
        let mut frames = Vec::new();
        if self.stopped {
            return frames;
        }
        let mut rest = chunk;
        while let Some(end) = rest.iter().position(|b| *b == b'\n') {
            let (line, after) = rest.split_at(end);
            rest = &after[1..];
            if self.pending.len() + line.len() > MAX_FRAME_BYTES {
                return self.too_long(frames);
            }
            self.pending.extend_from_slice(line);
            if let Some(frame) = take_frame(std::mem::take(&mut self.pending)) {
                frames.push(frame);
            }
        }
        if self.pending.len() + rest.len() > MAX_FRAME_BYTES {
            return self.too_long(frames);
        }
        self.pending.extend_from_slice(rest);
        frames
    }

    /// The frame that the end of the stream completes: the last line when it has no line break.
    pub fn finish(&mut self) -> Option<Result<String, FrameError>> {
        if self.stopped {
            return None;
        }
        take_frame(std::mem::take(&mut self.pending))
    }

    fn too_long(
        &mut self,
        mut frames: Vec<Result<String, FrameError>>,
    ) -> Vec<Result<String, FrameError>> {
        self.stopped = true;
        self.pending = Vec::new();
        frames.push(Err(FrameError::TooLong));
        frames
    }
}

/// The frame in one line, without a carriage return before the line break. `None` for a blank line.
fn take_frame(mut line: Vec<u8>) -> Option<Result<String, FrameError>> {
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    if line.iter().all(u8::is_ascii_whitespace) {
        return None;
    }
    Some(String::from_utf8(line).map_err(|_| FrameError::NotUtf8))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(frames: Vec<Result<String, FrameError>>) -> Vec<String> {
        frames.into_iter().map(|f| f.unwrap()).collect()
    }

    #[test]
    fn a_frame_split_over_reads_is_one_frame() {
        let mut frames = Frames::new();
        assert!(frames.push(b"{\"a\":").is_empty());
        assert!(frames.push(b"1}").is_empty());
        assert_eq!(texts(frames.push(b"\n")), ["{\"a\":1}"]);
    }

    #[test]
    fn two_frames_in_one_read_are_two_frames_in_order() {
        let mut frames = Frames::new();
        assert_eq!(
            texts(frames.push(b"{\"a\":1}\n{\"b\":2}\n{\"c\"")),
            ["{\"a\":1}", "{\"b\":2}"]
        );
        assert_eq!(texts(frames.push(b":3}\n")), ["{\"c\":3}"]);
    }

    #[test]
    fn a_last_frame_with_no_line_break_comes_with_the_end_of_the_stream() {
        let mut frames = Frames::new();
        assert!(frames.push(b"{\"a\":1}").is_empty());
        assert_eq!(frames.finish(), Some(Ok("{\"a\":1}".to_string())));
        assert_eq!(frames.finish(), None);
    }

    #[test]
    fn blank_lines_and_a_carriage_return_are_not_part_of_a_frame() {
        let mut frames = Frames::new();
        assert_eq!(
            texts(frames.push(b"\n\r\n{\"a\":1}\r\n  \n")),
            ["{\"a\":1}"]
        );
        assert_eq!(frames.finish(), None);
    }

    #[test]
    fn a_line_over_the_limit_is_an_error_and_ends_the_reading() {
        let mut frames = Frames::new();
        let chunk = vec![b'a'; MAX_FRAME_BYTES];
        assert!(frames.push(&chunk).is_empty());
        assert_eq!(frames.push(b"b"), [Err(FrameError::TooLong)]);
        assert!(frames.push(b"\n{\"a\":1}\n").is_empty());
        assert_eq!(frames.finish(), None);
    }

    #[test]
    fn a_line_of_exactly_the_limit_is_read() {
        let mut frames = Frames::new();
        let mut chunk = vec![b'a'; MAX_FRAME_BYTES];
        chunk.push(b'\n');
        let got = frames.push(&chunk);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].as_ref().map(String::len), Ok(MAX_FRAME_BYTES));
    }

    #[test]
    fn a_complete_line_over_the_limit_in_one_read_is_an_error() {
        let mut frames = Frames::new();
        let mut chunk = vec![b'a'; MAX_FRAME_BYTES + 1];
        chunk.extend_from_slice(b"\n{\"a\":1}\n");
        assert_eq!(frames.push(&chunk), [Err(FrameError::TooLong)]);
    }

    #[test]
    fn a_line_that_is_not_utf8_is_an_error_for_that_frame_only() {
        let mut frames = Frames::new();
        let got = frames.push(b"\xff\xfe\n{\"a\":1}\n");
        assert_eq!(got[0], Err(FrameError::NotUtf8));
        assert_eq!(got[1], Ok("{\"a\":1}".to_string()));
    }
}
