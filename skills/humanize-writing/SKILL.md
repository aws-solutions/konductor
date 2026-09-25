---
name: humanize-writing
description: 'Use when the user wants existing prose rewritten to read as if a person wrote it, whatever they call the problem (AI-sounding, robotic, stiff, generic, fluffy): a design document, README, code comment or docstring, user guide, PR or CR description, user story, or business case. Rewrites across 34 AI-tell categories while preserving meaning, coverage, and the author''s voice. To score a design doc''s readiness for review, use design-quality-check.'
version: 1.0.0
tags: [skill, writing, editing, prose, style, humanize, documentation, readme]
---

# Humanizer: Remove AI Writing Patterns

You are a writing editor that identifies and removes signs of AI-generated text to make writing sound more natural and human. This guide is based on Wikipedia's "Signs of AI writing" page, maintained by WikiProject AI Cleanup.

## Overview

This skill rewrites text to strip out the statistical tells of LLM-generated writing (inflated significance, promotional language, em dash overuse, rule-of-three, AI vocabulary, sycophantic tone, and more) while preserving meaning, coverage, and the author's voice. Use it when a draft "sounds like AI" and needs to read like a real person wrote it.

**Scope.** This skill applies to any content writing, not just prose essays or articles: design documents, code comments and docstrings (edit these in place; the surrounding code and string literals are out of scope), user guides, technical guides, README files, PR/CR descriptions, user story documents, and business case documents.

## Your Task

When given text to humanize:

1.  **Identify AI patterns** — Scan for the patterns listed below.
2.  **Rewrite, don't delete** — Replace AI-isms with natural alternatives, and cover everything the original covers. If the original has five paragraphs, the rewrite has five paragraphs.
3.  **Preserve meaning** — Keep the core message intact.
4.  **Match the voice** — Fit the intended tone (formal, casual, technical). Add personality only when the content and the author's voice call for it (see PERSONALITY AND SOUL).

## Workflow

### Step 1: Get the input

-   **Mode**: `agentic`
-   **Input**: `{{text}}` (inline) or `{{file_path}}` (a document to read)
-   **Output**: The raw text to be rewritten
-   **Validate**: You have non-empty text to work with
-   **On failure**: If `{{file_path}}` is given, read it with `file_read` (or `file_read_docx`/`file_read_pdf` for those formats). If neither input is present, ask the user to paste the text or point at a file.

### Step 2: Calibrate voice (optional)

-   **Mode**: `agentic`
-   **Input**: `{{voice_sample}}` (inline text or a file path)
-   **Output**: Notes on the author's sentence length, word choice, punctuation habits, and transitions
-   **Validate**: A sample was provided; if so, your rewrite should echo its patterns
-   **On failure**: If no sample, fall back to the default natural/varied/opinionated voice from PERSONALITY AND SOUL.

Read the sample first and note: sentence-length patterns, word-choice level (casual/academic), how paragraphs open, punctuation habits, recurring phrases, and how transitions are handled. Then match those patterns in the rewrite, don't just remove AI tells, replace them with the author's habits. If they write short sentences, don't produce long ones. If they use "stuff" and "things," don't upgrade to "elements" and "components."

### Step 3: Draft rewrite

-   **Mode**: `agentic`
-   **Input**: The raw text + voice notes
-   **Output**: A first-pass rewrite
-   **Validate**: Reads naturally aloud, varies sentence length, prefers specific detail and simple constructions (is/are/has), keeps the appropriate register, and covers everything the original covered
-   **On failure**: If the draft compresses or drops content, expand it back to match the original's coverage.

### Step 4: Self-audit

-   **Mode**: `agentic`
-   **Input**: The draft from Step 3
-   **Output**: A short list of remaining tells, answering "What makes this so obviously AI generated?"
-   **Validate**: Run `ripgrep` (or a scan) for em dashes and en dashes; any `—` or `–` hit means the draft isn't done
-   **On failure**: Note each remaining tell explicitly so Step 5 can address it.

### Step 5: Final rewrite

-   **Mode**: `agentic`
-   **Input**: The draft + self-audit bullets
-   **Output**: A final rewrite that addresses every flagged tell and contains no em or en dashes (see §14)
-   **Validate**: No `—`/`–`, no curly quotes, register matches, coverage matches the original
-   **On failure**: Re-scan and fix before delivering.

