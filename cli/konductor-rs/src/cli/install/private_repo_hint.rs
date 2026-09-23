// SPDX-License-Identifier: Apache-2.0
//
// install/private_repo_hint.rs — single shared implementation of the
// self-diagnosis hint appended to a 401/403 GitHub API error message.
// Previously duplicated verbatim in `install::github` and
// `install::github_branch`; both now call `private_repo_hint` here
// instead of keeping their own copy.
//
// The hint is state-aware, not just keyed on HTTP status: it takes a
// `TokenState` describing what the caller actually did with
// `--use-github-token`/`GITHUB_TOKEN` for the request that produced
// the error, and tailors its wording so it never repeats a suggestion
// the caller has already followed. `TokenState` carries no token
// value, only presence/absence/emptiness -- see its own doc comment
// for why that's a hard security constraint, not a style choice.

/// What the caller actually did with `--use-github-token`/
/// `GITHUB_TOKEN` for the specific request that produced a 401/403.
/// Carries no token value anywhere, by construction -- only ever
/// built from a `bool` (was `--use-github-token` passed) and an
/// `Option<&str>`/`Option<String>`'s `is_some()`/emptiness (was a
/// non-empty token actually available to send), never from the
/// token's own bytes. This is a hard constraint: the token must never
/// surface in any user-facing string, error, log, or debug output, and
/// modeling this enum without a string payload makes it structurally
/// impossible to plumb the value through this path by accident.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TokenState {
    /// `--use-github-token` was not passed at all. `GITHUB_TOKEN` was
    /// never read for this request, opted-in or not.
    NotOptedIn,
    /// `--use-github-token` was passed, but `GITHUB_TOKEN` was unset
    /// or empty in the environment -- no token was available to send.
    OptedInEmptyOrUnset,
    /// `--use-github-token` was passed AND a non-empty `GITHUB_TOKEN`
    /// was actually read and attached to the request that got this
    /// 401/403 back.
    OptedInSent,
}

impl TokenState {
    /// Derives the state from the two pieces of information every
    /// call site already has in hand: whether `--use-github-token`
    /// was passed, and the `Option<String>` `github_token_from_env`
    /// returned for this request (already empty/unset-filtered by
    /// that function, so `is_some()` here means "non-empty and was
    /// sent"). Takes the token option by reference so no ownership
    /// changes are forced on callers threading it through further
    /// (e.g. into `apply_github_token`) -- and, since only `is_some()`
    /// is read, never touches the token's own bytes.
    pub(crate) fn from_flag_and_token(use_github_token: bool, token: &Option<String>) -> Self {
        if !use_github_token {
            TokenState::NotOptedIn
        } else if token.is_some() {
            TokenState::OptedInSent
        } else {
            TokenState::OptedInEmptyOrUnset
        }
    }
}

/// Self-diagnosis suffix appended to an HTTP-status error message.
/// Returns `""` for any status other than 401/403 -- an unrelated
/// failure (404, 500, etc) stays exactly as plain as it always has.
///
/// For 401/403, the wording differs by `token_state` so the hint never
/// repeats a suggestion the caller already followed:
/// - `NotOptedIn`: suggests setting `GITHUB_TOKEN` and passing
///   `--use-github-token` (the original suggestion, reworded to name
///   the env var explicitly instead of just the flag).
/// - `OptedInEmptyOrUnset`: reports that the flag was passed but no
///   token was actually available -- the case the flag alone can't
///   fix and repeating "pass --use-github-token" would be misleading
///   noise for, since it was already passed.
/// - `OptedInSent`: reports that a token WAS sent and got rejected --
///   the silent-loop case: repeating "pass --use-github-token" here
///   would tell the caller to redo something they already did. The
///   wording itself further splits by status: 401 means the
///   credential itself was rejected (bad/expired/wrong-scope token),
///   while 403 with a token already attached is commonly a rate limit
///   rather than an auth problem (see `GithubBranchFetchError::Http`'s
///   own doc comment) -- pointing a rate-limited caller at "check its
///   scope/access" would send them to re-issue a PAT that was never
///   the problem.
pub(crate) fn private_repo_hint(status: u16, token_state: TokenState) -> &'static str {
    if status != 401 && status != 403 {
        return "";
    }
    match token_state {
        TokenState::NotOptedIn => {
            " -- if this repository is private, set the GITHUB_TOKEN environment \
             variable and pass --use-github-token"
        }
        TokenState::OptedInEmptyOrUnset => {
            " -- --use-github-token was passed but GITHUB_TOKEN is not set (or is \
             empty) in the environment"
        }
        TokenState::OptedInSent if status == 401 => {
            " -- the provided GITHUB_TOKEN was rejected -- check that it has the \
             required scope/access to this repository"
        }
        TokenState::OptedInSent => {
            " -- the provided GITHUB_TOKEN may have been rejected, or this may be a \
             rate limit rather than an authorization problem"
        }
    }
}

