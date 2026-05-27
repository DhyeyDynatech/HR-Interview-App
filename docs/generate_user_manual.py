#!/usr/bin/env python3
"""
Generates the HR Interview App — Recruiter & Admin User Manual (.docx).

Run:  python docs/generate_user_manual.py
Output: docs/HR-Interviewer-User-Manual.docx

The manual is written for recruiters and administrators (the authenticated
dashboard side of the app). Screenshots are left as clearly-marked placeholder
boxes that you can replace by capturing the live app — every box tells you
exactly which screen to open and what to highlight.
"""

from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# ---------------------------------------------------------------------------
# Brand palette
# ---------------------------------------------------------------------------
INDIGO = RGBColor(0x4F, 0x46, 0xE5)
INDIGO_DARK = RGBColor(0x37, 0x30, 0xA3)
BLACK = RGBColor(0x11, 0x11, 0x11)
GREY = RGBColor(0x55, 0x55, 0x55)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

SHADE_SCREENSHOT = "EEF0FB"  # light indigo
SHADE_TIP = "E8F5E9"         # light green
SHADE_NOTE = "E7F0FE"        # light blue
SHADE_WARN = "FDECEA"        # light red
SHADE_BEST = "FFF7E6"        # light amber
SHADE_HEADER = "4F46E5"      # indigo header fill

FIG_COUNTER = {"n": 0}

# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def set_cell_background(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def set_cell_border(cell, color="C9CEF5", sz="8", left_accent=None):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        if left_accent and edge == "left":
            el.set(qn("w:sz"), "36")
            el.set(qn("w:color"), left_accent)
        else:
            el.set(qn("w:sz"), sz)
            el.set(qn("w:color"), color)
        el.set(qn("w:space"), "0")
        borders.append(el)
    tcPr.append(borders)


def shade_paragraph(paragraph, hex_color):
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    pPr.append(shd)


def add_bottom_border(paragraph, color="4F46E5", sz="12"):
    pPr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), sz)
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    pPr.append(pbdr)


# ---------------------------------------------------------------------------
# Content helpers
# ---------------------------------------------------------------------------

def h1(doc, text):
    doc.add_page_break()
    p = doc.add_heading(text, level=1)
    for r in p.runs:
        r.font.color.rgb = INDIGO
    add_bottom_border(p)
    return p


def h2(doc, text):
    p = doc.add_heading(text, level=2)
    for r in p.runs:
        r.font.color.rgb = INDIGO_DARK
    return p


def h3(doc, text):
    p = doc.add_heading(text, level=3)
    for r in p.runs:
        r.font.color.rgb = BLACK
    return p


def body(doc, text, italic=False, size=11):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text)
    run.italic = italic
    run.font.size = Pt(size)
    return p


def lead(doc, lead_text, rest):
    """Paragraph with a bold lead-in label followed by normal text."""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(lead_text)
    r.bold = True
    p.add_run(rest)
    return p


def bullet(doc, text, bold_label=None):
    p = doc.add_paragraph(style="List Bullet")
    if bold_label:
        r = p.add_run(bold_label)
        r.bold = True
    p.add_run(text)
    return p


def steps(doc, items):
    """Manually-numbered steps with a hanging indent (reliable across Word)."""
    for i, item in enumerate(items, start=1):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent = Inches(0.3)
        pf.first_line_indent = Inches(-0.3)
        pf.space_after = Pt(5)
        r = p.add_run(f"{i}.  ")
        r.bold = True
        r.font.color.rgb = INDIGO
        if isinstance(item, tuple):
            lbl = p.add_run(item[0])
            lbl.bold = True
            p.add_run(item[1])
        else:
            p.add_run(item)


def callout(doc, kind, text):
    palette = {
        "TIP": (SHADE_TIP, "2E7D32", "💡 Tip"),
        "NOTE": (SHADE_NOTE, "1565C0", "ℹ Note"),
        "WARNING": (SHADE_WARN, "C62828", "⚠ Important"),
        "BEST": (SHADE_BEST, "B8860B", "★ Best Practice"),
    }
    fill, accent, label = palette[kind]
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    set_cell_background(cell, fill)
    set_cell_border(cell, color=fill, left_accent=accent)
    cell.paragraphs[0].text = ""
    lp = cell.paragraphs[0]
    lr = lp.add_run(label)
    lr.bold = True
    lr.font.size = Pt(10.5)
    lr.font.color.rgb = RGBColor.from_string(accent)
    bp = cell.add_paragraph()
    br = bp.add_run(text)
    br.font.size = Pt(10.5)
    bp.paragraph_format.space_after = Pt(2)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def screenshot(doc, caption, where, highlight):
    """Insert a labelled screenshot placeholder box."""
    FIG_COUNTER["n"] += 1
    n = FIG_COUNTER["n"]
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    set_cell_background(cell, SHADE_SCREENSHOT)
    set_cell_border(cell, color="9AA4E8")

    p0 = cell.paragraphs[0]
    p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r0 = p0.add_run(f"📷  SCREENSHOT {n}")
    r0.bold = True
    r0.font.size = Pt(11)
    r0.font.color.rgb = INDIGO_DARK

    pc = cell.add_paragraph()
    pc.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rc = pc.add_run(caption)
    rc.bold = True
    rc.font.size = Pt(10.5)

    pw = cell.add_paragraph()
    pw.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rw = pw.add_run(f"Where to capture: {where}")
    rw.font.size = Pt(9.5)
    rw.font.color.rgb = GREY

    ph = cell.add_paragraph()
    ph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rh = ph.add_run(f"Highlight / show: {highlight}")
    rh.italic = True
    rh.font.size = Pt(9.5)
    rh.font.color.rgb = GREY
    ph.paragraph_format.space_after = Pt(4)

    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return n


