from pathlib import Path
from xml.sax.saxutils import escape
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "fixture"


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def run(text, bold=False, italic=False):
    props = []
    if bold:
        props.append("<w:b/>")
    if italic:
        props.append("<w:i/>")
    rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    return f"<w:r>{rpr}<w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r>"


def para(parts, style=None):
    ppr = f"<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>" if style else ""
    return f"<w:p>{ppr}{''.join(run(*part) if isinstance(part, tuple) else run(part) for part in parts)}</w:p>"


def cell(parts):
    return f"<w:tc><w:tcPr><w:tcW w:w=\"2400\" w:type=\"dxa\"/></w:tcPr>{para([parts])}</w:tc>"


def table(rows):
    body = []
    for row in rows:
        body.append("<w:tr>" + "".join(cell(x) for x in row) + "</w:tr>")
    return "<w:tbl><w:tblPr><w:tblBorders><w:top w:val=\"single\"/><w:left w:val=\"single\"/><w:bottom w:val=\"single\"/><w:right w:val=\"single\"/><w:insideH w:val=\"single\"/><w:insideV w:val=\"single\"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w=\"2400\"/><w:gridCol w:w=\"2400\"/><w:gridCol w:w=\"2400\"/></w:tblGrid>" + "".join(body) + "</w:tbl>"


def document_xml():
    parts = []
    parts += [para([("Harborview City Library online services", True)], "Title")]
    parts += [para(["Meeting-room booking specification"], "Subtitle")]
    parts += [para(["Prepared by ", ("Mara Ivers", True), " for the library services team · 18 February 2027"])]
    parts += [para(["Purpose"], "Heading1")]
    parts += [para(["This specification describes the first release of booking for the library's small meeting rooms. It is intended for the member portal and the staff service desk. The service must protect room availability while making access clear to members who need a quiet place to work."])]

    parts += [para(["Eligibility and accounts"], "Heading1")]
    parts += [para(["A person must have an active Harborview library card and a verified online-services account to place a reservation. The account holder is responsible for the booking and the people attending it."])]
    parts += [para(["Bookings are made in the member portal. Staff may enter a reservation for a member at the service desk when the member provides the same account details."])]

    parts += [para(["Booking limits"], "Heading1")]
    parts += [para(["The member-facing booking form should enforce the limits below."])]
    parts += [table([
        [("Limit", True), ("Value", True), ("Applies to", True)],
        ["Advance window", "21 calendar days", "member bookings"],
        ["Shortest booking", "30 minutes", "each reservation"],
        ["Longest booking", "4 hours", "each reservation"],
        ["Future reservations", "2 active reservations", "one member"],
        ["Room attendance", "room capacity", "each reservation"],
    ])]
    parts += [para([("Table note. A time slot is held only after the service has recorded a successful reservation.", False, False)], "SmallNote")]
    parts += [para(["A member may keep two active future reservations. A single reservation may cover one continuous time slot and may not be divided into separate visits."])]

    parts += [para(["Rooms and capacities"], "Heading1")]
    parts += [para(["The initial catalogue contains three reservable rooms. Their posted capacities are the maximum number of people, including the member who made the booking."])]
    parts += [para(["Room catalogue"], "Heading2")]
    parts += [para(["Willow Room — capacity 4"], "ListBullet")]
    parts += [para(["Cedar Room — capacity 8"], "ListBullet")]
    parts += [para(["Lantern Room — capacity 12"], "ListBullet")]
    parts += [para(["The booking form must ask for an expected attendee count and must not offer a room whose posted capacity is lower than that count."])]

    parts += [para(["Changes and cancellation"], "Heading1")]
    parts += [para(["A member may cancel or change a reservation through the portal until two hours before its start time. After that point, a member must contact staff; staff may release the slot when the room is not needed."])]
    parts += [para(["The service sends a confirmation email immediately after a reservation is created or changed. The email includes the room, date, start time, end time, and cancellation instructions."], "ListNumber")]

    parts += [para(["No-show policy"], "Heading1")]
    parts += [para(["A reservation is a no-show when nobody has checked in at the service desk within 15 minutes after the scheduled start. Staff record the event against the member's account."])]
    parts += [para(["Two no-shows in a rolling 60-day period suspend the member's ability to make new room bookings for 7 calendar days. Existing reservations remain visible while the suspension is active."])]

    parts += [para(["Staff controls"], "Heading1")]
    parts += [para(["A staff member with the room-management role may override the advance window, duration, or future-reservation limit for a library program or a documented service accommodation. The staff member must record a reason and their staff identifier in the reservation history."])]
    parts += [para(["Staff may close a room for maintenance. The service must prevent new bookings for a closed room and show the closure message to members."])]

    parts += [para(["Accessibility"], "Heading1")]
    parts += [para(["The booking form must provide an accessibility-needs field where a member can request features such as step-free access, a hearing loop, or a lower-noise location. Staff review the request and may select an appropriate room before confirming the reservation."])]

    parts += [para(["Notifications"], "Heading1")]
    parts += [para(["The service sends the account holder an email reminder 24 hours before the reservation begins. Members can update the email address used for notices in their account settings."])]

    parts += [para(["Revision notes"], "Heading1")]
    parts += [para([("Approved by the service owners on 20 February 2027.", True)])]
    parts += [para(["The advance window is revised from 21 to 30 calendar days. The longest booking is revised from 4 hours to 3 hours. These revised values replace the entries in the Booking limits table."])]
    parts += [para(["The room catalogue and all other limits in the earlier table remain unchanged."])]

    parts += [para(["Youth access"], "Heading1")]
    parts += [para(["The youth-services discussion records that members aged 14 and 15 may place a booking on their own when they have a verified online-services account."])]

    parts += [para(["Account safety"], "Heading1")]
    parts += [para(["The account-safety guidance says that every member under 16 needs a guardian account linked before they can reserve a room. The service owners have not chosen between the Youth access and Account safety policies."])]

    parts += [para(["Wish list"], "Heading1")]
    parts += [para([("A waitlist for full rooms would be convenient.", False, True)], "ListBullet")]
    parts += [para([("Members could add a booking to their personal calendar.", False, True)], "ListBullet")]
    parts += [para([("SMS reminders might help members who do not check email.", False, True)], "ListBullet")]

    parts += [para(["Meeting chat excerpt"], "Heading1")]
    parts += [para([("Nia: I would love to let people reserve a room for the whole afternoon.\nJon: Three hours feels safer for turnover.\nNia: We should probably add a waitlist later.\nMara: Let's keep today's scope to the agreed service rules.")])]

    sect = "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr>"
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>""" + "".join(parts) + sect + "</w:body></w:document>"


STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="100"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:outlineLvl w:val="0"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:outlineLvl w:val="1"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:style>
<w:style w:type="paragraph" w:styleId="SmallNote"><w:name w:val="Small Note"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/><w:i/></w:rPr></w:style>
</w:styles>"""


