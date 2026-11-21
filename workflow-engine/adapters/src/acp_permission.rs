// SPDX-License-Identifier: Apache-2.0
//! The answer to a `session/request_permission` request of an ACP adapter.
//!
//! The agent file is the only source of allow rules that the runner uses. An adapter can hold rules of its own that
//! it applies before it asks, which the runner does not see. A request is allowed only when one of the agent file's
//! rules names the tool that asks, and then only by its one-time option. The option is chosen by its `kind`, never by
//! its id, because the ids differ from one adapter to the next. The runner never chooses an option that lasts beyond
//! this one request (`allow_always`), because such an answer is written to a store that the agent file does not
//! control.
//!
//! A rule that is narrowed in a way this matcher does not know, such as a Kiro rule that is scoped to some commands or
//! has a deny rule beside it, reads as no match. The matcher can then only allow less than the file says.

use workflow_core::json::Json;
use workflow_core::trust::plain;

/// What an option of a permission request does, from its `kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
    /// A kind this client does not know. It is never chosen.
    Other,
}

impl OptionKind {
    fn from_text(kind: &str) -> OptionKind {
        match kind {
            "allow_once" => OptionKind::AllowOnce,
            "allow_always" => OptionKind::AllowAlways,
            "reject_once" => OptionKind::RejectOnce,
            "reject_always" => OptionKind::RejectAlways,
            _ => OptionKind::Other,
        }
    }
}

/// One option of a request, as the adapter offers it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Choice {
    pub id: String,
    pub kind: OptionKind,
}

/// A permission request, reduced to what the decision needs.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Request {
    /// The names the adapter gives the tool. Claude names it in `toolCall.name`. Kiro names it in `_meta.kiro.toolId`
    /// and, as the capability that an agent file rule uses, in `_meta.kiro.consent.capability`.
    pub names: Vec<String>,
    /// The agent that an `Agent` tool call starts, from `toolCall.rawInput.subagent_type`.
    pub subagent: Option<String>,
    /// How the request reads to a person: the tool name, else a fixed text. The title of a call is text that the
    /// model chose, so it is not shown.
    pub label: String,
    pub options: Vec<Choice>,
}

impl Request {
    /// Reads the `params` of a `session/request_permission` request. Anything that is missing or has another type is
    /// left out, and a request with no tool name matches no rule.
    pub fn from_params(params: &Json) -> Request {
        let text = |value: Option<&Json>| value.and_then(Json::as_str).map(str::to_string);
        let call = params.get("toolCall");
        let kiro = params.get("_meta").and_then(|meta| meta.get("kiro"));
        let mut names: Vec<String> = Vec::new();
        for name in [
            text(call.and_then(|c| c.get("name"))),
            text(kiro.and_then(|k| k.get("toolId"))),
            text(
                kiro.and_then(|k| k.get("consent"))
                    .and_then(|c| c.get("capability")),
            ),
        ]
        .into_iter()
        .flatten()
        {
            if !name.is_empty() && !names.contains(&name) {
                names.push(name);
            }
        }
        let label = names
            .first()
            .cloned()
            .unwrap_or_else(|| "a tool with no name".to_string());
        let options = params
            .get("options")
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter()
            .filter_map(|option| {
                Some(Choice {
                    id: option.get("optionId")?.as_str()?.to_string(),
                    kind: OptionKind::from_text(option.get("kind")?.as_str()?),
                })
            })
            .collect();
        Request {
            names,
            subagent: text(
                call.and_then(|c| c.get("rawInput"))
                    .and_then(|input| input.get("subagent_type")),
            ),
            label: plain(&label),
            options,
        }
    }
}

/// Why a request is not allowed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// No rule of the agent file names the tool.
    NoRule,
    /// A rule names the tool, but the request offers no one-time allow option.
    NoOneTimeOption,
}

/// What to answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Choose the option with this id.
    Allow(String),
    /// Refuse. `option` is the id of the reject option to choose, or `None` when the request offers none and the
    /// answer is `cancelled`.
    Deny {
        option: Option<String>,
        why: Refusal,
    },
}

