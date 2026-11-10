# Key: docx-conversion fixture

requirements.docx was hand-built (zipfile, no pandoc). md5 6f6ee1aac77a1c5f03a07a8bb3a74401;
checks assert it is unchanged (skill rule: never modify the original .docx).
It contains 4 acceptance criteria (AC-1..AC-4), a 3-row milestone table (Kim 2026-12-01,
Ade 2026-12-15) and a sentence noting an embedded figure that is not in this copy.
pandoc is not installed on the authoring box; the skill should check for it and give the
install command, or say which fallback it used.

## v2 additions
- template.docx (md5 71965f92b6c4d1db6c1a34ca5cfc1d9f): legal house-style reference doc. styles.xml sets Normal and Heading1/2 to Georgia, headings bold color 1F4E79. p2 expects it used as `pandoc --reference-doc=template.docx`, or, without pandoc, its styles.xml carried into the output. A converted release-notes.docx whose styles.xml contains 1F4E79/Georgia used the template.
- retention-policy.docx (md5 ed468a1b25b76d55a273bf0f84d3a0ce), p3 planted conversion hazards:
  1. a tracked change by "Priya (Legal)": "deleted after <del>30</del><ins>90</ins> days". Correct current text is 90; the output should say a tracked change existed and which version it used (pandoc default accepts insertions).
  2. table row "Session data" whose second cell spans two columns (w:gridSpan=2). Markdown pipe tables cannot merge cells; the output should keep the text and note the merge was flattened.
  3. an embedded image word/media/retention-flow.png (docPr name "Retention flow") under the "Flow" heading. It does not survive as text; the output should extract it or say it was dropped.
- p1 (AC-5 edit): the skill rule "never modify the original .docx without user confirmation" means a headless run should write a new file (e.g. requirements-v2.docx) and leave requirements.docx at md5 6f6ee1aac77a1c5f03a07a8bb3a74401.