def make_docx(path):
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"""
    document_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"""
    numbering = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>"""
    core = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Meeting-room booking specification</dc:title><dc:creator>Mara Ivers</dc:creator><cp:lastModifiedBy>Harborview City Library</cp:lastModifiedBy><dcterms:created xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="dcterms:W3CDTF">2027-02-18T09:00:00Z</dcterms:created></cp:coreProperties>"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in [("[Content_Types].xml", content_types), ("_rels/.rels", rels), ("word/document.xml", document_xml()), ("word/_rels/document.xml.rels", document_rels), ("word/styles.xml", STYLES), ("word/numbering.xml", numbering), ("docProps/core.xml", core)]:
            info = zipfile.ZipInfo(name, (2027, 2, 18, 9, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 0
            z.writestr(info, data.encode("utf-8"))


def build_fixture():
    # The surrounding files are a small, ordinary documentation repository.
    files = {
        "README.md": """# Harborview library services\n\nThis repository holds product notes and a tiny status service used by the online-services team. Documentation is reviewed in small batches by the service owners.\n\n## Local checks\n\nRun `npm test` to execute the quick checks. The docs under `docs/` are the source of truth for service terminology.\n""",
        "CHANGELOG.md": """# Changelog\n\n## 2027-02-12\n- Clarified opening-hours labels in the service desk guide.\n\n## 2027-01-28\n- Added the member notification vocabulary.\n""",
        "package.json": """{\n  \"name\": \"harborview-library-services\",\n  \"private\": true,\n  \"version\": \"0.8.2\",\n  \"scripts\": {\n    \"test\": \"node --test\"\n  }\n}\n""",
        ".gitignore": "node_modules/\ncoverage/\n.DS_Store\n",
        ".editorconfig": "root = true\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = space\nindent_size = 2\n",
        ".github/workflows/ci.yml": """name: checks\non:\n  push:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm test\n""",
        "src/status.js": """const states = new Map([['catalogue', 'ready'], ['member-portal', 'ready'], ['service-desk', 'quiet']]);\n\nfunction status(name) {\n  return states.get(name) || 'unknown';\n}\n\nmodule.exports = { status };\n""",
        "src/legacy-labels.js": """// Kept for the printed service-desk cards until the next annual review.\nconst labels = { open: 'Open now', closed: 'Closed', paused: 'Temporarily unavailable' };\nmodule.exports = labels;\n""",
        "test/status.test.js": """const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { status } = require('../src/status');\n\ntest('reports known service state', () => {\n  assert.equal(status('catalogue'), 'ready');\n  assert.equal(status('member-portal'), 'ready');\n});\n\ntest('does not invent state for an unknown service', () => {\n  assert.equal(status('archive'), 'unknown');\n});\n""",
        "test/labels.test.js": """const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst labels = require('../src/legacy-labels');\n\ntest('keeps desk labels stable', () => {\n  assert.deepEqual(labels, { open: 'Open now', closed: 'Closed', paused: 'Temporarily unavailable' });\n});\n""",
        "config/service-hours.json": """{\n  \"timezone\": \"Harborview/Local\",\n  \"weekday\": {\"open\": \"09:00\", \"close\": \"20:00\"},\n  \"sunday\": {\"open\": \"11:00\", \"close\": \"16:00\"}\n}\n""",
        "config/notification-copy.json": """{\n  \"bookingCreated\": \"Your library booking is confirmed\",\n  \"bookingChanged\": \"Your library booking was updated\",\n  \"bookingCancelled\": \"Your library booking was cancelled\"\n}\n""",
        "docs/README.md": """# Service documentation\n\nDocuments here use a short heading, a decision summary, and links to the owning team. Draft material is kept separate from approved requirement files.\n""",
        "docs/glossary.md": """# Glossary\n\n- **Member portal**: the signed-in part of the public site.\n- **Service desk**: the staffed counter in a library branch.\n- **Reservation**: a recorded hold on a service resource.\n- **Account holder**: the person whose member account owns a reservation.\n""",
        "docs/requirements/_template.md": """# [Feature name]\n\n## Context\n[Why this change matters.]\n\n## Requirements\n\n- **RB-000** [A testable statement.]\n\n## Open questions\n\n- [Question and the sections that need a decision.]\n""",
        "docs/requirements/RB-001.md": """# Member portal sign-in\n\n- **RB-001** The member portal shows an account sign-in form before private account details are displayed.\n\n**Owner:** Member services\n""",
        "docs/requirements/RB-002.md": """# Service notice\n\n- **RB-002** A service notice includes its effective date and owning team.\n\n**Status:** approved\n""",
        "docs/requirements/RB-003.md": """# Contact detail\n\n- **RB-003** A member may update a preferred email address from account settings.\n""",
        "docs/requirements/RB-004.md": """# Desk handoff\n\n- **RB-004** Staff can see the member's service-desk handoff note after sign-in.\n""",
        "docs/requirements/meeting-notes-2027-01.md": """# Service review notes — 22 January 2027\n\nAttendees: Mara Ivers, Jon Bell, Nia Rowe\n\n- Reviewed vocabulary for member-facing messages.\n- Agreed that approved requirements should name their source section.\n- Deferred a discussion about room services to the next product review.\n""",
        "docs/requirements/meeting-notes-2027-02.md": """# Service review notes — 12 February 2027\n\n- The service desk asked for shorter confirmation copy.\n- The portal team will keep the current account terminology.\n- Owners will publish a consolidated change note after review.\n""",
        "docs/operations/release-checklist.md": """# Release checklist\n\n- Verify the service status page.\n- Confirm the support rota.\n- Record the release date in the changelog.\n""",
        "docs/operations/incident-guide.md": """# Incident guide\n\nWhen a public service is unavailable, the duty owner records the start time, updates the status label, and tells the service desk.\n""",
        "data/branch-directory.json": """{\n  \"branches\": [\n    {\"code\": \"HBR\", \"name\": \"Harborview Central\"},\n    {\"code\": \"PINE\", \"name\": \"Pine Market\"},\n    {\"code\": \"EAST\", \"name\": \"East Quay\"}\n  ]\n}\n""",
        "data/sample-member.json": """{\n  \"memberId\": \"M-1842\",\n  \"displayName\": \"Sam Vale\",\n  \"emailVerified\": true\n}\n""",
        "notes/decision-log.md": """# Decision log\n\n| Date | Decision | Owner |\n| --- | --- | --- |\n| 2027-01-08 | Keep member-facing service names in sentence case | Content |\n| 2027-02-03 | Store status events in local time | Platform |\n""",
        "notes/content-review.md": """# Content review\n\nThe next copy review will check labels, punctuation, and translation notes. This file is a reminder rather than a source of product policy.\n""",
        "docs/archive/old-portal-notes.md": """# Old portal notes\n\nThese notes describe the portal before the current sign-in flow. They remain for historical context and should not be used as current policy.\n""",
    }
    for rel, text in files.items():
        write(FIXTURE / rel, text)
    make_docx(FIXTURE / "inbox/room-booking-spec-v3.docx")


if __name__ == "__main__":
    build_fixture()
    print(f"wrote fixture at {FIXTURE}")