def add_toc(doc):
    """Insert a Word Table-of-Contents field (right-click > Update Field in Word)."""
    p = doc.add_paragraph()
    run = p.add_run()
    fldChar1 = OxmlElement("w:fldChar")
    fldChar1.set(qn("w:fldCharType"), "begin")
    instrText = OxmlElement("w:instrText")
    instrText.set(qn("xml:space"), "preserve")
    instrText.text = 'TOC \\o "1-3" \\h \\z \\u'
    fldChar2 = OxmlElement("w:fldChar")
    fldChar2.set(qn("w:fldCharType"), "separate")
    t = OxmlElement("w:t")
    t.text = "Right-click here and choose “Update Field” to build the table of contents."
    fldChar2.append(t)
    fldChar3 = OxmlElement("w:fldChar")
    fldChar3.set(qn("w:fldCharType"), "end")
    run._r.append(fldChar1)
    run._r.append(instrText)
    run._r.append(fldChar2)
    run._r.append(fldChar3)


def add_page_numbers(doc):
    section = doc.sections[0]
    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run("HR Interview App — Recruiter & Admin User Manual   |   Page ").font.size = Pt(8)
    run = p.add_run()
    run.font.size = Pt(8)
    fld1 = OxmlElement("w:fldChar"); fld1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve"); instr.text = "PAGE"
    fld2 = OxmlElement("w:fldChar"); fld2.set(qn("w:fldCharType"), "end")
    run._r.append(fld1); run._r.append(instr); run._r.append(fld2)


# ---------------------------------------------------------------------------
# Document setup
# ---------------------------------------------------------------------------

