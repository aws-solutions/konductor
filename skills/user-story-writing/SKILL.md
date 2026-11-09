---
name: user-story-writing
description: 'Creates user stories with INVEST principles, epics, and acceptance criteria from business requirements or product documentation. Use when asked for user stories, epics or acceptance criteria, or to turn a feature idea or rough ask into backlog items, even with no requirements doc yet. Sizes: MVP (10-15 stories), Production (20-30), full (30-40).'
version: 1.1.0
tags: [skill, user-stories, agile, invest, acceptance-criteria, requirements]
---

# User Story Writing

## Overview

Transforms business requirements (BRD, feature descriptions, requirements docs) into Epics and User Stories following INVEST principles with testable acceptance criteria.

## Usage

Use this skill when:

- Converting a validated requirements document into development-ready stories
- Breaking down a feature into sprint-ready stories
- Creating acceptance criteria for existing stories

## Core Concepts

### INVEST Principles

Every user story must be Independent (no blocking dependencies), Negotiable (captures essence without over-specifying), Valuable (clear value to a specific user), Estimable (enough detail to estimate effort), Small (completable in one sprint, 1-5 days), and Testable (clear, verifiable acceptance criteria).

### Artifact Structure

Use this template for every epic and story:

```
Epic: <title, 5-10 words>
<business objective, 2-4 sentences>
Key objectives:
- <3-5 bullets, each a distinct piece of business value>
Stories: <list of the epic's stories>

Story: <title, 3-8 words>
As a <specific persona>, I want <action> so that <benefit>.
Acceptance criteria:
- <3-8 testable conditions>
```

The ranges are hard limits, not targets. An epic with only 1-2 objectives is usually too thin to stand alone: merge it into a neighbor or widen what it covers. An epic needing more than 5 is two epics. A story needing more than 8 criteria is two stories, so split it rather than overflow.

### Scope Options

MVP produces 10-15 stories for fastest path to value. Production produces 20-30 stories for full feature set. Full scope produces 30-40 stories including edge cases.

## Inputs

Requirements arrive as uploaded files (PRDs, BRDs, technical specifications, spreadsheets, legacy documentation), free-text descriptions, partially formed user stories, business problem statements, or technical specifications that need agile structure. If the user hasn't provided any, ask for one of these.

## Workflow

1. **Identify the input type and format**: an uploaded document (Word, PDF, Excel), free text, or partly structured content.
2. **For a document**, name its type (PRD, BRD, technical spec) and size, then extract business objectives, user needs, functional and non-functional requirements, and constraints and assumptions. Keep traceability to the source section of each requirement, flag ambiguities and missing information, and point out overlaps or conflicts in long documents. Use the same output structure whatever the input format.
3. **For a spreadsheet or other structured data**, treat line items as candidate stories, group related items into epics, use column headers and metadata to inform acceptance criteria, and keep any priority or ordering.
4. **Decide scope** for each requirement: an epic is a large feature needing multiple sprints or teams; a story delivers value within one sprint.
5. **For an epic**, write the title and description, 3-5 key objectives, and 3-8 stories that together fulfill it.
6. **For a story**, check it against INVEST, write 3-8 testable acceptance criteria, and suggest an epic if it belongs to a larger feature.
7. **For every story**:
   - Keep it to one capability. Separate filtering, sorting, and display criteria into distinct stories.
   - Write acceptance criteria as observable behavior and outcomes, not implementation details.
   - Trace it to a business objective. Put assumptions and dependencies in one Assumptions section, not on every story, so the story format stays clean.
8. **When requirements are ambiguous or incomplete**, name the specific gaps, suggest reasonable assumptions, offer options, and ask targeted questions. If the user says not to ask, don't; list your assumptions instead. Keep the source's own numbers, timings and triggers, and don't invent limits, expiry periods or business rules it never states. If a testable criterion needs one, mark it as an assumption so a reader can tell it apart from a stated requirement.
9. **For a large volume of requirements**, group them logically, present a summary view the user can expand, identify the highest-priority items by business value, and suggest a phased approach if it fits.
10. **Apply the Quality Gate** below before presenting the stories.

Say so when:

- You need more business context to make a sound recommendation
- A requirement may create technical dependencies that need architect input
- A story is too large or complex and needs further decomposition
- An acceptance criterion may be technically infeasible, and you lack the domain knowledge to judge
- The user's need might be better served by a different approach
- The document format isn't fully supported or contains elements you can't process
- The volume of requirements is too large to process fully in one session

## Examples

Two epics in the expected structure:

