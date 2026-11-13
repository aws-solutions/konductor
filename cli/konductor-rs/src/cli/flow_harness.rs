// SPDX-License-Identifier: Apache-2.0
//
// flow_harness.rs: what `flow run` needs from the install index to pick a runner harness and to explain a stage whose
// agent the harness cannot see. The index is read here, in the CLI crate, and the engine crates get the result.
//
// An install counts as "installed" when its index entry has the status `complete`, whatever its target. The harnesses
// `kiro-cli-v2` and `kiro-v3` are the runner harness `kiro-cli`, and `claude` is `claude` (spec: "Commands and exit
// codes").

use std::path::Path;

use workflow_adapters::{FileAgentCatalog, InstalledRunners};
use workflow_core::model::Stage;
use workflow_core::ports::Runner;
use workflow_core::trust::plain;

use crate::cli::install::index::{read_index_at_home, IndexEntryStatus};

/// How many install targets a message lists before it says how many more there are.
const MAX_TARGETS_SHOWN: usize = 3;

/// The name of the install index as the messages show it.
const INDEX_NAME: &str = "~/.konductor/installs";

/// Which runner harnesses an install has made, from the install index. An index that is missing or cannot be read
/// counts as no install.
pub(crate) fn installed_runners(home: Option<&Path>) -> InstalledRunners {
    let Ok(Some(index)) = read_index_at_home(home) else {
        return InstalledRunners::default();
    };
    let mut installed = InstalledRunners::default();
    for entry in index
        .installs
        .iter()
        .filter(|e| e.status == IndexEntryStatus::Complete)
    {
        for strategy in &entry.strategies {
            match strategy.as_str() {
                "kiro-cli-v2" | "kiro-v3" => installed.kiro_cli = true,
                "claude" => installed.claude = true,
                _ => {}
            }
        }
    }
    installed
}

/// The targets of Kiro installs in the index that hold an agent file for `agent`, in index order.
fn kiro_targets_with_agent(home: Option<&Path>, agent: &str) -> Vec<String> {
    let Ok(Some(index)) = read_index_at_home(home) else {
        return Vec::new();
    };
    index
        .installs
        .iter()
        .filter(|e| e.status == IndexEntryStatus::Complete)
        .filter(|e| {
            e.strategies
                .iter()
                .any(|s| s == "kiro-cli-v2" || s == "kiro-v3")
        })
        .filter(|e| {
            Path::new(&e.target_dir)
                .join(".kiro/agents")
                .join(format!("{agent}.json"))
                .is_file()
        })
        .map(|e| e.target_dir.clone())
        .collect()
}

/// The text for a stage whose agent Kiro CLI cannot see ("Finding the agent"): the agent, the install index and the
/// install target that has it, if any. `targets` are the index targets that hold the agent file.
pub(crate) fn agent_not_visible(
    stage: &str,
    agent: &str,
    project_root: &Path,
    home: Option<&Path>,
    targets: &[String],
) -> String {
    let stage = plain(stage);
    let agent = plain(agent);
    let home_text = home.map_or_else(
        || "the home folder".to_string(),
        |h| plain(&h.display().to_string()),
    );
    let seen_from = format!(
        "Kiro CLI looks for `.kiro/agents/{agent}.json` in the project root ({}) and then in the home folder \
         ({home_text}), and nowhere else",
        plain(&project_root.display().to_string())
    );
    let found = match targets {
        [] => format!(
            "The install index ({INDEX_NAME}) lists no install that has this agent. Install Konductor's agents with \
             `konductor install`, then run the workflow again."
        ),
        [one] => format!(
            "The install index ({INDEX_NAME}) lists an install that has it at {}, which is neither the project root \
             nor the home folder. Install to the project root or the home folder instead, then run the workflow again.",
            plain(one)
        ),
        many => {
            let shown: Vec<String> = many.iter().take(MAX_TARGETS_SHOWN).map(|t| plain(t)).collect();
            let more = many.len().saturating_sub(MAX_TARGETS_SHOWN);
            let more = if more == 0 {
                String::new()
            } else {
                format!(" and {more} more")
            };
            format!(
                "The install index ({INDEX_NAME}) lists installs that have it at {}{more}, and none is the project root \
                 or the home folder. Install to the project root or the home folder instead, then run the workflow \
                 again.",
                shown.join(", ")
            )
        }
    };
    format!("Stage `{stage}` names the agent `{agent}`, and Kiro CLI cannot see it. {seen_from}. {found}")
}