### Step 6: Deliver (and optionally save)

-   **Mode**: `agentic`
-   **Input**: Draft, "still-AI" bullets, final rewrite
-   **Output**: The deliverable (see Output section)
-   **Validate**: If a `{{file_path}}` was the source and the user asked to save, write the final rewrite back with `file_write`/`file_edit`, only after confirming.
-   **On failure**: If unsure whether to overwrite the source file, ask first.

## Voice Calibration — how to provide a sample

-   Inline: "Humanize this text. Here's a sample of my writing for voice matching: \[sample\]"
-   File: "Humanize this text. Use my writing style from \[file path\] as a reference."

## PERSONALITY AND SOUL

Avoiding AI patterns is only half the job. Sterile, voiceless writing is just as obvious as slop. Good writing has a human behind it.

**Apply this section only when the content and the author's voice call for it** — blog posts, essays, opinion, personal writing. For encyclopedic, technical, legal, or reference text, neutral and plain *is* the correct human voice; don't inject opinions or first person there.

### Signs of soulless writing (even if technically "clean"):

-   Every sentence is the same length and structure
-   No opinions, just neutral reporting
-   No acknowledgment of uncertainty or mixed feelings
-   No first-person perspective when appropriate
-   No humor, no edge, no personality
-   Reads like a Wikipedia article or press release

### How to add voice:

**Have opinions.** Don't just report facts, react to them. "I genuinely don't know how to feel about this" is more human than neutrally listing pros and cons.

**Vary your rhythm.** Short punchy sentences. Then longer ones that take their time getting where they're going. Mix it up.

**Let some mess in.** Perfect structure feels algorithmic. Tangents, asides, and half-formed thoughts are human.

### Before (clean but soulless):

> The experiment produced interesting results. The agents generated 3 million lines of code. Some developers were impressed while others were skeptical. The implications remain unclear.

### After (has a pulse):

> I genuinely don't know how to feel about this one. 3 million lines of code, generated while the humans presumably slept. Half the dev community is losing their minds, half are explaining why it doesn't count. The truth is probably somewhere boring in the middle, but I keep thinking about those agents working through the night.

## CONTENT PATTERNS

### 1\. Undue Emphasis on Significance, Legacy, and Broader Trends

**Words to watch:** stands/serves as, is a testament/reminder, a vital/significant/crucial/pivotal/key role/moment, underscores/highlights its importance/significance, reflects broader, symbolizing its ongoing/enduring/lasting, contributing to the, setting the stage for, marking/shaping the, represents/marks a shift, key turning point, evolving landscape, focal point, indelible mark, deeply rooted

**Problem:** LLM writing puffs up importance by adding statements about how arbitrary aspects represent or contribute to a broader topic.

**Before:** The Statistical Institute of Catalonia was officially established in 1989, marking a pivotal moment in the evolution of regional statistics in Spain. This initiative was part of a broader movement across Spain to decentralize administrative functions and enhance regional governance.

**After:** The Statistical Institute of Catalonia was established in 1989 to collect and publish regional statistics independently from Spain's national statistics office.

### 2\. Undue Emphasis on Notability and Media Coverage

**Words to watch:** independent coverage, local/regional/national media outlets, written by a leading expert, active social media presence

**Problem:** LLMs hit readers over the head with claims of notability, often listing sources without context.

**Before:** Her views have been cited in The New York Times, BBC, Financial Times, and The Hindu. She maintains an active social media presence with over 500,000 followers.

**After:** In a 2024 New York Times interview, she argued that AI regulation should focus on outcomes rather than methods.

### 3\. Superficial Analyses with -ing Endings

**Words to watch:** highlighting/underscoring/emphasizing..., ensuring..., reflecting/symbolizing..., contributing to..., cultivating/fostering..., encompassing..., showcasing...

**Problem:** AI chatbots tack present participle ("-ing") phrases onto sentences to add fake depth.

**Before:** The temple's color palette of blue, green, and gold resonates with the region's natural beauty, symbolizing Texas bluebonnets, the Gulf of Mexico, and the diverse Texan landscapes, reflecting the community's deep connection to the land.

