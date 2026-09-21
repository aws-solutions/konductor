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
}
