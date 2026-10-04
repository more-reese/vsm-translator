/**
 * Prompt text lives here, apart from transport, so it can be tuned (or reused by
 * a local-model adapter) without touching the API plumbing.
 */

export const BPMN_SUBSET = `
Supported element types (this is the entire vocabulary — never invent others):
  startEvent        a trigger that begins the process
  endEvent          a terminal outcome
  task              a unit of work someone or something performs
  subProcess        a task that is itself a whole process, drilled into separately
  exclusiveGateway  a decision: exactly one outgoing path is taken
  parallelGateway   a split/join: all outgoing paths are taken

Rules:
- Every diagram has at least one startEvent and at least one endEvent.
- Every node except a startEvent has an incoming edge; every node except an
  endEvent has an outgoing edge.
- Edges leaving an exclusiveGateway MUST carry a short condition label in "name"
  ("yes", "no", "billing issue", "under $500"). Edges leaving a parallelGateway
  carry no label.
- A gateway is only warranted when the text actually branches. Do not add a
  gateway for a step that merely sounds conditional.
- Use subProcess (not task) when the text says a step is itself a named process,
  has its own sub-steps indented beneath it, or is described as "handled by the X
  process". Otherwise use task.
- Task names are short imperative verb phrases: "Triage request", not
  "The support agent triages the incoming request".
`.trim();

export const TEXT_CONVENTIONS = `
The author writes loosely-structured steps, not a formal syntax. Be forgiving and
interpret intent. Conventions they MAY use, and which you should honour when
present but never require:
  - numbered or bulleted lines, one step each
  - "@Name" anywhere in a line names the actor performing that step
  - "IF <condition> THEN ... ELSE ..." marks a branch
  - indentation under a step means those lines are the internals of that step
    (which makes the parent a subProcess)
  - "meanwhile", "at the same time", "in parallel" mark a parallel split
Plain prose with none of these must still translate correctly.
`.trim();

export const ID_RULES = `
Element ids:
- You are given the CURRENT model. When a step in the text clearly corresponds to
  an element that already exists, REUSE that element's exact id. This is what
  preserves the user's hand-placed layout across a re-commit — getting it wrong
  scrambles their diagram, so match generously on meaning rather than exact wording.
- Only mint a new id for genuinely new elements. New ids look like "Node_a1b2c3"
  or "Flow_a1b2c3" (7-character lowercase-alphanumeric suffix), and must be unique.
- Never reuse an id for a different element.
`.trim();

export const PROVENANCE_RULES = `
Provenance (this drives the app's hover-for-context feature, so it must be right):
- sourceLineStart / sourceLineEnd are 1-indexed line numbers into the INPUT TEXT
  exactly as given, inclusive. Line 1 is the first line, blank lines count.
- sourceText is the verbatim substring of the input those lines contain, trimmed.
- For an element with no basis in the text (an implicit start or end event you
  added to close the process), set all three to null.
`.trim();

export function textToProcessSystem(): string {
  return `You translate plain-language descriptions of business processes into a BPMN 2.0 process model.

${BPMN_SUBSET}

${TEXT_CONVENTIONS}

${ID_RULES}

${PROVENANCE_RULES}

Do not lay the diagram out — omit coordinates entirely. The application handles geometry.`;
}

export function processToTextSystem(): string {
  return `You translate a BPMN 2.0 process model back into the plain-language description it came from.

Write the description the way the author writes: numbered steps, one per line, short
and concrete, present tense. Match the voice and level of detail of the PREVIOUS TEXT
you are given — it is the author's own writing, and your output replaces it, so
preserve their wording wherever the model has not actually changed. Change only what
the diagram changed.

Conventions to use:
- One numbered step per node, in flow order, following the sequence flows.
- If a node has an actor, write it as "@Actor" inside the line.
- An exclusive gateway becomes "IF <question> THEN" with its branches indented
  beneath, and an "ELSE" for the other path. Use the edge condition labels.
- A parallel gateway becomes "At the same time:" with its branches indented beneath.
- A subProcess gets its own line marked with " (sub-process)" at the end, since its
  internals live in a separate diagram the reader can drill into.
- Do not write a step for the start event or the end event unless they carry a
  meaningful name; instead let the first and last steps speak for themselves.

Return ONLY the description text. No preamble, no code fences, no commentary.`;
}