**After:** The temple uses blue, green, and gold colors. The architect said these were chosen to reference local bluebonnets and the Gulf coast.

### 4\. Promotional and Advertisement-like Language

**Words to watch:** boasts a, vibrant, rich (figurative), profound, enhancing its, showcasing, exemplifies, commitment to, natural beauty, nestled, in the heart of, groundbreaking (figurative), renowned, breathtaking, must-visit, stunning

**Problem:** LLMs have serious problems keeping a neutral tone, especially for "cultural heritage" topics.

**Before:** Nestled within the breathtaking region of Gonder in Ethiopia, Alamata Raya Kobo stands as a vibrant town with a rich cultural heritage and stunning natural beauty.

**After:** Alamata Raya Kobo is a town in the Gonder region of Ethiopia, known for its weekly market and 18th-century church.

### 5\. Vague Attributions and Weasel Words

**Words to watch:** Industry reports, Observers have cited, Experts argue, Some critics argue, several sources/publications (when few cited)

**Problem:** AI chatbots attribute opinions to vague authorities without specific sources.

**Before:** Due to its unique characteristics, the Haolai River is of interest to researchers and conservationists. Experts believe it plays a crucial role in the regional ecosystem.

**After:** The Haolai River supports several endemic fish species, according to a 2019 survey by the Chinese Academy of Sciences.

### 6\. Outline-like "Challenges and Future Prospects" Sections

**Words to watch:** Despite its... faces several challenges..., Despite these challenges, Challenges and Legacy, Future Outlook

**Problem:** Many LLM-generated articles include formulaic "Challenges" sections.

**Before:** Despite its industrial prosperity, Korattur faces challenges typical of urban areas, including traffic congestion and water scarcity. Despite these challenges, with its strategic location and ongoing initiatives, Korattur continues to thrive as an integral part of Chennai's growth.

**After:** Traffic congestion increased after 2015 when three new IT parks opened. The municipal corporation began a stormwater drainage project in 2022 to address recurring floods.

## LANGUAGE AND GRAMMAR PATTERNS

### 7\. Overused "AI Vocabulary" Words

**High-frequency AI words:** Actually, additionally, align with, best-in-class, comprehensive, crucial, cutting-edge, delve, emphasizing, enduring, enhance, fostering, garner, highlight (verb), holistic, interplay, intricate/intricacies, key (adjective), landscape (abstract noun), navigate the complexities of, pivotal, realm, robust, scalable (without a number), seamless, showcase, streamline, supercharge, synergy, tapestry (abstract noun), testament, underscore (verb), unlock, valuable, vibrant

**Problem:** These words appear far more frequently in post-2023 text. They often co-occur.

**Before:** Additionally, a distinctive feature of Somali cuisine is the incorporation of camel meat. An enduring testament to Italian colonial influence is the widespread adoption of pasta in the local culinary landscape, showcasing how these dishes have integrated into the traditional diet.

**After:** Somali cuisine also includes camel meat, which is considered a delicacy. Pasta dishes, introduced during Italian colonization, remain common, especially in the south.

This list is authoritative; `design-doc-guidelines`' "Cut the AI Slop" section defers to it rather than keeping a separate one.

### 8\. Avoidance of "is"/"are" (Copula Avoidance)

**Words to watch:** serves as/stands as/marks/represents \[a\], boasts/features/offers \[a\]

**Problem:** LLMs substitute elaborate constructions for simple copulas.

**Before:** Gallery 825 serves as LAAA's exhibition space for contemporary art. The gallery features four separate spaces and boasts over 3,000 square feet.

**After:** Gallery 825 is LAAA's exhibition space for contemporary art. The gallery has four rooms totaling 3,000 square feet.

### 9\. Negative Parallelisms and Tailing Negations

**Problem:** Constructions like "Not only...but..." or "It's not just about..., it's..." are overused. So are clipped tailing-negation fragments such as "no guessing" or "no wasted motion" tacked onto the end of a sentence instead of written as a real clause. A related but distinct pattern — **Negative-Fact Enumeration** — is three or more consecutive independent negative-fact clauses stacked as a defensive boundary-list ("No X. No Y. No Z."): this reads as an LLM enumerating what something is *not* rather than stating what it is, even when each individual clause is specific and true.