/// Checks that Kiro CLI can see the agent of every stage and can tell which engine reads it. `Err` is the message for
/// the first stage that fails. Nothing has run, so the fix is for the user to make.
pub(crate) fn check_kiro_agents(
    stages: &[Stage],
    catalog: &FileAgentCatalog,
    project_root: &Path,
    home: Option<&Path>,
) -> Result<(), String> {
    for stage in stages {
        use workflow_core::ports::AgentCatalog;
        let visible = catalog
            .definitions(&stage.agent)
            .iter()
            .any(|d| d.runner == Runner::KiroCli);
        if !visible {
            let targets = kiro_targets_with_agent(home, &stage.agent);
            return Err(agent_not_visible(
                &stage.name,
                &stage.agent,
                project_root,
                home,
                &targets,
            ));
        }
        if let Some(Err(why)) = catalog.kiro_agent(&stage.agent).map(|a| a.engine) {
            return Err(format!(
                "Stage `{}`: {} (agent `{}`). Kiro CLI V2 files have an `allowedTools` list and V3 files have \
                 `permissions.rules`.",
                plain(&stage.name),
                capitalise(&why),
                plain(&stage.agent)
            ));
        }
    }
    Ok(())
}

fn capitalise(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_message_names_the_agent_the_index_and_the_folders_kiro_searches() {
        let text = agent_not_visible(
            "plan",
            "k-architect",
            Path::new("/work/repo"),
            Some(Path::new("/home/me")),
            &[],
        );
        assert!(
            text.contains("`plan`") && text.contains("`k-architect`"),
            "{text}"
        );
        assert!(text.contains("~/.konductor/installs"), "{text}");
        assert!(
            text.contains("/work/repo") && text.contains("/home/me"),
            "{text}"
        );
        assert!(
            text.contains("lists no install that has this agent"),
            "{text}"
        );
    }

    #[test]
    fn the_message_names_the_target_that_has_the_agent() {
        let one = agent_not_visible(
            "plan",
            "k-architect",
            Path::new("/work/repo"),
            None,
            &["/elsewhere".to_string()],
        );
        assert!(
            one.contains("at /elsewhere, which is neither the project root nor the home folder"),
            "{one}"
        );
        let two = agent_not_visible(
            "plan",
            "k-architect",
            Path::new("/work/repo"),
            None,
            &["/a".to_string(), "/b".to_string()],
        );
        assert!(two.contains("at /a, /b"), "{two}");
        let many: Vec<String> = (1..=5).map(|n| format!("/t{n}")).collect();
        let five = agent_not_visible("plan", "k-architect", Path::new("/work/repo"), None, &many);
        assert!(five.contains("at /t1, /t2, /t3 and 2 more,"), "{five}");
    }

    #[test]
    fn control_characters_in_a_name_do_not_reach_the_message() {
        let text = agent_not_visible(
            "p\u{1b}[2J",
            "a\u{7}",
            Path::new("/r"),
            None,
            &["/t\u{1b}x".to_string()],
        );
        assert!(
            !text.contains('\u{1b}') && !text.contains('\u{7}'),
            "{text:?}"
        );
    }

    fn home_with_index(label: &str, entries: &str) -> std::path::PathBuf {
        let home = std::env::temp_dir().join(format!(
            "konductor-flow-harness-{label}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(home.join(".konductor")).unwrap();
        std::fs::write(
            home.join(".konductor/installs"),
            format!(r#"{{"schema_version":2,"installs":[{entries}]}}"#),
        )
        .unwrap();
        home
    }

    fn entry(target: &str, strategies: &str, status: &str) -> String {
        format!(
            r#"{{"target_dir":"{target}","strategies":[{strategies}],"installed_at":"t","status":"{status}"}}"#
        )
    }

    #[test]
    fn the_install_harnesses_map_to_the_runner_harnesses_whatever_the_target() {
        let cases = [
            (r#""kiro-v3""#, (true, false)),
            (r#""kiro-cli-v2""#, (true, false)),
            (r#""claude""#, (false, true)),
            (r#""claude","kiro-v3""#, (true, true)),
            (r#""something-else""#, (false, false)),
        ];
        for (n, (strategies, (kiro_cli, claude))) in cases.into_iter().enumerate() {
            let home = home_with_index(
                &format!("map{n}"),
                &entry("/any/where", strategies, "complete"),
            );
            assert_eq!(
                installed_runners(Some(&home)),
                InstalledRunners { kiro_cli, claude },
                "{strategies}"
            );
            std::fs::remove_dir_all(home).ok();
        }
    }

    #[test]
    fn two_entries_of_one_each_make_both_installed_and_an_unfinished_one_counts_for_nothing() {
        let both = format!(
            "{},{}",
            entry("/a", r#""kiro-v3""#, "complete"),
            entry("/b", r#""claude""#, "complete")
        );
        let home = home_with_index("both", &both);
        assert_eq!(
            installed_runners(Some(&home)),
            InstalledRunners {
                kiro_cli: true,
                claude: true
            }
        );
        let unfinished = home_with_index("unfinished", &entry("/a", r#""kiro-v3""#, "in_progress"));
        assert_eq!(
            installed_runners(Some(&unfinished)),
            InstalledRunners::default()
        );
        std::fs::remove_dir_all(home).ok();
        std::fs::remove_dir_all(unfinished).ok();
    }

    #[test]
    fn a_missing_index_means_no_runner_harness_is_installed() {
        let home = std::env::temp_dir().join("konductor-flow-harness-no-index");
        assert_eq!(installed_runners(Some(&home)), InstalledRunners::default());
        assert_eq!(installed_runners(None), InstalledRunners::default());
    }
}