export const VSM_PRIMER = `
Stafford Beer's Viable System Model. Element types (the entire vocabulary):
  system1      an operational unit that does the organisation's primary activity
               and is itself viable; there are usually several
  system2      coordination — damps oscillation and conflict BETWEEN System 1 units
               (schedules, standards, shared calendars, style guides)
  system3      internal control and resource allocation across the System 1 units;
               the "here and now" management of the whole
  system3star  audit / sporadic direct inspection, bypassing the System 3 line
  system4      intelligence — outside and future; scans the environment, plans,
               develops the organisation
  system5      policy and identity — decides what the organisation IS, and arbitrates
               the System 3 / System 4 tension
  environment  the outside world a unit or the whole system operates in

Channel types for edges:
  command        System 5 → 4 → 3 → 1 line of authority and accountability
  coordination   via System 2, between System 1 units
  audit          System 3* sporadic inspection into a System 1 unit
  algedonic      pain/pleasure alarm signal that jumps the hierarchy straight to
                 System 5 when something is badly wrong
  operational    System 1 unit to its own environment, or unit to unit
  environmental  environment to System 4 (scanning) or to a unit

Rules:
- A well-formed model has exactly one each of system2, system3, system4, system5,
  and two or more system1 units. Include system3star only if audit is mentioned.
- recursionLevel: 0 for the systems 2–5 of the organisation in focus, 1 for the
  System 1 units (each of which is a viable system one level down).
`.trim();

export function textToVsmSystem(): string {
  return `You translate a plain-language description of an organisation into a Viable System Model.

${VSM_PRIMER}

${ID_RULES.replace(/"Node_a1b2c3" or "Flow_a1b2c3"/, '"Vsm_a1b2c3" or "Chan_a1b2c3"')}

${PROVENANCE_RULES}

linkedDiagramId: you are given the process diagrams that exist in this project. If a
System 1 unit plainly runs one of them, set linkedDiagramId to that diagram's id.
Otherwise null. Never invent a diagram id.

Do not lay the diagram out — omit coordinates entirely. The application handles geometry.`;
}

export function vsmToTextSystem(): string {
  return `You translate a Viable System Model back into the plain-language description of the organisation it came from.

${VSM_PRIMER}

Write prose the way the author writes — short declarative lines, one idea each,
naming the units and who coordinates, controls, scans and sets policy. Match the
voice and detail of the PREVIOUS TEXT; preserve their wording wherever the model has
not actually changed.

Return ONLY the description text. No preamble, no code fences, no commentary.`;
}

export function mergeSystem(): string {
  return `You are resolving a merge. The user edited BOTH the text description and the
diagram of the same process since the last commit, and the two now disagree.

You are given:
  - BASE TEXT: the text at the last commit
  - EDITED TEXT, and FROM TEXT: the model implied by the user's edited text
  - FROM DIAGRAM: the model as the user left it on the canvas
  - CONFLICTS: the specific disagreements
  - RESOLUTIONS: for each conflict, which side the user chose, and/or a free-text
    instruction they typed

Produce ONE merged model and ONE merged text that agree with each other.

Hard rules:
- A resolution naming a side is binding: take that side's version of that element.
- A free-text instruction OVERRIDES the side choice for that conflict. Follow it
  literally, even if it asks for something neither side contains.
- Where the two sides agree, keep what they agree on. Do not take the opportunity
  to restructure anything the user did not touch.
- Reuse existing element ids wherever the element survives the merge — this
  preserves the user's layout.
- The merged text must be a faithful description of the merged model, written in
  the author's voice, evolved from the EDITED TEXT rather than rewritten from scratch.
- notes: one short line per conflict saying how you settled it, in plain language
  ("Kept the QA Review name from the text and the gateway from the diagram").

${BPMN_SUBSET}

${PROVENANCE_RULES}

Omit coordinates entirely.`;
}