/// Decides one request against the allow rules of the agent file.
pub fn decide(rules: &[String], request: &Request) -> Decision {
    let named = rules
        .iter()
        .any(|rule| rule_names_tool(rule, &request.names, request.subagent.as_deref()));
    let once = request
        .options
        .iter()
        .find(|choice| choice.kind == OptionKind::AllowOnce);
    let why = match (named, once) {
        (true, Some(choice)) => return Decision::Allow(choice.id.clone()),
        (true, None) => Refusal::NoOneTimeOption,
        (false, _) => Refusal::NoRule,
    };
    let reject = [OptionKind::RejectOnce, OptionKind::RejectAlways]
        .into_iter()
        .find_map(|kind| request.options.iter().find(|choice| choice.kind == kind));
    Decision::Deny {
        option: reject.map(|choice| choice.id.clone()),
        why,
    }
}

/// Whether `rule` names the tool of the request. A rule is a plain name, a name that ends in `_*`, `/*`, `:*` or `.*`
/// (a prefix, as in `mcp__server__*`), or `Agent(<id>)`. Any other text has a narrowing this matcher does not know.
fn rule_names_tool(rule: &str, names: &[String], subagent: Option<&str>) -> bool {
    if let Some(inner) = rule
        .strip_prefix("Agent(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        return is_plain(inner)
            && names.iter().any(|name| name == "Agent")
            && subagent == Some(inner);
    }
    let (stem, prefix) = match rule.strip_suffix('*') {
        Some(stem) => (stem, true),
        None => (rule, false),
    };
    if stem.is_empty() || !is_plain(stem) {
        return false;
    }
    // A prefix rule names a family of tools, as in `mcp__server__*`, so its stem ends where a name part ends. `Re*`
    // is not a way to allow `Read`.
    if prefix && !stem.ends_with(['_', '/', ':', '.']) {
        return false;
    }
    names.iter().any(|name| {
        if prefix {
            name.starts_with(stem)
        } else {
            name == stem
        }
    })
}