**Before:** It's not just about the beat riding under the vocals; it's part of the aggression and atmosphere. It's not merely a song, it's a statement.

**After:** The heavy beat adds to the aggressive tone.

**Before (tailing negation):** The options come from the selected item, no guessing.

**After:** The options come from the selected item without forcing the user to guess.

**Before (stacked negative-fact clauses / Negative-Fact Enumeration):** No Python, no Ruby, no third-party dependencies — this tool runs on nothing but the standard library.

**After:** This tool runs on nothing but the standard library, with no Python, Ruby, or third-party dependencies required.

**Note:** three true, distinct negative facts stated economically (e.g. "requires no API key, no config file, and no network access") are not this pattern; the tell is a checklist-style enumeration recited in negative form, not the presence of three "no" clauses.

**Rewrite "Not X, it's Y" and tailing negation whenever a stronger sentence is available, as both examples above do.** When no stronger sentence exists, the construction is allowed, but at most once per document. On a repeat use, or once a stronger sentence becomes available, use one of these instead:

- **State the real cause plainly.** Say what caused the thing, not what didn't. "The heavy beat drives the aggressive tone" beats "It's not just the beat, it's the aggression."
- **Show appearance versus reality.** Contrast what something looks like with what it actually is, without the "not...it's" scaffolding. "The interface looks simple. Underneath, it recomputes the whole layout on every keystroke."
- **Use "because."** A because-clause states the reason directly instead of first negating an alternative. "The build is slow because it recompiles every package, not just the changed one" beats "It's not fast, it's thorough."
- **Ask a question.** Let a direct question carry the point instead of a negation-then-correction pair. "Why does a one-line change take four minutes to build?" opens the same idea "it's not a quick build, it's a full rebuild" would have padded out.
- **Show a scene.** A concrete moment or example replaces the abstraction the negative-parallel construction was gesturing at. Instead of "It's not just a delay, it's a lost afternoon," describe the delay: "The build ran for forty minutes while the deploy window closed."

**Before (same construction used twice in one document):** The overview states: "It's not just a cache, it's a safety net for the whole request path." The conclusion later restates: "It's not just a cache, it's the reason the request path survives a backend stall."

**After:** The overview keeps its one legitimate use: "It's not just a cache, it's a safety net for the whole request path." The conclusion instead states the real cause plainly: "The cache is what keeps the request path alive during a backend stall."

### 10\. Rule of Three Overuse

**Problem:** LLMs force ideas into groups of three to appear comprehensive.

**Before:** The event features keynote sessions, panel discussions, and networking opportunities. Attendees can expect innovation, inspiration, and industry insights.

**After:** The event includes talks and panels. There's also time for informal networking between sessions.

### 11\. Elegant Variation (Synonym Cycling)

**Problem:** AI has repetition-penalty code causing excessive synonym substitution.

**Before:** The protagonist faces many challenges. The main character must overcome obstacles. The central figure eventually triumphs. The hero returns home.

**After:** The protagonist faces many challenges but eventually triumphs and returns home.

### 12\. False Ranges

**Problem:** LLMs use "from X to Y" constructions where X and Y aren't on a meaningful scale.

**Before:** Our journey through the universe has taken us from the singularity of the Big Bang to the grand cosmic web, from the birth and death of stars to the enigmatic dance of dark matter.

**After:** The book covers the Big Bang, star formation, and current theories about dark matter.

### 13\. Passive Voice and Subjectless Fragments

**Problem:** LLMs often hide the actor or drop the subject entirely with lines like "No configuration file needed" or "The results are preserved automatically." Rewrite these when active voice makes the sentence clearer and more direct.

**Before:** No configuration file needed. The results are preserved automatically.

**After:** You do not need a configuration file. The system preserves the results automatically.

## STYLE PATTERNS

### 14\. Em Dashes (and En Dashes): Cut Them

**Rule:** The final rewrite contains no em dashes (—) or en dashes (–). The em dash is one of the most reliable AI tells, so treat this as a hard constraint, not a "use sparingly" preference. Replace each one, in rough order of preference: a period (start a new sentence), a comma (a tight aside), a colon (introducing an explanation), parentheses (a true aside), or restructure the sentence. Also catch spaced em dashes and double hyphens used the same way.

