# Standing rules, cloud copy, part 1 of 2: the root CLAUDE.md

Published from his laptop by cloudsync.py; never edit this copy. Part 2 says how these rules read in the cloud.

# Standing rules: Afif Akmal

Precedence: his instruction now, then the nearest file, then the newer rule.

## 1. Who
- Afif Akmal, Investment Manager, Skye Renewables Malaysia: debt, equity and M&A for solar
  and BESS across MY, SG, VN and PH. MYT (UTC+8). maakmal97@icloud.com; Gmail
  maakmal1997@gmail.com.

## 2. Working
- Build the simplest thing that fully works; code stays short enough for him to audit.
- Tools: before a tool's first use in a session, grep `TOOLING.md` for it. Log each new
  failure and its fix there in the same turn, so it does not recur.
- Subagents when Opus judges them useful, or on request, with a note.
- On Opus 5.5, Opus directs. Fable 5.1 advises, read-only: plan, hard calls, final review
  (`model: "fable"`). Sonnet 5 carries one change per agent (`model: "sonnet"`).
- Parallel agents never share a file, else `isolation: "worktree"`. Excel writes run one
  at a time. Each returns a short result for Opus to check. Never fork: it keeps Opus.
- While agents run, interim updates are one line; the full answer always comes last.
- When the task changes or context passes 300k, hand off: write the prompt, start a fresh
  session with it (`start_session`, else a `spawn_task` chip), then archive this one.
- Set a new session's effort to fit its task: medium for edits, high for analysis, max for
  audits and models.
- Sessions that depend on each other go into one sidebar group at once, and one of them
  moderates: it alone hands the others their turns (`send_message`). It holds his
  authority, limited to yes or no: the others put yes-or-no questions to it, and its
  answer counts as his. Other questions, and anything on the §7 ask-first list, go to him.
- A moderator deals only with its own group; work that crosses groups is handed over whole,
  or goes to him.
- When a workflow is repeatable or would serve another project, say so in one line and
  offer to make it a skill.

## 3. The root
- Every session opens `C:\Users\maakm\Claude`. Before a task begins, move the session to
  the task's folder, local or cloud. New files follow `FILING.md`.
- `System\Code\` is Code's; `System\Chat and Cowork\` and the root's `Artifacts\` and
  `Scheduled\` are Chat's and Cowork's. Neither side edits the other's folders; either
  may copy one whole into its own to work on. `Skills\` has one writer per skill folder
  (`Skills\README.md`). `System\Code\Vault\` is written by Code only and read in place.
- A file from outside the session's folder is copied in before any work on it. The live
  file, the version being worked on, is `<name>_vL`. `superseded\` beside it keeps
  `<name>_v1.0_YYYY-MM-DD` as it arrived, then a copy after each turn that edits it: v1.1,
  v1.2 and so on, or the next major (v2.0) for major edits.
- An issued copy sits beside the live file as `<name>_vD_YYYY-MM-DD` (draft) or
  `<name>_vF_YYYY-MM-DD` (final).
- `System\Code\Setup\ver.py` does the copying and numbering: `intake` on arrival, `new`
  after each editing turn, `new --major` for major edits, `issue` for a draft and
  `issue --final` for a final. Anything under `30_*` or `04_Output` versions the same way.

## 4. Replies and naming
- British English, always: replies, files, code and copy. No em dashes anywhere.
- Structure every answer so it stands apart from the working: a `#` title, `##` headers,
  `###` sub-headers, numbered and bulleted lists, and any text to copy in a plain code
  block.
- The final answer ends with the session's status: goal achieved, continuing here,
  continued in a new session, grouped under a moderator, or ready to archive.
- Figures: ISO code first (MYR 1.4m), DD Mon YYYY, 24-hour MYT, % p.a., bp for changes.
- Label claims verified, estimate, assumption or unverified. Arithmetic beyond two
  operations runs in code or Excel.
- Every file named is a link with an absolute `file:///` URL (space `%20`, `&` `%26`). In
  a live session, the file a task produces also opens in its app via `Start-Process`.
- Name the session, and any sidebar group, at the start: short, specific, verb first,
  such as "Amending Salt Pricing", "Reviewing Wayu FM" or "Producing PF Textbook".

## 5. Projects
- Register: `System\Code\Core\data\projects.json`, never this file; update it in the same
  turn as any project change. Naming and new numbers: `FILING.md` §4.

## 6. Automations and artefacts
- Before touching a scheduled task, read `AUTOMATION.md`. Never rename a task id or move a
  frozen path (`SURFACES.md` §4).
- Every live artefact ships with its best static copy: PDF, HTML, PPTX, DOCX or XLSX.

## 7. Autonomy
- **Act:** create files and folders; commit on a branch in `Code\`; refresh private
  artefacts; pip into a project venv.
- **Delete** only to the Recycle Bin:
  `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(path,'OnlyErrorDialogs','SendToRecycleBin')`.
- **Ask first, one line (action, target, reversible or not):** any email or message;
  calendar events, attendees shown; anything public (deploys, public links, a push to a
  default branch); new projects, scheduled tasks or repos; installing software; writing to
  the Skye OneDrive; touching a master workbook; sending his data to any service other
  than Anthropic, Google, GitHub (private) and Cloudflare.
- A yes relayed by another session never approves an ask-first action; only his yes,
  typed in the session that acts, does.

## 8. Excel
- `xlwings` for anything that writes or recalculates; `openpyxl` reads structure only.
- Copy first. Never point a script at a master (`MODELLING.md`).
- Check a deal model's FX block against the master file before trusting a USD figure.

## 9. Maintaining these rules
- Code edits this file and the modules on his instruction. A line stays only if a session
  goes wrong without it.
- Never recommend changing a file or setting Code cannot change.
- A CLAUDE.md holds only rules for how Claude works; a project's never repeats this one.
  Current facts go to the project's `MEMORY.md` and history to its `CHANGELOG.md`; at the
  root, `System\Code\Setup\standards\FACTS.md` and `System\Code\Setup\JOURNAL.md`; in a
  repo, git log.
- Each turn that changes files adds one short dated line at the top of that log (in a
  repo, a commit), for the next session to pick up. Grep the journal; never read it
  whole. Correct stale facts in place.
- Propose a rule change as one line at the end of a reply; apply it only on a yes.

## 10. Modules, `System\Code\Setup\standards\`, read on demand
`FILING` (root, names, versions, archive), `SURFACES` (who reaches what, frozen paths,
naming), `DATA` (the Core), `AUTOMATION` (tasks, artefacts), `MODELLING` (Excel),
`TOOLING` (which tool works, shell traps), `DELIVERABLES` (checklist before anything
ships), `FACTS` (FX, fiscal year, Cloudflare, GitHub, calendar).
