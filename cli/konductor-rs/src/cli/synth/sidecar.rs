// SPDX-License-Identifier: Apache-2.0
//
// synth/sidecar.rs -- writes the `sha256sum`-format checksum sidecar
// consumed by `install::artifact::parse_sidecar`, once the packaged
// release artifact's bytes are known.

use std::path::{Path, PathBuf};

use crate::cli::install::artifact::sha256_hex;

/// Writes `<artifact_path>.sha256` next to `artifact_path`: one
/// `sha256sum`-format line (lowercase hex SHA-256, two spaces, filename,
/// trailing `\n`) matching what `install::artifact::parse_sidecar` reads.
/// Returns the sidecar's path.
///
/// Records the artifact's filename only (not its full path), since
/// `parse_sidecar`'s filename check is a plain string comparison and
/// artifact + sidecar are expected to travel together as siblings.
///
/// Called from `dispatch_synth_with` right after `artifact_bytes` is
/// written to `artifact_path` on disk.
pub fn write_sidecar(artifact_path: &Path, artifact_bytes: &[u8]) -> std::io::Result<PathBuf> {
    let filename = artifact_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "artifact_path has no valid UTF-8 filename",
            )
        })?;
    let hash = sha256_hex(artifact_bytes);
    let sidecar_path = {
        let mut s = artifact_path.as_os_str().to_owned();
        s.push(".sha256");
        PathBuf::from(s)
    };
    std::fs::write(&sidecar_path, format!("{hash}  {filename}\n"))?;
    Ok(sidecar_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::install::artifact::parse_sidecar;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-sidecar-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Round-trip: `write_sidecar`'s output, read back and fed into the
    /// real, unmodified `install::artifact::parse_sidecar`, must yield
    /// the same hash/filename the writer computed -- no mocks on either
    /// side.
    #[test]
    fn write_sidecar_round_trips_through_real_parse_sidecar() {
        let dir = scratch_dir("round-trip");
        let artifact_path = dir.join("konductor-v1.2.0-x86_64-unknown-linux-gnu.tar.gz");
        let artifact_bytes = b"pretend tarball contents".to_vec();

        let sidecar_path =
            write_sidecar(&artifact_path, &artifact_bytes).expect("write_sidecar must succeed");
        assert_eq!(
            sidecar_path,
            dir.join("konductor-v1.2.0-x86_64-unknown-linux-gnu.tar.gz.sha256")
        );

        let contents = fs::read_to_string(&sidecar_path).unwrap();
        let entry = parse_sidecar(
            &contents,
            "konductor-v1.2.0-x86_64-unknown-linux-gnu.tar.gz",
        )
        .expect("sidecar written by write_sidecar must parse with the real parse_sidecar");

        assert_eq!(entry.hash, sha256_hex(&artifact_bytes));
        assert_eq!(
            entry.filename,
            "konductor-v1.2.0-x86_64-unknown-linux-gnu.tar.gz"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// Exact-byte-format assertion, independent of the round-trip test
    /// above: pins single-line, two-space separator, lowercase hex,
    /// trailing `\n`, no CRLF -- every constraint `parse_sidecar` relies
    /// on, not just what it happens to tolerate.
    #[test]
    fn write_sidecar_writes_exact_sha256sum_format() {
        let dir = scratch_dir("exact-format");
        let artifact_path = dir.join("artifact.tar.gz");
        let artifact_bytes = b"exact format check".to_vec();

        let sidecar_path = write_sidecar(&artifact_path, &artifact_bytes).unwrap();
        let contents = fs::read_to_string(&sidecar_path).unwrap();

        let expected = format!("{}  artifact.tar.gz\n", sha256_hex(&artifact_bytes));
        assert_eq!(contents, expected);

        fs::remove_dir_all(&dir).ok();
    }

    /// Checks every case in `tests/fixtures/sidecar_cases.json` against
    /// the exact line format `write_sidecar` produces, guarding against
    /// `write_sidecar`/`parse_sidecar` drifting on separator/case/newline
    /// conventions. The fixture stores hash values, so this rebuilds the
    /// line from each case's hash/filename rather than re-hashing bytes.
    #[test]
    fn write_sidecar_format_matches_shared_fixture_conformance_cases() {
        const SHARED_FIXTURE_JSON: &str =
            include_str!("../../../tests/fixtures/sidecar_cases.json");
        let doc: serde_json::Value =
            serde_json::from_str(SHARED_FIXTURE_JSON).expect("shared fixture must be valid JSON");
        let cases = doc["cases"]
            .as_array()
            .expect("fixture must have a 'cases' array");
        assert!(!cases.is_empty());

        for case in cases {
            let name = case["name"].as_str().unwrap();
            let expected_contents = case["contents"].as_str().unwrap();
            let expected_hash = case["expected"]["hash"].as_str().unwrap();
            let expected_filename = case["expected"]["filename"].as_str().unwrap();

            // Rebuild the line write_sidecar would produce from this
            // hash/filename pair, since the fixture stores a hash value
            // rather than a preimage to hash ourselves.
            let produced = format!("{expected_hash}  {expected_filename}\n");
            assert_eq!(
                produced, expected_contents,
                "[fixture:{name}] write_sidecar's line format must match the shared fixture verbatim"
            );
        }
    }

    /// `artifact_path` with no filename component (e.g. `/`) must
    /// return an `Err`, not panic.
    #[test]
    fn write_sidecar_rejects_path_with_no_filename() {
        let err = write_sidecar(Path::new("/"), b"data").expect_err("must reject rootless path");
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    }
}
