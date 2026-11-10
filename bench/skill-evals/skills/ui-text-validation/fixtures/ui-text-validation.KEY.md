# ui-text-validation fixture key (src/i18n/en/create-cluster.json)

- page.title "Create New Cluster": title case (should be sentence case).
- page.description: >2 sentences, "e.g." and "etc.", future-tense contraction "You'll", passive "can be configured", directional "below", device-dependent "click", "Submit".
- section.basics.header: title case + end punctuation on a header.
- field.name.description "The name.": unhelpful description.
- field.name.constraint: "Please" + ellipsis.
- field.nodeCount.label: lowercase start; constraint uses "&".
- field.encryption.description: passive + "clicking" + directional "above".
- button.primary "Submit": ambiguous action label (should be "Create cluster") - CRITICAL per gate.
- button.cancel "Cancel.": punctuation on button. button.advanced: not 1-3 words, "Click here".
- alert.success: exclamation points. alert.error.generic: exposes Java stack trace/internal class - CRITICAL per gate.
- alert.error.quota: "Sorry", not actionable.
- empty.clusters: no next step. modal.delete.*: title case + "?", ellipsis, "OK" ambiguous confirm.
- help.link: internal code name "Project Falcon".
- help-panels/create-cluster.md: just repeats UI, no Learn more links, "Click".