/// Self-diagnosis suffix for a resource-fetch call whose 404 can mask
/// an unauthenticated private-repo request (`GithubFetchError::DownloadHttp`'s
/// release-asset download, and `GithubBranchFetchError::MissingArtifact`/
/// `MissingSidecar`'s branch-`dist/` Contents API fetch), where 404
/// needs the same hint 401/403 already get. Delegates to
/// `private_repo_hint` unchanged for every other status -- this only
/// widens the gate for these 404-masking call sites, never touches
/// `private_repo_hint`'s own 401/403 wording or its behavior for the
/// metadata call, which stays exactly as narrow as before.
///
/// Both call sites 404 unauthenticated against a private repo's
/// resource, BY DESIGN: GitHub returns 404 rather than 401/403 on both
/// its release-asset download endpoint and its Contents API,
/// specifically so an unauthorized caller can't distinguish "private
/// repo" from "resource doesn't exist." The wording below names
/// neither endpoint, so the identical text reads correctly for a
/// release asset's download URL and a branch's `dist/` file alike.
/// A caller with no token attached at
/// all can never legitimately rule out "this 404 is the private-repo
/// mask" -- so `NotOptedIn` and `OptedInEmptyOrUnset` (no token was
/// actually sent either way) both still deserve the suggestion here,
/// same as they already get for 401/403.
///
/// `OptedInSent` is deliberately excluded from this widened 404 gate,
/// even though it still gets the 401/403 hint above: once a real,
/// non-empty token was actually attached to the request and STILL got
/// a 404 back, the far more likely explanation is a genuinely missing
/// asset (a filename mismatch, an unpublished platform build) rather
/// than an authorization gate a real token would have already
/// unlocked. Widening this case too would repeat a suggestion the
/// caller already followed for a failure a token can't fix --
/// precisely the silent-loop noise `private_repo_hint`'s own
/// `OptedInSent` wording exists to avoid for 401/403, applied the same
/// way here.
pub(crate) fn download_private_repo_hint(status: u16, token_state: TokenState) -> &'static str {
    if status == 404 {
        return match token_state {
            TokenState::NotOptedIn => {
                " -- this may be because the repository is private -- if so, set the \
                 GITHUB_TOKEN environment variable and pass --use-github-token"
            }
            TokenState::OptedInEmptyOrUnset => {
                " -- --use-github-token was passed but GITHUB_TOKEN is not set (or is \
                 empty) in the environment -- this may be because the repository is \
                 private"
            }
            TokenState::OptedInSent => "",
        };
    }
    private_repo_hint(status, token_state)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── TokenState::from_flag_and_token ─────────────────────────────

    #[test]
    fn from_flag_and_token_not_opted_in_when_flag_false_regardless_of_token() {
        assert_eq!(
            TokenState::from_flag_and_token(false, &None),
            TokenState::NotOptedIn
        );
        assert_eq!(
            TokenState::from_flag_and_token(false, &Some("irrelevant".to_string())),
            TokenState::NotOptedIn
        );
    }

    #[test]
    fn from_flag_and_token_opted_in_empty_or_unset_when_flag_true_and_token_none() {
        assert_eq!(
            TokenState::from_flag_and_token(true, &None),
            TokenState::OptedInEmptyOrUnset
        );
    }

    #[test]
    fn from_flag_and_token_opted_in_sent_when_flag_true_and_token_some() {
        assert_eq!(
            TokenState::from_flag_and_token(true, &Some("some-token".to_string())),
            TokenState::OptedInSent
        );
    }

    // ── private_repo_hint: status gating ────────────────────────────

    #[test]
    fn non_401_403_statuses_never_get_a_hint_for_any_token_state() {
        for status in [404u16, 429u16, 500u16, 503u16] {
            for state in [
                TokenState::NotOptedIn,
                TokenState::OptedInEmptyOrUnset,
                TokenState::OptedInSent,
            ] {
                assert_eq!(
                    private_repo_hint(status, state),
                    "",
                    "status {status} with state {state:?} must not carry a hint"
                );
            }
        }
    }

    // ── private_repo_hint: NotOptedIn wording ───────────────────────

    #[test]
    fn not_opted_in_hint_names_both_the_env_var_and_the_flag() {
        for status in [401u16, 403u16] {
            let message = private_repo_hint(status, TokenState::NotOptedIn);
            assert!(
                message.contains("GITHUB_TOKEN"),
                "status {status}: must name GITHUB_TOKEN, got: {message:?}"
            );
            assert!(
                message.contains("--use-github-token"),
                "status {status}: must name --use-github-token, got: {message:?}"
            );
        }
    }

    // ── private_repo_hint: OptedInEmptyOrUnset wording ──────────────

    #[test]
    fn opted_in_empty_or_unset_hint_reports_the_empty_unset_state_explicitly() {
        for status in [401u16, 403u16] {
            let message = private_repo_hint(status, TokenState::OptedInEmptyOrUnset);
            assert!(
                message.contains("GITHUB_TOKEN"),
                "status {status}: must name GITHUB_TOKEN, got: {message:?}"
            );
            assert!(
                message.contains("--use-github-token"),
                "status {status}: must name --use-github-token, got: {message:?}"
            );
            assert!(
                message.contains("not set") || message.contains("empty"),
                "status {status}: must explicitly describe the empty/unset state, got: {message:?}"
            );
        }
    }

    // ── private_repo_hint: OptedInSent wording (silent-loop fix) ────

    #[test]
    fn opted_in_sent_hint_does_not_repeat_the_pass_the_flag_suggestion() {
        for status in [401u16, 403u16] {
            let message = private_repo_hint(status, TokenState::OptedInSent);
            assert!(
                !message.contains("--use-github-token"),
                "status {status}: must not repeat the already-followed --use-github-token \
                 suggestion (this is the silent-loop bug), got: {message:?}"
            );
            assert!(
                message.contains("GITHUB_TOKEN"),
                "status {status}: must still name GITHUB_TOKEN as the rejected credential, got: {message:?}"
            );
        }
    }

    #[test]
    fn opted_in_sent_401_points_at_scope_access_403_mentions_rate_limit() {
        let message_401 = private_repo_hint(401, TokenState::OptedInSent);
        assert!(
            message_401.contains("scope") || message_401.contains("access"),
            "401 with a token sent means the credential itself was rejected, got: {message_401:?}"
        );
        assert!(
            !message_401.contains("rate limit"),
            "401 is never a rate limit, got: {message_401:?}"
        );

        let message_403 = private_repo_hint(403, TokenState::OptedInSent);
        assert!(
            message_403.contains("rate limit"),
            "403 with a token sent may just be a rate limit, not necessarily a scope/access \
             problem, got: {message_403:?}"
        );
    }

    // ── download_private_repo_hint: the download-404 gap fix ────────

    /// The exact case this fix closes: a 404 on the asset-DOWNLOAD
    /// call, with `--use-github-token` never passed, must now name
    /// both `GITHUB_TOKEN` and `--use-github-token` -- unlike
    /// `private_repo_hint` itself, which stays silent on 404 (that
    /// function is unchanged and still used verbatim by the metadata
    /// call, where a 404 is genuinely ambiguous between "no release"
    /// and "private repo").
    #[test]
    fn download_hint_404_not_opted_in_names_the_env_var_and_the_flag() {
        let message = download_private_repo_hint(404, TokenState::NotOptedIn);
        assert!(
            message.contains("GITHUB_TOKEN"),
            "must name GITHUB_TOKEN, got: {message:?}"
        );
        assert!(
            message.contains("--use-github-token"),
            "must hint at --use-github-token, got: {message:?}"
        );
    }

    /// Same download-404 widening for `OptedInEmptyOrUnset`: the flag
    /// was passed but no token was actually available to send, so the
    /// 404 is still consistent with an unauthenticated private-repo
    /// mask -- must report the empty/unset state, mirroring
    /// `private_repo_hint`'s own 401/403 wording for this state.
    #[test]
    fn download_hint_404_opted_in_empty_or_unset_reports_the_empty_state() {
        let message = download_private_repo_hint(404, TokenState::OptedInEmptyOrUnset);
        assert!(
            message.contains("GITHUB_TOKEN"),
            "must name GITHUB_TOKEN, got: {message:?}"
        );
        assert!(
            message.contains("not set") || message.contains("empty"),
            "must describe the empty/unset state, got: {message:?}"
        );
    }

    /// `OptedInSent` must NOT get a widened 404 hint: a real,
    /// non-empty token was actually attached and still got a 404,
    /// which is far more likely a genuinely missing asset than an
    /// auth gate a real token would already have unlocked. Repeating
    /// the suggestion here would be the same silent-loop noise
    /// `private_repo_hint` already avoids for 401/403's `OptedInSent`
    /// case.
    #[test]
    fn download_hint_404_opted_in_sent_omits_the_hint() {
        assert_eq!(download_private_repo_hint(404, TokenState::OptedInSent), "");
    }

    /// Every status other than 404/401/403 must still stay silent for
    /// every token state -- the widened gate is 404-specific, not a
    /// blanket "any status" change.
    #[test]
    fn download_hint_other_statuses_still_omit_the_hint_for_every_token_state() {
        for status in [429u16, 500u16, 503u16] {
            for state in [
                TokenState::NotOptedIn,
                TokenState::OptedInEmptyOrUnset,
                TokenState::OptedInSent,
            ] {
                assert_eq!(
                    download_private_repo_hint(status, state),
                    "",
                    "status {status} with state {state:?} must not carry a hint"
                );
            }
        }
    }

    /// For 401/403, `download_private_repo_hint` must delegate to
    /// `private_repo_hint` unchanged -- proving this function only
    /// widens the 404 case and never re-implements or diverges from
    /// the existing 401/403 wording.
    #[test]
    fn download_hint_401_and_403_delegate_unchanged_to_private_repo_hint() {
        for status in [401u16, 403u16] {
            for state in [
                TokenState::NotOptedIn,
                TokenState::OptedInEmptyOrUnset,
                TokenState::OptedInSent,
            ] {
                assert_eq!(
                    download_private_repo_hint(status, state),
                    private_repo_hint(status, state),
                    "status {status} with state {state:?} must match private_repo_hint exactly"
                );
            }
        }
    }

    /// `private_repo_hint` itself -- the metadata call's own hint
    /// function -- must remain untouched: still silent on 404
    /// regardless of token state. This is the deliberate boundary:
    /// the metadata call's 404 stays ambiguous (no release published
    /// vs. private repo) and fallback-eligible, so widening its hint
    /// would contradict that existing design rather than fix a bug.
    #[test]
    fn private_repo_hint_itself_still_omits_404_for_every_token_state() {
        for state in [
            TokenState::NotOptedIn,
            TokenState::OptedInEmptyOrUnset,
            TokenState::OptedInSent,
        ] {
            assert_eq!(private_repo_hint(404, state), "");
        }
    }
}
