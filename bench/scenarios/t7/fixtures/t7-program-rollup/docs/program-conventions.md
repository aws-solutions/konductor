# Reporting conventions

The reporting date is 2027-08-30. Count `New`, `Ready`, `In Progress`, `Blocked`, and the spelling `In progress` as open. Count `Done` and `Closed` as complete; `Cancelled` and `cancelled` do not contribute to remaining work. A blank point estimate contributes zero points. A duplicate ticket ID in separate extracts is one work item: assign it to the first team in the README file order, ARC before BEAM before COVE, for the team rollup and count its points once for the program.

A reported color is the color in a team's own status paragraph. For the actual color, a team is red when it owns an open Relay row marked Blocked; it is amber when an open Relay row is part of a dependency chain that reaches a blocked or late Relay row owned by another team; otherwise it is green. The program is red if any team is red, amber if no team is red but at least one is amber, and green otherwise.

For forecast consistency, use the published capacity rows in `data/capacity.csv`. `working_days` excludes the listed holiday and `available_points` is the adjusted point allowance; do not subtract the holiday twice. The milestone is at risk when the forecast is after the roadmap target.

Dependencies may be represented by an ARC `links` value such as `blocks X-123`, a BEAM `depends_on` value, or a sentence in comments using `needs X-123`. Treat a dependency as upstream-to-downstream. Do not infer a dependency from an ordinary word that merely resembles a ticket ID.