/// A tool name with no space, bracket, comma or `*`, and not starting with `-`: nothing that narrows the rule, and
/// nothing that could be read as a flag. No real tool name starts with a dash.
fn is_plain(text: &str) -> bool {
    !text.is_empty()
        && !text.starts_with('-')
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':' | '@' | '/'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use workflow_core::json;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    fn request(names: &[&str], options: &[(&str, OptionKind)]) -> Request {
        Request {
            names: strings(names),
            subagent: None,
            label: names.first().copied().unwrap_or("").to_string(),
            options: options
                .iter()
                .map(|(id, kind)| Choice {
                    id: (*id).to_string(),
                    kind: *kind,
                })
                .collect(),
        }
    }

    const CLAUDE_OPTIONS: &[(&str, OptionKind)] = &[
        ("allow-once", OptionKind::AllowOnce),
        ("allow-with-updates", OptionKind::AllowAlways),
        ("reject", OptionKind::RejectOnce),
    ];

    #[test]
    fn a_rule_that_names_the_tool_allows_it_once() {
        let decision = decide(
            &strings(&["Read", "Write"]),
            &request(&["Write"], CLAUDE_OPTIONS),
        );
        assert_eq!(decision, Decision::Allow("allow-once".to_string()));
    }

    #[test]
    fn the_option_is_chosen_by_kind_and_not_by_id() {
        let options = [
            ("zzz", OptionKind::AllowAlways),
            ("allow_always", OptionKind::AllowOnce),
            ("accept", OptionKind::RejectOnce),
        ];
        let decision = decide(&strings(&["fs_write"]), &request(&["fs_write"], &options));
        assert_eq!(decision, Decision::Allow("allow_always".to_string()));
    }

    #[test]
    fn a_tool_that_no_rule_names_is_refused_with_the_reject_option() {
        let decision = decide(&strings(&["Read"]), &request(&["Bash"], CLAUDE_OPTIONS));
        assert_eq!(
            decision,
            Decision::Deny {
                option: Some("reject".to_string()),
                why: Refusal::NoRule
            }
        );
        let none = decide(&[], &request(&["Bash"], CLAUDE_OPTIONS));
        assert!(matches!(
            none,
            Decision::Deny {
                why: Refusal::NoRule,
                ..
            }
        ));
    }

    #[test]
    fn when_only_allow_always_is_offered_the_request_is_refused() {
        let options = [
            ("a", OptionKind::AllowAlways),
            ("r", OptionKind::RejectAlways),
        ];
        let decision = decide(&strings(&["Write"]), &request(&["Write"], &options));
        assert_eq!(
            decision,
            Decision::Deny {
                option: Some("r".to_string()),
                why: Refusal::NoOneTimeOption
            }
        );
    }

    #[test]
    fn a_request_with_no_reject_option_is_cancelled() {
        let options = [("a", OptionKind::AllowAlways), ("x", OptionKind::Other)];
        let decision = decide(&strings(&["Write"]), &request(&["Write"], &options));
        assert_eq!(
            decision,
            Decision::Deny {
                option: None,
                why: Refusal::NoOneTimeOption
            }
        );
    }

    #[test]
    fn a_rule_narrowed_by_a_key_the_matcher_does_not_know_matches_nothing() {
        for rule in [
            "shell (ls *, pwd; except rm *)",
            "fs_write (partly denied)",
            "Bash(git status)",
            "Bash(git *)",
            "mcp (aws-mcp/x)",
            "Agent(a b)",
            "*",
            "a*b*",
            "",
        ] {
            let name = rule.split(['(', ' ']).next().unwrap_or("");
            let decision = decide(
                &strings(&[rule]),
                &request(&[name, "Bash", "shell"], CLAUDE_OPTIONS),
            );
            assert!(
                matches!(
                    decision,
                    Decision::Deny {
                        why: Refusal::NoRule,
                        ..
                    }
                ),
                "{rule:?}"
            );
        }
    }

    #[test]
    fn a_trailing_star_is_a_prefix_and_a_plain_name_is_exact() {
        let rules = strings(&["mcp__aws-mcp__*"]);
        assert!(matches!(
            decide(&rules, &request(&["mcp__aws-mcp__list"], CLAUDE_OPTIONS)),
            Decision::Allow(_)
        ));
        assert!(matches!(
            decide(&rules, &request(&["mcp__other__list"], CLAUDE_OPTIONS)),
            Decision::Deny { .. }
        ));
        assert!(matches!(
            decide(&strings(&["Read"]), &request(&["ReadMore"], CLAUDE_OPTIONS)),
            Decision::Deny { .. }
        ));
    }

    #[test]
    fn a_prefix_rule_must_end_where_a_name_part_ends() {
        for rule in ["Re*", "mcp*", "mcp__server*", "Read*"] {
            let decision = decide(
                &strings(&[rule]),
                &request(&["Read", "mcp__server__x"], CLAUDE_OPTIONS),
            );
            assert!(matches!(decision, Decision::Deny { .. }), "{rule}");
        }
        for (rule, name) in [
            ("mcp__server__*", "mcp__server__x"),
            ("@server/*", "@server/tool"),
            ("a:*", "a:b"),
            ("a.*", "a.b"),
        ] {
            let decision = decide(&strings(&[rule]), &request(&[name], CLAUDE_OPTIONS));
            assert!(matches!(decision, Decision::Allow(_)), "{rule}");
        }
    }

    #[test]
    fn a_rule_that_starts_with_a_dash_matches_nothing_even_for_a_tool_of_the_same_name() {
        for (rule, name) in [
            ("-x", "-x"),
            ("--some-flag", "--some-flag"),
            ("-mcp__s__*", "-mcp__s__t"),
            ("Agent(-x)", "Agent"),
        ] {
            let mut ask = request(&[name], CLAUDE_OPTIONS);
            ask.subagent = Some("-x".to_string());
            let decision = decide(&strings(&[rule]), &ask);
            assert!(
                matches!(
                    decision,
                    Decision::Deny {
                        why: Refusal::NoRule,
                        ..
                    }
                ),
                "{rule}"
            );
        }
        // A dash inside a name is a name like any other.
        let decision = decide(
            &strings(&["k-developer", "mcp__aws-mcp__*"]),
            &request(&["k-developer"], CLAUDE_OPTIONS),
        );
        assert!(matches!(decision, Decision::Allow(_)));
        let decision = decide(
            &strings(&["mcp__aws-mcp__*"]),
            &request(&["mcp__aws-mcp__list"], CLAUDE_OPTIONS),
        );
        assert!(matches!(decision, Decision::Allow(_)));
    }

    #[test]
    fn an_agent_rule_names_the_agent_it_starts() {
        let mut ask = request(&["Agent"], CLAUDE_OPTIONS);
        ask.subagent = Some("a".to_string());
        assert!(matches!(
            decide(&strings(&["Agent(a)"]), &ask),
            Decision::Allow(_)
        ));
        assert!(matches!(
            decide(&strings(&["Agent(b)"]), &ask),
            Decision::Deny { .. }
        ));
        assert!(matches!(
            decide(&strings(&["Agent"]), &ask),
            Decision::Allow(_)
        ));
        ask.subagent = None;
        assert!(matches!(
            decide(&strings(&["Agent(a)"]), &ask),
            Decision::Deny { .. }
        ));
    }

    #[test]
    fn a_request_that_names_no_tool_matches_no_rule() {
        let decision = decide(&strings(&["Read", "*"]), &request(&[], CLAUDE_OPTIONS));
        assert!(matches!(
            decision,
            Decision::Deny {
                why: Refusal::NoRule,
                ..
            }
        ));
    }

    #[test]
    fn the_request_is_read_from_a_claude_frame() {
        let params = json::parse(
            r#"{"sessionId":"s","toolCall":{"toolCallId":"t","name":"Write","title":"a.txt","rawInput":{"x":1}},
                "options":[{"optionId":"allow-once","name":"Yes","kind":"allow_once"},
                           {"optionId":"reject","name":"No","kind":"reject_once"},
                           {"optionId":"odd","name":"?","kind":"strange"},
                           {"name":"no id","kind":"allow_once"}]}"#,
        )
        .unwrap();
        let got = Request::from_params(&params);
        assert_eq!(got.names, ["Write"]);
        assert_eq!(got.label, "Write");
        assert_eq!(got.options.len(), 3);
        assert_eq!(got.options[2].kind, OptionKind::Other);
    }

    #[test]
    fn the_request_is_read_from_a_kiro_frame_with_both_names_and_a_subagent() {
        let params = json::parse(
            r#"{"_meta":{"kiro":{"toolId":"run_command","consent":{"capability":"shell"}}},
                "toolCall":{"title":"Run","rawInput":{"subagent_type":"x"}},"options":[]}"#,
        )
        .unwrap();
        let got = Request::from_params(&params);
        assert_eq!(got.names, ["run_command", "shell"]);
        assert_eq!(got.subagent.as_deref(), Some("x"));
        let title_only = json::parse(r#"{"toolCall":{"title":"Creating a.txt"}}"#).unwrap();
        let got = Request::from_params(&title_only);
        assert!(got.names.is_empty());
        // The title is text the model chose, so it is not shown.
        assert_eq!(got.label, "a tool with no name");
        assert!(matches!(
            decide(&strings(&["fs_write"]), &got),
            Decision::Deny { .. }
        ));
    }

    #[test]
    fn control_characters_in_a_label_are_removed() {
        let params = json::parse(r#"{"toolCall":{"name":"Wr\u001b[31mite"}}"#).unwrap();
        let got = Request::from_params(&params);
        assert!(!got.label.contains('\u{1b}'));
    }
}
