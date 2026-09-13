---
name: grill-me
description: Use when the user wants to start a new project, feature, or task and asks to be "grilled" for requirements. Triggers an interactive Q&A session to gather complete, explicit requirements before any implementation begins. Use ONLY when the user invokes "grill me" or asks to be interrogated for requirements; do not use for ordinary task requests.
---

# Grill Me

A structured interrogation skill for gathering complete requirements before any
code is written. The goal is to surface assumptions, edge cases, constraints, and
non-functional requirements that the user would otherwise have to remember to
mention — by asking pointed questions one batch at a time.

## When to use this skill

- The user says "grill me", "interrogate me", "ask me questions", or otherwise
  explicitly asks to be questioned before starting work.
- The user wants to start a new project, feature, or non-trivial task and asks
  for help defining it.

Do NOT use this skill when the user has already given a complete, unambiguous
spec and just wants implementation. Skip straight to work in that case.

## How to run the grilling session

### 1. Acknowledge and set expectations

In one or two sentences, tell the user:
- You will ask questions in small batches (2–4 questions per round).
- They can answer as briefly or verbosely as they like.
- They can say "skip" to defer any question, or "enough" to end the session
  early and move on.
- When the session ends, you will summarize the gathered requirements and ask
  for confirmation before any implementation starts.

### 2. Ask questions in rounds, using the `question` tool

Use the `question` tool to ask 2–4 related questions per round. Group questions
by theme so the user can answer a coherent cluster at once. Use the `multiple:
true` option only when multiple selections make sense for that question.

Do NOT dump all categories at once. Wait for the user's answers to each round
before asking the next. Their answers shape which follow-up questions matter.

Use the question tool's `custom` (type-your-own) default — most requirements
questions need a free-text answer, not a multiple-choice. Offer options when
genuinely common choices exist (e.g. tech stack, auth strategy), but always
allow the user to type their own.

### 3. Question categories — cover these in order, adapt as needed

Not every category applies to every project. Skip a category only when the
user's earlier answers already made it moot.

**Round 1 — Purpose & scope**
- What problem does this solve? Who has this problem?
- What does "done" look like for v1? What is explicitly OUT of scope?
- Is this a prototype, a learning exercise, or production-bound?

**Round 2 — Users & interfaces**
- Who uses it? How many? Any non-human consumers (APIs, webhooks)?
- What interfaces do you want? (CLI, web UI, mobile, REST API, etc.)
- Any existing UI/UX constraints, design systems, or brand requirements?

**Round 3 — Tech stack & integration**
- Language, framework, runtime, database — any already chosen or required?
- What must it integrate with? (existing services, third-party APIs, auth providers)
- Where will it run? (local, cloud, specific host, containerized)

**Round 4 — Data & state**
- What data flows in and out? Roughly how much?
- Where does it live? (in-memory, files, a DB, an external service)
- Any persistence, migration, backup, or retention requirements?

**Round 5 — Non-functional requirements**
- Performance targets or limits? (latency, throughput, concurrency)
- Security & auth requirements? (who can do what, secrets, compliance)
- Reliability targets? (uptime, error handling, graceful degradation)

**Round 6 — Constraints & delivery**
- Hard deadlines? Milestones?
- Budget or cost constraints? (cloud spend, API limits, licensing)
- Anything you've already tried that didn't work? Anything to avoid?

**Round 7 — Wrap-up**
- Anything I haven't asked that you think I should know?
- Any of these answers you're unsure about and want me to make a default call on?

### 4. Summarize and confirm

After the last round (or when the user says "enough"), write a structured
summary with these sections:

- **Goal** — one sentence.
- **Scope** — in scope / out of scope bullets.
- **Users & interfaces** — who and what.
- **Tech stack** — chosen or assumed, with any open decisions flagged.
- **Data** — what's stored where.
- **Non-functional** — perf, security, reliability bullets.
- **Constraints** — deadlines, budget, things to avoid.
- **Open questions** — anything still unanswered, with a recommended default
  for each.

Then ask the user to confirm, correct, or add to the summary. Only after the
user confirms should any implementation work begin.

## Rules

- One round at a time. Never reveal upcoming rounds' questions in advance.
- Always allow "skip" and "enough" as escape hatches. Respect them immediately.
- If an earlier answer makes a later round redundant, skip that round silently
  and note it in the summary's "Open questions" section.
- Do not start writing code, scaffolding, or files until the summary is
  confirmed by the user. The entire point of this skill is to prevent
  premature implementation.
- Keep questions specific and concrete. "What auth do you want?" is better
  than "Tell me about security."
- If the user gives a vague answer to a high-stakes question, ask one tight
  follow-up in the next round before moving on.
