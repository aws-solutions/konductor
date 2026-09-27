# Search

## Overview

This SOP activates search mode to maximize search effort across codebase and external documentation. Use it when finding patterns or implementations in a codebase, searching for external documentation, locating specific code/files/configurations, or for research tasks requiring thorough investigation. When both scopes apply, codebase and documentation searches SHOULD run in parallel generic subagents when available. Otherwise, the agent running this SOP MUST perform them sequentially. Both modes MUST keep raw output within the result caps below.

## Parameters

- **search_target** (required): What to search for (pattern, term, concept, or documentation topic)
- **search_scope** (optional, default: both): Where to search: `codebase`, `documentation`, or `both`
- **project_root** (optional, default: current directory): Root directory for codebase searches

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding

## Steps

### 1. Identify Search Scope

Determine what needs to be searched and which tools to use.

**Constraints:**

- You MUST map the search scope to execution and tools:

| Scope                  | Execution and tools |
| ---------------------- | ------------------- |
| Internal codebase      | Run rg/grep/ast-grep directly or in a generic subagent |
| External documentation | Run web_search/web_fetch directly or in a generic subagent |
| Both                   | Parallel generic subagents when available; otherwise sequential direct execution |

- You MUST identify multiple search patterns and variations for the `search_target` (e.g., different naming conventions, abbreviations, related terms)
- You MUST NOT limit search to a single pattern when variations are likely

**Expected Output:** A search plan listing:

- Search targets (primary term + variations)
- Execution mode
- Direct tools to use

### 2. Run Searches

Run the codebase and documentation searches.

**Constraints:**

- For codebase search, You MUST perform the following directly or in a generic subagent:
  - Use `project_root` as the search root
  - Use these tools as appropriate: `rg "pattern" --type <lang>` for fast pattern matching, `find {project_root} -name "*.ext" -type f` for file discovery, `ast-grep -p '<pattern>'` for structural code pattern matching (see Search Strategies Reference below)
  - Search multiple patterns and variations
  - Include test files in searches
  - Include file paths and line numbers in results
  - Cap results per the Response Size Rules in the Search Strategies Reference below
- For documentation search, You MUST perform the following directly or in a generic subagent:
  - Search the documentation topic
  - Prefer official sources
  - Include relevant examples
- Each generic subagent task MUST state the task, expected outcome, tools, constraints, and required context
- When searching both scopes, You SHOULD run generic subagents in parallel when available; otherwise You MUST run the searches sequentially yourself

**Expected Output:** Results from all requested scopes, including codebase file paths, line numbers, and relevant snippets of 3-5 lines per match

### 3. Synthesize Results

Consolidate findings from all agents and direct tools.

**Constraints:**

- You MUST organize results by source: Agent findings (codebase, including direct tool results), Agent findings (documentation)
- You MUST deduplicate results across sources
- You MUST highlight the most relevant findings
- If combined findings exceed the size limit, You MUST follow the handoff procedure in the Response Size Rules (Search Strategies Reference below)
- You MUST NOT return raw file contents or complete source code. Summarize with file paths and key snippets

**Expected Output:** A consolidated search results summary:

```markdown
## Search Results Summary

### From generic code-search subagent (Codebase)

- [Files found / patterns identified / relevant code locations]
- [Direct tool results: file paths, line numbers, snippets]

### From generic documentation subagent (Documentation)

- [Documentation sources / examples / best practices]

### Key Findings

- [Most important result 1]
- [Most important result 2]
```

### Search Strategies Reference

This block is reference material for the Step 2 delegation prompt to `generic code-search subagent`.

**Quick Search**: list matching files only:

```bash
rg "term" {project_root} --type ts -l
```

**Deep Search**: with surrounding context:

```bash
rg "term" {project_root} -C 5
```

**AST-Aware Search**: structural code patterns:

```bash
ast-grep -p 'import { $IMPORTS } from "$MODULE"' {project_root}
```

**Response Size Rules:**

- Return file paths + 3-5 line snippets, not full file contents
- Cap at 20 matches per search pattern. Report total count if more exist
- If combined findings exceed ~100 lines, write to `.konductor/handoff/<search-name>.md` and return the path