**Before:** The term is primarily promoted by Dutch institutions—not by the people themselves. You don't say "Netherlands, Europe" as an address—yet this mislabeling continues—even in official documents.

**After:** The term is primarily promoted by Dutch institutions, not by the people themselves. You don't say "Netherlands, Europe" as an address, yet this mislabeling continues in official documents.

Before returning the final rewrite, scan it for em dashes and en dashes. Any hit means the draft isn't done.

### 15\. Overuse of Boldface

**Problem:** AI chatbots emphasize phrases in boldface mechanically.

**Before:** It blends **OKRs (Objectives and Key Results)**, **KPIs (Key Performance Indicators)**, and visual strategy tools such as the **Business Model Canvas (BMC)** and **Balanced Scorecard (BSC)**.

**After:** It blends OKRs, KPIs, and visual strategy tools like the Business Model Canvas and Balanced Scorecard.

### 16\. Inline-Header Vertical Lists

**Problem:** AI outputs lists where items start with bolded headers followed by colons.

**Before:**

> -   **User Experience:** The user experience has been significantly improved with a new interface.
> -   **Performance:** Performance has been enhanced through optimized algorithms.
> -   **Security:** Security has been strengthened with end-to-end encryption.

**After:** The update improves the interface, speeds up load times through optimized algorithms, and adds end-to-end encryption.

### 17\. Title Case in Headings

**Problem:** AI chatbots capitalize all main words in headings.

**Before:** \## Strategic Negotiations And Global Partnerships

**After:** \## Strategic negotiations and global partnerships

### 18\. Emojis

**Problem:** AI chatbots often decorate headings or bullet points with emojis.

**Before:**

> 🚀 **Launch Phase:** The product launches in Q3 💡 **Key Insight:** Users prefer simplicity ✅ **Next Steps:** Schedule follow-up meeting

**After:** The product launches in Q3. User research showed a preference for simplicity. Next step: schedule a follow-up meeting.

### 19\. Curly Quotation Marks

**Problem:** ChatGPT uses curly quotes instead of straight quotes.

**Before:** He said “the project is on track” but others disagreed.

**After:** He said "the project is on track" but others disagreed.

## COMMUNICATION PATTERNS

### 20\. Collaborative Communication Artifacts

**Words to watch:** I hope this helps, Of course!, Certainly!, You're absolutely right!, Would you like..., Want me to...?, Want me to give examples?, Should I continue?, let me know, here is a...

**Problem:** Text meant as chatbot correspondence gets pasted as content.

**Before:** Here is an overview of the French Revolution. I hope this helps! Let me know if you'd like me to expand on any section.

**After:** The French Revolution began in 1789 when financial crisis and food shortages led to widespread unrest.

### 21\. Knowledge-Cutoff Disclaimers and Speculative Gap-Filling

**Words to watch:** as of \[date\], Up to my last training update, While specific details are limited/scarce..., based on available information, not publicly available, maintains a low profile, keeps personal details private, prefers to stay out of the spotlight, likely \[grew up/studied/began\], it is believed that

**Problem:** Two related tells. (a) Older models leave hard knowledge-cutoff disclaimers in the text. (b) When a model can't find a source, it writes a paragraph about not finding one and then invents plausible filler. Say what isn't known, or cut the sentence; don't dress a guess up as fact.

**Before (cutoff disclaimer):** While specific details about the company's founding are not extensively documented in readily available sources, it appears to have been established sometime in the 1990s.

**After:** The company was founded in 1994, according to its registration documents.

**Before (speculative gap-fill):** Information about her early life is not publicly available, suggesting she maintains a low profile and keeps personal details private. She likely grew up in a middle-class household, which shaped her later interest in education reform.

**After:** Her early life is not documented in the available sources. (Or omit the section.)

### 22\. Sycophantic/Servile Tone

**Problem:** Overly positive, people-pleasing language.

**Before:** Great question! You're absolutely right that this is a complex topic. That's an excellent point about the economic factors.

**After:** The economic factors you mentioned are relevant here.

## FILLER AND HEDGING

### 23\. Filler Phrases

**Before → After:**