def build():
    doc = Document()

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.font.color.rgb = BLACK

    # ---- Cover page -------------------------------------------------------
    for _ in range(3):
        doc.add_paragraph()
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    tr = t.add_run("HR INTERVIEW APP")
    tr.bold = True
    tr.font.size = Pt(40)
    tr.font.color.rgb = INDIGO

    s = doc.add_paragraph()
    s.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sr = s.add_run("Recruiter & Administrator User Manual")
    sr.font.size = Pt(20)
    sr.font.color.rgb = BLACK

    tag = doc.add_paragraph()
    tag.alignment = WD_ALIGN_PARAGRAPH.CENTER
    tagr = tag.add_run("AI-powered Interview Management System")
    tagr.italic = True
    tagr.font.size = Pt(13)
    tagr.font.color.rgb = GREY

    for _ in range(8):
        doc.add_paragraph()

    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for line, bold in [
        ("DynaTech Systems", True),
        ("Document version 1.0", False),
        ("Audience: Recruiters & Administrators", False),
        ("Last updated: May 2026", False),
    ]:
        r = meta.add_run(line + "\n")
        r.bold = bold
        r.font.size = Pt(12 if bold else 10.5)
        r.font.color.rgb = INDIGO_DARK if bold else GREY

    # ---- Table of contents ------------------------------------------------
    doc.add_page_break()
    p = doc.add_heading("Table of Contents", level=1)
    for r in p.runs:
        r.font.color.rgb = INDIGO
    add_bottom_border(p)
    add_toc(doc)

    add_page_numbers(doc)

    # ======================================================================
    # 1. INTRODUCTION
    # ======================================================================
    h1(doc, "1. Introduction")

    h2(doc, "1.1 What is the HR Interview App?")
    body(doc, "The HR Interview App is an AI-powered interview management platform. It lets your "
              "recruitment team create AI-driven voice interviews, invite candidates by email, and then "
              "automatically score, transcribe, and analyse each candidate's responses. Beyond the live "
              "interview, the platform also screens résumés against a job description (ATS Scoring), "
              "discovers the companies candidates have worked at (Company Finder), tracks usage costs, and "
              "gives you a single dashboard to manage your whole hiring funnel.")
    body(doc, "This manual covers the recruiter- and administrator-facing side of the product — everything "
              "you do after signing in to the dashboard. The candidate's own interview experience (joining a "
              "call, camera/microphone checks, face verification) is delivered through a separate public link "
              "and is outside the scope of this manual.")

    h2(doc, "1.2 Who should read this manual")
    bullet(doc, "Recruiters who create interviews, invite candidates, and review results.", "Recruiters — ")
    bullet(doc, "Hiring managers who review shortlists and candidate scores.", "Managers — ")
    bullet(doc, "Administrators who manage users, costs, and the advanced screening tools.", "Administrators — ")

    h2(doc, "1.3 Key terms used in this manual")
    terms = [
        ("Interview", "A reusable AI interview definition — a name, an AI interviewer, an objective, and a set of questions. Candidates are invited to take it."),
        ("AI Interviewer", "The voice persona (voice, language, gender) that conducts the conversation with the candidate."),
        ("Candidate / Assignee", "A person you have added to the system and can assign to an interview. Managed on the Users page."),
        ("Response", "One candidate's completed interview attempt — including the recording, transcript, scores, and anti-cheat findings."),
        ("ATS Scoring", "Automated résumé scoring against a job description, producing a ranked candidate list."),
        ("Company Finder", "An admin tool that extracts and enriches the companies found in candidate résumés."),
        ("Violation", "An anti-cheat event captured during the candidate's interview (e.g. tab switching, extra people detected)."),
    ]
    for name, desc in terms:
        lead(doc, f"{name}: ", desc)

    callout(doc, "NOTE", "The dashboard is designed for desktop use. If you open the sign-in page on a phone "
                         "you will see a message asking you to use a PC for the best experience.")

    # ======================================================================
    # 2. GETTING STARTED
    # ======================================================================
    h1(doc, "2. Getting Started")

    h2(doc, "2.1 Signing in")
    steps(doc, [
        "Open the application URL in a desktop browser (Google Chrome or Microsoft Edge are recommended).",
        ("Enter your email and password. ", "Use the credentials provided by your administrator."),
        "Click the eye icon inside the password field if you want to confirm what you typed.",
        ("Click ", "Sign In. On success you are taken to the Dashboard overview."),
    ])
    screenshot(doc, "The sign-in screen",
               "The sign-in page (the app's home URL when signed out).",
               "The email field, password field, the show/hide eye icon, the “Forgot password?” link, and the Sign In button.")

    h2(doc, "2.2 Resetting a forgotten password")
    steps(doc, [
        ("On the sign-in screen, click ", "Forgot password?"),
        "Enter your email address in the Reset Password dialog.",
        ("Click ", "Send Reset Link. If the email exists, a reset link is sent to that address."),
        "Open the email and follow the link to choose a new password.",
    ])
    screenshot(doc, "The Reset Password dialog",
               "Sign-in page → click “Forgot password?”.",
               "The email input and the Send Reset Link / Cancel buttons.")

    h2(doc, "2.3 The dashboard layout")
    body(doc, "Once signed in, every screen shares the same frame:")
    bullet(doc, "the DynaTech logo (click it to return to your interviews) and your profile avatar.", "Top bar — ")
    bullet(doc, "Dashboard, Interviews, Interviewers, Users, ATS Scoring, and — depending on your role — Company Finder and Cost & Analysis.", "Left side menu — ")
    bullet(doc, "click your avatar (top-right) to open Profile or to Sign Out.", "User menu — ")
    screenshot(doc, "The main dashboard frame",
               "Any page after signing in, e.g. /dashboard/overview.",
               "The black top bar with logo + avatar, and the left navigation menu with all of its items.")

    h2(doc, "2.4 User roles and what each can access")
    body(doc, "Your role controls which menu items you can open. The table below summarises access to the "
              "role-restricted areas; all other areas are available to every role.")
    rt = doc.add_table(rows=1, cols=3)
    rt.style = "Light Grid Accent 1"
    hdr = rt.rows[0].cells
    for i, txt in enumerate(["Role", "Company Finder", "Cost & Analysis"]):
        hdr[i].paragraphs[0].add_run(txt).bold = True
    role_rows = [
        ("Admin", "Yes", "Yes"),
        ("Manager", "No", "Yes"),
        ("Interviewer", "No", "Yes"),
        ("Viewer", "No", "Yes"),
        ("Marketing", "No", "No"),
        ("HR Consultant", "No", "No"),
    ]
    for r in role_rows:
        cells = rt.add_row().cells
        for i, v in enumerate(r):
            cells[i].paragraphs[0].add_run(v)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    callout(doc, "NOTE", "Company Finder is restricted to Administrators. Cost & Analysis is hidden from the "
                         "Marketing and HR Consultant roles. If you cannot see a menu item described in this "
                         "manual, your role does not have access to it.")

    # ======================================================================
    # 3. DASHBOARD OVERVIEW
    # ======================================================================
    h1(doc, "3. Dashboard Overview")
    body(doc, "The Dashboard (the first screen after sign-in) gives you a live snapshot of your hiring "
              "pipeline. Open it any time from the Dashboard item at the top of the left menu.")

    h2(doc, "3.1 Top statistics")
    body(doc, "Five cards summarise your activity. Click a card to jump straight to the matching screen:")
    bullet(doc, "total number of interviews, with how many are active vs. paused.", "Total Interviews — ")
    bullet(doc, "everyone added on the Users page.", "Total Candidates — ")
    bullet(doc, "responses that have been captured, with a completion-rate percentage.", "Completed Interviews — ")
    bullet(doc, "invitations sent but not yet completed.", "Pending Responses — ")
    bullet(doc, "candidates marked Selected, with a selection-rate percentage.", "Selected Candidates — ")

    h2(doc, "3.2 Interview funnel and candidate status")
    body(doc, "The Interview Funnel Overview shows candidates flowing through five stages — Invited → "
              "Completed → Reviewed → Shortlisted → Selected — plus a Rejected count. The Candidate Status "
              "panel beside it lets you click any stage to open the Users page already filtered to that group.")
    screenshot(doc, "Dashboard overview — stats and funnel",
               "Dashboard (left menu → Dashboard).",
               "The five stat cards across the top, the colourful funnel bar, and the Candidate Status list.")

    h2(doc, "3.3 Recent activity, costs, and quick actions")
    bullet(doc, "your three newest interviews; click one to open it.", "Recent Interviews — ")
    bullet(doc, "the three most recently updated candidates.", "Recent Candidates — ")
    bullet(doc, "this month's and today's spend, with a link to full Cost & Analysis.", "Cost & Usage Snapshot — ")
    bullet(doc, "one-click shortcuts: New Interview, Invite Candidates, View Reports, Configure AI Interviewer, Cost Analysis.", "Alerts & Quick Actions — ")
    screenshot(doc, "Dashboard overview — activity and quick actions",
               "Dashboard, lower section.",
               "The Recent Interviews, Recent Candidates and Cost & Usage Snapshot cards, plus the Quick Actions row.")

    # ======================================================================
    # 4. MANAGING INTERVIEWS
    # ======================================================================
    h1(doc, "4. Managing Interviews")

    h2(doc, "4.1 The Interviews page")
    body(doc, "Click Interviews in the left menu to see every interview you have created. From here you can:")
    bullet(doc, "find an interview by name using the search box.", "Search — ")
    bullet(doc, "switch between the card grid and a compact list using the view toggle.", "Grid / List view — ")
    bullet(doc, "open the creation wizard with the Create Interview button.", "Create Interview — ")
    bullet(doc, "click any interview card to open its detail page (responses, sharing, settings).", "Open — ")
    screenshot(doc, "The Interviews list",
               "Left menu → Interviews.",
               "The search box, the grid/list toggle, the Create Interview button, and a few interview cards.")

    h2(doc, "4.2 Creating an interview — Step 1: details")
    body(doc, "Click Create Interview to open the two-step wizard. On the first step you provide:")
    steps(doc, [
        ("Interview Name ", "— a clear title, e.g. “Senior .NET Developer — Screening”."),
        ("Select an Interviewer ", "— click an AI interviewer's photo to choose its voice. Click the small info (i) icon to preview voice, provider and language details."),
        ("Objective ", "— describe what you want to assess, e.g. “Evaluate technical depth in C# and past project ownership.”"),
        ("Upload documents (optional) ", "— attach a job description or reference document so the AI can generate more relevant questions."),
        ("Number of Questions ", "— between 1 and 10."),
        ("Duration (mins) ", "— the time limit for the interview, between 1 and 20 minutes."),
    ])
    body(doc, "Then choose how the questions are created:")
    bullet(doc, "the AI drafts questions for you based on the objective and any uploaded document.", "Generate Questions — ")
    bullet(doc, "start with a blank question you fill in yourself.", "I'll do it myself — ")
    callout(doc, "TIP", "Uploading a job description before clicking Generate Questions produces noticeably "
                        "sharper, role-specific questions. You can still edit every generated question on the next step.")
    screenshot(doc, "Create Interview — details step",
               "Interviews → Create Interview.",
               "The name field, the row of selectable interviewer photos, the objective box, the file upload area, the question-count and duration fields, and the two action buttons.")

    h2(doc, "4.3 Creating an interview — Step 2: questions")
    steps(doc, [
        "Review the auto-generated Description and edit it if needed.",
        "Review each question card. Edit the wording directly in the card.",
        ("Use ", "Add Question to add more (up to the number you chose), or the delete icon on a card to remove one."),
        ("Click ", "Save Interview. The interview now appears on your Interviews page."),
    ])
    screenshot(doc, "Create Interview — questions step",
               "Second step of the Create Interview wizard.",
               "The Description box, the numbered question cards, the Add Question button, and the Save Interview button.")
    callout(doc, "NOTE", "Save Interview stays disabled until every question has text. The Add Question button "
                         "is limited to the number of questions you selected on the first step.")

    h2(doc, "4.4 The interview detail page")
    body(doc, "Clicking an interview opens its detail page. The toolbar at the top contains, from left to right:")
    bullet(doc, "copy or open the candidate link to send to applicants.", "Share (↗ icon) — ")
    bullet(doc, "open the candidate-facing interview page in a new tab to see what applicants see.", "Preview (eye icon) — ")
    bullet(doc, "change the accent colour candidates see on the interview page.", "Theme colour (palette icon) — ")
    bullet(doc, "change the interview's questions and settings.", "Edit (pencil icon) — ")
    bullet(doc, "switch the interview on or off. While paused, candidates cannot start it.", "Active toggle — ")
    body(doc, "The left column lists every response; the large area on the right shows the Overall Analysis "
              "summary (see Section 6) or, when you click a response, that candidate's full detail.")
    screenshot(doc, "Interview detail page",
               "Interviews → click any interview.",
               "The top toolbar (Share, Preview, Theme, Edit, Active toggle), the response list on the left, and the analysis summary on the right.")

    h2(doc, "4.5 Sharing an interview with candidates")
    body(doc, "There are two ways to get candidates into an interview:")
    bullet(doc, "use the Share button to copy the public interview link and send it yourself.", "Share link — ")
    bullet(doc, "add candidates on the Users page, assign them to this interview, then send invitation emails in bulk (see Section 7).", "Invite by email — ")
    screenshot(doc, "Share interview popup",
               "Interview detail page → Share icon.",
               "The shareable link and the copy button.")

    # ======================================================================
    # 5. THE AI INTERVIEWERS
    # ======================================================================
    h1(doc, "5. The AI Interviewers")
    body(doc, "Click Interviewers in the left menu to browse the AI interviewer personas available to your "
              "organisation. Each card shows the interviewer's name and photo. Click a card to open its details — "
              "voice, language, provider and a short description. You select one of these personas when creating "
              "an interview (Section 4.2).")
    screenshot(doc, "The Interviewers gallery",
               "Left menu → Interviewers.",
               "The horizontal row of interviewer cards and the left/right scroll arrows.")
    screenshot(doc, "Interviewer details",
               "Interviewers → click an interviewer card.",
               "The interviewer's voice, language, gender/provider details and description.")

    # ======================================================================
    # 6. REVIEWING RESPONSES
    # ======================================================================
    h1(doc, "6. Reviewing Candidate Responses")

    h2(doc, "6.1 The Overall Analysis summary")
    body(doc, "Open an interview and, with no individual response selected, the right-hand area shows the "
              "Overall Analysis for all responses:")
    bullet(doc, "a sortable table of every candidate with their overall score, communication score, and a short call summary.", "Results table — ")
    bullet(doc, "the average time candidates took to complete the interview.", "Average Duration — ")
    bullet(doc, "the percentage of interviews completed successfully.", "Interview Completion Rate — ")
    bullet(doc, "a pie chart of Positive / Neutral / Negative sentiment.", "Candidate Sentiment — ")
    bullet(doc, "a pie chart of Selected / Potential / Not Selected / To Be Reviewed.", "Candidate Status — ")
    screenshot(doc, "Overall Analysis summary",
               "Interview detail page (no response selected).",
               "The results table, the Average Duration & Completion Rate cards, and the two pie charts.")

    h2(doc, "6.2 Filtering and opening a response")
    steps(doc, [
        ("Use the ", "Filter By dropdown above the response list to show only To Be Reviewed, Not Selected, Potential, or Selected candidates."),
        "Click a candidate in the list to open their full response. A coloured dot shows their current status, and unread responses are flagged.",
    ])

    h2(doc, "6.3 Inside an individual response")
    body(doc, "A single response gives you everything you need to evaluate the candidate:")
    bullet(doc, "play back the candidate's interview audio, adjust playback speed/volume, and download the recording.", "Interview Recording — ")
    bullet(doc, "a circular overall score for the interview.", "Overall Score — ")
    bullet(doc, "a dedicated communication score.", "Communication — ")
    bullet(doc, "an accordion of each question paired with the candidate's answer.", "Transcript Summary — ")
    bullet(doc, "the complete, speaker-labelled conversation transcript.", "Transcript — ")
    bullet(doc, "anti-cheat findings such as tab switches, multiple people detected, or a blocked camera (see Section 6.4).", "Violations — ")
    bullet(doc, "set the candidate's status (Selected, Potential, Not Selected, To Be Reviewed); this syncs to the candidate on the Users page.", "Candidate status dropdown — ")
    bullet(doc, "permanently remove the response (asks for confirmation).", "Delete — ")
    screenshot(doc, "Individual candidate response",
               "Interview detail page → click a candidate in the response list.",
               "The audio player + download, the overall and communication scores, the candidate-status dropdown, and the transcript area.")

    h2(doc, "6.4 Anti-cheat / integrity findings")
    body(doc, "During the interview the platform monitors for integrity issues and records them on the "
              "response. In the response view you may see flags for tab/window switching, additional people "
              "detected on camera, a blocked or disabled camera, and similar events. Use these alongside the "
              "scores when deciding a candidate's status.")
    callout(doc, "BEST", "Treat integrity flags as context, not an automatic disqualification — a single brief "
                         "tab switch is very different from repeated switching or multiple people on camera. "
                         "Read the detail before changing a candidate's status.")

    h2(doc, "6.5 Setting a candidate's status")
    steps(doc, [
        "Open the candidate's response.",
        ("Choose a status from the dropdown: ", "Selected, Potential, Not Selected, or To Be Reviewed."),
        "The status is saved immediately and is reflected on the Dashboard funnel, the interview pie charts, and the candidate's card on the Users page.",
    ])

    # ======================================================================
    # 7. MANAGING CANDIDATES (USERS)
    # ======================================================================
    h1(doc, "7. Managing Candidates (Users)")
    body(doc, "Click Users in the left menu to manage everyone who can be assigned an interview. The page is "
              "titled Interview Assignees.")

    h2(doc, "7.1 Overview of the Users page")
    bullet(doc, "Total, Interview Completed, and Interview Pending counts.", "Stat cards — ")
    bullet(doc, "by name, email, tag, or candidate ID.", "Search — ")
    bullet(doc, "by status, by interview, by department/tag, and by review status.", "Filters — ")
    bullet(doc, "switch between card Grid and a detailed table List. Candidates are grouped by the interview they are assigned to.", "Grid / List — ")
    screenshot(doc, "The Users (Assignees) page",
               "Left menu → Users.",
               "The Import/Export/Add buttons, the three stat cards, the search + filter row, and the grouped candidate cards.")

    h2(doc, "7.2 Adding a single candidate")
    steps(doc, [
        ("Click ", "Add Assignee (top-right)."),
        ("Fill in the form. ", "First Name, Last Name and Email are required; Phone, Candidate ID, Interview, Profile Image, Résumé/CV, Status, Department/Tag and Notes are optional."),
        ("Optionally attach a résumé ", "(PDF or Word, max 10 MB) and a profile photo (image, max 5 MB)."),
        ("Click ", "Create Assignee."),
    ])
    screenshot(doc, "Add Assignee form",
               "Users → Add Assignee.",
               "The first/last name, email, candidate ID, interview selector, image and résumé upload areas, status, tag and notes fields.")
    callout(doc, "NOTE", "Emails must be unique. If you enter an email — or upload a résumé containing an email — "
                         "that already exists, the app warns you about the duplicate and does not create a second record.")

    h2(doc, "7.3 Importing many candidates from a CSV file")
    steps(doc, [
        ("Click ", "Import CSV (top-right)."),
        ("Click ", "Download Template to get a correctly-formatted sample file (columns: email, first_name, last_name, phone, status, notes)."),
        "Fill the template with your candidates and save it as CSV.",
        "Drag the file onto the upload area, or click to browse. The app previews the first rows and the total count.",
        ("Click ", "Import N User(s). When it finishes you see a Successful / Failed summary and a list of any rows that errored."),
    ])
    screenshot(doc, "Bulk import from CSV",
               "Users → Import CSV.",
               "The Download Template banner, the drag-and-drop upload area, and the preview table.")
    callout(doc, "NOTE", "You can import up to 1,000 candidates at once. Each row needs a valid, unique email; "
                         "rows with missing or duplicate emails are skipped and listed in the results.")

    h2(doc, "7.4 Bulk actions")
    body(doc, "Select candidates using the checkboxes (individually, by interview group, or Select All). A blue "
              "action bar appears with these options:")
    bullet(doc, "send the interview invitation email to the selected candidates (they must have an interview assigned).", "Send Email — ")
    bullet(doc, "update the review status of all selected candidates at once.", "Change Status — ")
    bullet(doc, "assign the selected candidates to an interview.", "Assign Interview — ")
    bullet(doc, "apply a department/tag to the selection.", "Assign Tag — ")
    bullet(doc, "remove the selected candidates (asks for confirmation).", "Delete — ")
    screenshot(doc, "Bulk actions bar",
               "Users page → tick one or more candidate checkboxes.",
               "The blue bar showing the selection count and the Send Email, Change Status, Assign Interview, Assign Tag and Delete buttons.")

    h2(doc, "7.5 Sending interview invitations")
    steps(doc, [
        "Make sure each candidate has an interview assigned (use Add/Edit, or the Assign Interview bulk action).",
        "Select the candidates you want to invite.",
        ("Click ", "Send Email in the blue action bar."),
        "Each candidate receives an email with their personal link to start the interview.",
    ])
    callout(doc, "WARNING", "Send Email only works for candidates who have both an interview assigned and a valid "
                            "email address. Candidates without an assigned interview are skipped.")

    h2(doc, "7.6 Viewing details and exporting")
    bullet(doc, "open a candidate's View dialog to see their full profile and a link to their interview response (if they have taken it).", "View — ")
    bullet(doc, "change any of the candidate's fields.", "Edit — ")
    bullet(doc, "download the currently-filtered candidate list as a CSV file.", "Export CSV — ")
    screenshot(doc, "Assignee details dialog",
               "Users page → View on a candidate card.",
               "The candidate's name, email, phone, status, interview assignment, tag, notes, and the View Interview Details link.")

    # ======================================================================
    # 8. ATS RESUME SCORING
    # ======================================================================
    h1(doc, "8. ATS Résumé Scoring")
    body(doc, "ATS Scoring screens a pile of résumés against a job description and ranks the candidates. Open it "
              "from ATS Scoring in the left menu.")

    h2(doc, "8.1 Choosing a job")
    body(doc, "The first screen is a grid of scoring jobs. Each job is tied to one of your interviews so its "
              "results, job description and résumés stay together.")
    steps(doc, [
        ("Click ", "Add Job (or the equivalent control) and pick one or more interviews to create scoring jobs for them."),
        "Click a job card to open its scoring workspace.",
        "Use the remove control on a card to delete a job you no longer need.",
    ])
    screenshot(doc, "ATS Scoring — job grid",
               "Left menu → ATS Scoring.",
               "The grid of job cards and the control for adding a new job.")

    h2(doc, "8.2 Providing the job description")
    bullet(doc, "paste the job description straight into the text box.", "Text mode — ")
    bullet(doc, "upload the job description as a PDF or Word file and let the app extract the text.", "PDF / Word mode — ")
    body(doc, "The job description is saved automatically as you work.")

    h2(doc, "8.3 Uploading résumés and analysing")
    steps(doc, [
        "Drag-and-drop résumé files onto the upload area, or use the folder picker to add an entire folder. PDF, DOC and DOCX are supported (max 10 MB each).",
        "Wait for the files to be parsed — a progress indicator shows how many are done.",
        ("Click ", "Analyze. The résumés are queued and scored in the background; a progress bar tracks completion. You can navigate away and come back — the job keeps running."),
    ])
    screenshot(doc, "ATS Scoring — job description and résumé upload",
               "ATS Scoring → open a job.",
               "The Text/PDF job-description toggle, the résumé drag-and-drop area, and the Analyze button.")
    callout(doc, "TIP", "You can keep adding résumés to the same job over time. Résumés that have already been "
                        "scored are skipped, so only new files are analysed when you click Analyze again.")

    h2(doc, "8.4 Reading the results")
    body(doc, "Results appear as ranked candidate cards, best match first. Each card includes:")
    bullet(doc, "an overall match score and category scores (skills, experience, education, keywords).", "Scores — ")
    bullet(doc, "matched skills, missing skills, strengths, and suggested interview focus areas.", "Skill analysis — ")
    bullet(doc, "current role/company, total experience, education, certifications and location.", "Candidate profile — ")
    bullet(doc, "a strengths / weaknesses / opportunities / risks breakdown with a final hiring insight.", "SWOT analysis — ")
    bullet(doc, "open the original résumé with the eye icon.", "Résumé viewer — ")
    screenshot(doc, "ATS Scoring — results",
               "ATS Scoring job after analysis completes.",
               "The ranked candidate cards with scores, matched/missing skills, and the candidate profile / SWOT sections.")

    h2(doc, "8.5 Exporting and creating candidates automatically")
    bullet(doc, "download the full ranked analysis (scores, profile, SWOT and more) as a CSV file.", "Export CSV — ")
    bullet(doc, "qualifying candidates are automatically added to your Users list (those who clear the minimum score and meet the experience requirement), ready to be assigned an interview and invited.", "Auto-create assignees — ")
    callout(doc, "NOTE", "Candidates whose experience does not match the job requirement, or who score below the "
                         "minimum threshold, are not added automatically. You can still add them manually if you wish.")

    # ======================================================================
    # 9. COMPANY FINDER
    # ======================================================================
    h1(doc, "9. Company Finder (Administrators only)")
    body(doc, "Company Finder analyses the work history in candidate résumés and builds an enriched list of the "
              "companies they have worked at — including company type, headquarters, founding year, technologies "
              "and the résumés each company came from. It is available only to Administrators.")
    body(doc, "Company Finder runs automatically after an ATS scoring job finishes (using the same résumés), and "
              "its results appear under the Companies tab of the scoring workspace. Administrators can also open "
              "the dedicated Company Finder page from the left menu.")
    h2(doc, "9.1 Working with company results")
    bullet(doc, "by company name.", "Search — ")
    bullet(doc, "by company type (service provider vs. service consumer) and sort by frequency or name.", "Filter — ")
    bullet(doc, "click the source-résumé badges to open the résumé a company was found in.", "Source résumés — ")
    bullet(doc, "download the company list (type, info, headquarters, countries, frequency, sources) as CSV.", "Export CSV — ")
    screenshot(doc, "Company Finder results",
               "Left menu → Company Finder (admin), or the Companies tab inside an ATS job.",
               "The list of discovered companies with their type, details, frequency, source-résumé badges, and the search/filter/export controls.")

    # ======================================================================
    # 10. COST & ANALYSIS
    # ======================================================================
    h1(doc, "10. Cost & Analysis")
    body(doc, "Cost & Analysis tracks what the platform spends across AI text models, voice calls, file storage, "
              "résumé parsing, ATS scoring and Company Finder. It is available to all roles except Marketing and "
              "HR Consultant. Open it from Cost & Analysis in the left menu.")

    h2(doc, "10.1 Summary cards")
    bullet(doc, "spend so far in the current calendar month.", "This Month banner — ")
    bullet(doc, "all spend in the selected period, with token and voice-minute totals.", "Total Cost — ")
    bullet(doc, "spend on AI text models plus web-search calls.", "GPT Cost — ")
    bullet(doc, "spend on the voice interview calls.", "Voice Cost — ")
    bullet(doc, "average spend per completed interview and per résumé (ATS and Company Finder).", "Averages — ")
    screenshot(doc, "Cost & Analysis — summary",
               "Left menu → Cost & Analysis.",
               "The monthly banner and the Total / GPT / Voice cost cards, plus the average-cost cards.")

    h2(doc, "10.2 Breakdown, filters and export")
    steps(doc, [
        "Review Cost by Category to see where money is going (interview creation, responses, insights, voice calls, uploads, ATS, Company Finder, résumé parsing).",
        ("Use the ", "Filters card to narrow by Start/End Date, Interview, or Category."),
        "Browse the usage table; click a row to expand it for token counts, durations and item-level details.",
        ("Click ", "Export CSV to download the data, or Refresh to reload it."),
    ])
    screenshot(doc, "Cost & Analysis — category breakdown and table",
               "Cost & Analysis, lower section.",
               "The Cost by Category tiles, the Filters card, and the expandable usage table.")

    # ======================================================================
    # 11. PROFILE & ACCOUNT
    # ======================================================================
    h1(doc, "11. Profile & Account Settings")
    body(doc, "Open your profile from the avatar menu (top-right) → Profile.")
    h2(doc, "11.1 Updating your profile")
    steps(doc, [
        ("Click ", "Upload Photo to set a profile picture (JPG/PNG/GIF, max 5 MB)."),
        "Update your First Name, Last Name and Phone Number. Your email address cannot be changed.",
        ("Click ", "Save Changes."),
    ])
    h2(doc, "11.2 Changing your password")
    steps(doc, [
        "Enter your current password.",
        "Enter a new password (at least 6 characters) and confirm it.",
        ("Click ", "Update Password."),
    ])
    body(doc, "The Account Information card shows your role, status, and the dates your account was created and "
              "last updated.")
    screenshot(doc, "Profile settings",
               "Avatar menu → Profile.",
               "The photo upload, the personal-information fields, the change-password form, and the account-information card.")

    # ======================================================================
    # 12. TROUBLESHOOTING & BEST PRACTICES
    # ======================================================================
    h1(doc, "12. Troubleshooting & Best Practices")

    h2(doc, "12.1 Recommended workflow")
    steps(doc, [
        ("Create an interview ", "with a clear objective and a job description so the AI generates strong questions."),
        ("(Optional) Run ATS Scoring ", "to shortlist résumés — qualifying candidates are added to your Users list automatically."),
        ("Add or import candidates ", "and assign them to the interview."),
        ("Send invitation emails ", "in bulk from the Users page."),
        ("Review responses ", "as they arrive, set each candidate's status, and watch the Dashboard funnel fill in."),
        ("Monitor spend ", "from time to time on the Cost & Analysis page."),
    ])

    h2(doc, "12.2 Common questions")
    faq = [
        ("A menu item is missing.",
         "Access depends on your role. Company Finder is admin-only, and Cost & Analysis is hidden from Marketing and HR Consultant roles."),
        ("A candidate did not receive their invitation.",
         "Confirm the candidate has an interview assigned and a valid email address — Send Email skips anyone missing either. Also ask them to check spam/junk."),
        ("The interview link does not start for a candidate.",
         "Check that the interview's Active toggle is on. While an interview is paused, candidates cannot start it."),
        ("Some résumés were skipped during ATS scoring.",
         "Files over 10 MB, unsupported formats, or résumés that could not be read are skipped and listed after parsing. Re-save them as a clean PDF and upload again."),
        ("My CSV import reported failures.",
         "Open the results list — each failed row shows the reason (usually a missing or duplicate email). Fix those rows and import again."),
        ("The mobile sign-in shows an “under construction” message.",
         "The dashboard is built for desktop. Sign in from a PC using Chrome or Edge."),
    ]
    for q, a in faq:
        lead(doc, f"Q: {q} ", "")
        body(doc, "A: " + a)

    callout(doc, "BEST", "Set a candidate's status as soon as you finish reviewing their response. Keeping statuses "
                         "current keeps the Dashboard funnel, the interview pie charts, and your shortlists accurate "
                         "for everyone on the team.")

    # ======================================================================
    # 13. GLOSSARY
    # ======================================================================
    h1(doc, "13. Glossary")
    glossary = [
        ("Active toggle", "The on/off switch on an interview. When off, candidates cannot start the interview."),
        ("Assignee", "A candidate record on the Users page that can be assigned to an interview."),
        ("ATS Scoring", "Automated résumé scoring against a job description, producing a ranked candidate list."),
        ("Company Finder", "Admin-only tool that extracts and enriches the companies found in candidate résumés."),
        ("Department / Tag", "A free-text label used to group candidates (e.g. Frontend, Senior)."),
        ("Interviewer", "The AI voice persona that conducts an interview."),
        ("Response", "A single completed interview attempt by one candidate."),
        ("Review status", "A candidate's evaluation outcome: Selected, Potential, Not Selected, or To Be Reviewed."),
        ("SWOT", "Strengths, Weaknesses, Opportunities and Risks — part of the ATS candidate analysis."),
        ("Violation", "An integrity/anti-cheat event recorded during a candidate's interview."),
    ]
    for term, desc in glossary:
        lead(doc, f"{term}: ", desc)

    # ======================================================================
    # 14. APPENDIX — SCREENSHOT CHECKLIST
    # ======================================================================
    h1(doc, "14. Appendix — Screenshot Checklist")
    body(doc, "This manual contains numbered screenshot placeholders. Capture each one from the live app and "
              "replace the matching placeholder box. The list below is your capture checklist — the screenshot "
              "numbers correspond to the boxes throughout the document.")
    body(doc, f"Total placeholders to capture: {FIG_COUNTER['n']}.", italic=True)
    callout(doc, "TIP", "Capture screenshots at a consistent browser width (around 1440 px) with the same zoom "
                        "level so the images look uniform. Blur or use test data for any real candidate names and "
                        "email addresses before sharing the finished manual.")

    doc.save("docs/HR-Interviewer-User-Manual.docx")
    print(f"Saved docs/HR-Interviewer-User-Manual.docx with {FIG_COUNTER['n']} screenshot placeholders.")


if __name__ == "__main__":
    build()