<examples>
<example_1>
<epic>
<title>Media Asset Filtering System</title>
<description>Implement a comprehensive filtering system for the ContentHub Media Assets tab that enables users to efficiently search and organize assets based on multiple criteria. This system will improve workflow efficiency by allowing users to quickly find relevant assets and maintain their preferred filter settings.</description>
<key_objectives>
- Streamline asset discovery process
- Enable precise asset targeting through multiple filter combinations
- Support collaborative workflows through shared filters
- Maintain consistent user preferences across sessions
</key_objectives>
<stories>
<story>
<title>Locale-based Asset Filtering</title>
<description>As a content manager, I want to filter assets based on locale settings so that I can focus on specific language versions of content.</description>
<acceptance_criteria>
- Filter dropdown for locales is available in the ContentHub Media Assets tab
- All available locales are listed in the dropdown
- Selected locale filter shows only matching assets
- Multiple locale selections are supported
- Filter state is maintained when navigating away and back
- Clear filter option is available
- If the locale list fails to load, the dropdown shows an error and a retry option
</acceptance_criteria>
</story>
<story>
<title>QA Status Filtering</title>
<description>As a quality assurance specialist, I want to filter assets based on QA status so that I can efficiently manage my review workflow.</description>
<acceptance_criteria>
- QA status filter includes options: Not Reviewed, QA Approved, QA Rejected
- Selected status filter shows only matching assets
- Multiple status selections are supported
- Assets with any matching status are displayed
- Filter state is maintained when navigating away and back
- A filter combination with no matching assets shows an empty-state message instead of a blank grid
</acceptance_criteria>
</story>
<story>
<title>Shared Saved Filters</title>
<description>As a content manager, I want to save a filter combination and share it with my team so that everyone reviews the same set of assets.</description>
<acceptance_criteria>
- The current filter combination can be saved under a name
- Saved filters appear in a list for the user and the team members it was shared with
- Applying a saved filter sets every filter it contains
- The owner can rename or delete a saved filter
- Saving a filter under a name that already exists asks the user to rename it or overwrite the old one
- A shared filter that refers to a locale that no longer exists applies the remaining filters and says which one was skipped
</acceptance_criteria>
</story>
</stories>
</epic>
</example_1>
<example_2>
<epic>
<title>Media Asset Review Workflow</title>
<description>Create a comprehensive review system that enables efficient QA processes for single or multiple media assets in ContentHub. This workflow will provide a streamlined interface for reviewing assets, managing QA status, and maintaining notes.</description>
<key_objectives>
- Streamline the QA review process
- Ensure consistent status management
- Support detailed feedback capture
- Handle special asset types appropriately
- Enable efficient bulk reviews
</key_objectives>
<stories>
<story>
<title>Asset Slideshow Review Interface</title>
<description>As a content reviewer, I want a slideshow-style interface to review multiple assets in sequence so that I can complete reviews more efficiently.</description>
<acceptance_criteria>
- Modal displays one asset at a time
- Asset is centered and properly scaled
- Asset metadata is displayed
- Current position in queue is indicated (e.g., "3 of 10")
- Navigation controls allow moving forward/backward in the queue
- An asset that fails to load shows an error in its place, and the reviewer can skip to the next one
</acceptance_criteria>
</story>
<story>
<title>QA Status Management</title>
<description>As a quality analyst, I want to set and update QA status for assets during review so that I can track progress and communicate approval decisions.</description>
<acceptance_criteria>
- Status options (Not Reviewed, QA Approved, QA Rejected) are available
- Current status is clearly indicated
- Status changes are saved immediately
- Status updates are reflected in the main asset list
- Confirmation for status changes is provided
- If a status change fails to save, the previous status is restored and an error message says the change was not saved
</acceptance_criteria>
</story>
<story>
<title>Review Notes Capture</title>
<description>As a quality analyst, I want to add notes to an asset during review so that the content team knows why it was rejected.</description>
<acceptance_criteria>
- A notes field is available in the review modal for the current asset
- Saved notes appear in the asset details with the author and a timestamp
- Rejecting an asset requires a note
- A note over 2,000 characters is blocked with a message that states the limit
- Leaving an asset with an unsaved note asks for confirmation first
</acceptance_criteria>
</story>
</stories>
</epic>
</example_2>
</examples>

---

## Quality Gate

**CRITICAL (must fix):**

- Stories are not independent (circular dependencies between stories)
- Acceptance criteria describe implementation details instead of observable behavior
- Stories are too large to complete in one sprint (1-5 days)
- Missing error conditions and edge cases in acceptance criteria
- An epic outside 3-5 key objectives, or a story outside 3-8 acceptance criteria (count them)

**IMPORTANT (should fix):**

- Personas are generic ("user", "admin") instead of specific ("enterprise DevOps engineer")
- Acceptance criteria use vague terms ("fast", "easy") instead of measurable outcomes
- Stories missing performance or scale requirements where applicable

**SUGGESTION:**

- Could decompose XL stories further
- Could add non-functional requirements as explicit stories

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