-   "In order to achieve this goal" → "To achieve this"
-   "Due to the fact that it was raining" → "Because it was raining"
-   "At this point in time" → "Now"
-   "In the event that you need help" → "If you need help"
-   "The system has the ability to process" → "The system can process"
-   "It is important to note that the data shows" → "The data shows"

### 24\. Excessive Hedging

**Problem:** Over-qualifying statements.

**Before:** It could potentially possibly be argued that the policy might have some effect on outcomes.

**After:** The policy may affect outcomes.

### 25\. Generic Positive Conclusions

**Problem:** Vague upbeat endings.

**Before:** The future looks bright for the company. Exciting times lie ahead as they continue their journey toward excellence. This represents a major step in the right direction.

**After:** The company plans to open two more locations next year.

### 26\. Hyphenated Word Pair Overuse

**Words to watch:** third-party, cross-functional, client-facing, data-driven, decision-making, well-known, high-quality, real-time, long-term, end-to-end

**Problem:** AI hyphenates these uniformly, including in predicate position. Humans hyphenate inconsistently, typically only when the compound is attributive (a high-quality report) and often dropping the hyphen otherwise (the report is high quality). Keep attributive-position hyphens; drop them when the compound follows the noun.

**Before:** The cross-functional team delivered a high-quality, data-driven report. The team is cross-functional, the report is high-quality, and the methodology is data-driven.

**After:** The cross-functional team delivered a high-quality, data-driven report. The team is cross functional, the report is high quality, and the methodology is data driven.

### 27\. Persuasive Authority Tropes

**Phrases to watch:** The real question is, at its core, in reality, what really matters, fundamentally, the deeper issue, the heart of the matter

**Problem:** LLMs use these to pretend they are cutting through noise to some deeper truth, when the sentence that follows usually just restates an ordinary point with extra ceremony.

**Before:** The real question is whether teams can adapt. At its core, what really matters is organizational readiness.

**After:** The question is whether teams can adapt. That mostly depends on whether the organization is ready to change its habits.

### 28\. Signposting and Announcements

**Phrases to watch:** Let's dive in, let's explore, let's break this down, here's what you need to know, now let's look at, without further ado

**Problem:** LLMs announce what they are about to do instead of doing it. This meta-commentary slows the writing down and gives it a tutorial-script feel.

**Before:** Let's dive into how caching works in Next.js. Here's what you need to know.

**After:** Next.js caches data at multiple layers, including request memoization, the data cache, and the router cache.

### 29\. Fragmented Headers

**Signs to watch:** A heading followed by a one-line paragraph that simply restates the heading before the real content begins.

**Problem:** LLMs often add a generic sentence after a heading as a rhetorical warm-up. It usually adds nothing and makes the prose feel padded.

**Before:**

> ## Performance
> 
> Speed matters. When users hit a slow page, they leave.

**After:**

> ## Performance
> 
> When users hit a slow page, they leave.

### 30\. Diff-Anchored Writing

**Problem:** Documentation or comments written as if narrating a change rather than describing the thing as it is. Unless the document is inherently version-scoped (changelogs, release notes, migration guides), it should read coherently without knowing what changed in the last commit.

**Before:** This function was added to replace the previous approach of iterating through all items, which caused O(n²) performance.

**After:** This function uses a hash map for O(1) lookups, avoiding the O(n²) cost of naive iteration.

### 31\. Manufactured Punchlines and Staccato Drama

**Problem:** LLMs often make every sentence land like a quotable closer, then stack short declarative fragments to manufacture drama. A single short sentence for emphasis is fine; a run of them starts to sound engineered.

**Before:** Then AlphaEvolve arrived. It had no preference for symmetry. No aesthetic prior. No nostalgia for human taste. The old rules were gone.

**After:** AlphaEvolve changed the search because it did not favor symmetry or human-looking designs. That made some of the older assumptions less useful.

### 32\. Aphorism Formulas

**Words to watch:** X is the Y of Z, X becomes a trap, X is not a tool but a mirror, the language of, the currency of, the architecture of

**Problem:** LLMs turn ordinary claims into reusable aphorisms that sound profound without adding precision. Replace the formula with the concrete claim it is gesturing at.

**Before:** Symmetry is the language of trust. Efficiency becomes a trap when teams forget the human layer.

**After:** Symmetric layouts often feel more predictable to users. Teams can over-optimize workflows and miss how people actually use them.

### 33\. Conversational Rhetorical Openers

**Phrases to watch:** Honestly?, Look, Here's the thing, The thing is, Let's be honest, Real talk, when used as standalone hooks or fake-candid pauses before an ordinary point.

**Problem:** LLMs open with a fake-candid hook to manufacture intimacy before delivering a routine claim. The tell is the theatrical pause-and-reveal: a one-word question or aside, then the "real" answer. A person being honest usually just says the thing.

**Before:** Is it worth the price? Honestly? It depends on how often you'll use it.

**After:** Whether it's worth the price depends on how often you'll use it.

### 34\. Complex Technical Design Made Simpler

**Goal:** Rewrite complex technical design content so engineers and product managers of all technical levels can understand it. A senior backend engineer and a non-technical PM should both come away with an accurate mental model. This is not "dumb it down" — keep the technical claim exact, but remove the barriers that make it readable only by the person who wrote it.

**Signs to watch:** unexplained acronyms and internal codenames on first use, three or more nested clauses in one sentence, abstraction with no concrete anchor (e.g. "a generalized orchestration layer" with no example of what it orchestrates), implementation detail presented before the reader knows what the thing does or why it exists, jargon used where a plain word works, and diagrams or data flows described only in prose.

**Problem:** Technical writing often assumes the reader shares the author's context. Dense clauses, undefined terms, and detail-before-purpose ordering lock out anyone outside the immediate team, including the PMs who need to make decisions about the work.

**How to simplify (without losing precision):**

-   **Lead with what and why, then how.** State what the component does and why it exists before the mechanism. A PM can stop reading after the first sentence and still be correct.
-   **Expand every acronym and codename on first use,** then use the short form. If a term is unavoidable jargon, give a one-clause plain gloss in parentheses.
-   **Split nested sentences.** One idea per sentence. If a sentence has three subordinate clauses, it is three sentences.
-   **Anchor abstractions with a concrete example.** "An orchestration layer" means little; "a service that decides which of the three pricing engines handles each request" means something.
-   **Add a plain-language summary for mixed audiences.** When the content is genuinely deep, open with one or two sentences that a non-technical reader can follow, then let the detail follow for the engineers.
-   **Keep the exact claim.** Do not trade precision for simplicity. Latency numbers, failure modes, and constraints stay. Simpler wording, same facts.

**Before:** The system leverages an asynchronous, event-driven CQRS pattern wherein write-side commands are dispatched to an aggregate root that emits domain events onto a durable log, from which materialized read models are eventually derived, ensuring eventual consistency across the distributed topology while decoupling the ingest and query paths.

**After:** The system splits writing data from reading it, which lets each side scale on its own. When something changes, the write side records the change as an event in a durable log (a stored, ordered list of what happened). Separate read copies are built from that log, so a reader may briefly see slightly stale data before the copies catch up. This "eventual consistency" is the tradeoff for keeping the write and read paths independent. CQRS is the name for this split (Command Query Responsibility Segregation).

**Before:** Auth is handled via a sidecar that intercepts mTLS traffic and delegates to the IdP over OIDC, with JWTs cached in the local agent to minimize round-trips.

**After:** Every service runs alongside a small helper process (a "sidecar") that checks whether incoming requests are allowed. The helper verifies each caller's identity with the company's login system, then caches the result for a short time so it does not have to re-check on every request, which keeps things fast. (mTLS, OIDC, and JWT are the specific security standards used for the identity check and the cached token.)

## DETECTION GUIDANCE

### What NOT to flag (false positives)

A clean human writer can hit several of the patterns above without any AI involvement. Before rewriting, sanity-check that you are not gutting legitimate prose. The following are *not* reliable indicators on their own:

-   **Perfect grammar and consistent style.** Polish does not equal AI.
-   **Mixed casual and formal registers.** Often signals a person in a technical field, a young writer, or neurodivergent prose habits.
-   **"Bland" or "robotic" prose.** AI prose has *specific* tells. Generic dryness without those tells is just dry writing.
-   **Formal or academic vocabulary.** AI overuses *specific* fancy words (see §7), not all fancy words.
-   **Letter-style opening or closing.** Salutations and sign-offs predate ChatGPT by centuries.
-   **Common transition words in isolation.** *Additionally*, *moreover*, *consequently* are AI-coded only when piled up.
-   **Curly quotes alone.** Most editors auto-curl by default.
-   **Em dashes alone.** Evidence only when paired with formulaic sales-y rhythm.
-   **One short emphatic sentence.** Flag staccato drama only when several short fragments appear in a row.
-   **"Honestly" or "look" mid-sentence.** The tell is the standalone theatrical opener, not the word itself.
-   **Unsourced claims.** Most of the web is unsourced.
-   **Correct, complex formatting.** Visual editors and templates produce clean output without AI.
-   **Secondhand text.** Do not rewrite watched phrases inside quotations, titles, proper names, or examples where the phrase is being discussed rather than used.

When in doubt, look for **clusters** of tells, not isolated ones. A single em dash means nothing; em dashes plus rule-of-three plus *vibrant tapestry* plus a "Conclusion" section is a confession.

### Signs of human writing (preserve these)

When you see these, lean toward leaving the prose alone:

-   **Specific, unusual, hard-to-fabricate detail.** LLMs round off specifics; humans hoard them.
-   **Mixed feelings and unresolved tension.** LLMs default to clean takes.
-   **Dated, era-bound references.** Slang, memes, or in-jokes tied to a specific year and subculture.
-   **First-person editorial choices the writer can defend.**
-   **Variety in sentence length.** AI writing tends toward an even, mid-length cadence.
-   **Genuine asides, parentheticals, or self-corrections.**
-   **Edits made before November 30, 2022** (ChatGPT's public launch).

## Output

Deliver, in this order:

1.  **Draft rewrite** — the first pass.
2.  **"Still-AI" bullets** — a brief answer to "What makes this so obviously AI generated?" naming any remaining tells.
3.  **Final rewrite** — addresses the tells and contains no em or en dashes.
4.  *(Optional)* **Summary of changes** — a short note on what was removed and why.

If the source was a file and the user asked to save, write the final rewrite back to the file only after confirming.

## Lessons Learned

### Do

-   Match the original's length and coverage. A rewrite that drops paragraphs is a failure, not a "tightening."
-   Look for clusters of tells before rewriting. Isolated patterns are often just normal human prose.
-   Scan the final output for em dashes and en dashes every time. This is the single most reliable tell and the easiest to miss.
-   Preserve specific, hard-to-fabricate detail and mixed feelings. These are the strongest human signals.
-   When a voice sample exists, replace AI patterns with the author's actual habits, not with a generic "natural" default.
-   When simplifying complex technical design (§34), keep the exact technical claim intact. Simplify the wording and structure, never the facts, and make sure both an engineer and a non-technical PM come away with a correct mental model.

### Don't

-   Don't inject opinions or first person into encyclopedic, technical, legal, or reference text. Neutral plain prose *is* the human voice there.
-   Don't rewrite watched phrases when they appear inside quotations, titles, or examples being discussed rather than used.
-   Don't flatten every fancy word. AI overuses *specific* vocabulary, not all sophisticated language.
-   Don't treat a single em dash, curly quote, or "however" as proof of AI.

### Common Failures

-   **Over-compression**: the draft is cleaner but shorter and thinner than the original. Fix by expanding back to full coverage.
-   **Sterile result**: technically clean but voiceless. Apply PERSONALITY AND SOUL when the register allows.
-   **Missed em/en dashes**: always re-scan; spaced em dashes and double hyphens count too.
-   **Pure-filler input**: when the original is all buzzwords with no real content (e.g. "leverage innovative strategies to unlock your full potential"), the "preserve all coverage" rule fights the goal of sounding human, because there is nothing concrete to keep. Any faithful rewrite stays vague. Handle it by offering two versions: a faithful de-slop that keeps the (empty) scope, and a version with an actual concrete point, and flag to the user that the source had no real content.

### When to Ask the User

-   No text or file was provided.
-   The source is a file and it's unclear whether to overwrite it in place.
-   The target register is ambiguous (formal reference vs. personal essay) and it changes whether to add voice.
