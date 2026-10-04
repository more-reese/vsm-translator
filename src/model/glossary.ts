import type { ProcessNodeType, VsmChannelType, VsmNodeType } from './types';

/**
 * Plain-language explainers. These are what make hover feel like a translation
 * layer rather than a tooltip: every formal symbol can say what it means in
 * ordinary words, right where you are looking at it.
 */

export interface Explainer {
  label: string;
  short: string;
  long: string;
}

export const VSM_GLOSSARY: Record<VsmNodeType, Explainer> = {
  system1: {
    label: 'System 1 — Operations',
    short: 'A unit that does the actual work, and is itself a viable system.',
    long: 'The parts of the organisation that produce what it exists to produce. Each System 1 is autonomous enough to be a whole viable system in its own right — which is why you can drill into one and find another five systems inside. If a System 1 unit here runs a process you have modelled, link it to that BPMN diagram.',
  },
  system2: {
    label: 'System 2 — Coordination',
    short: 'Damps the friction between System 1 units.',
    long: 'Not a boss. The shared schedules, standards, conventions and channels that stop autonomous units from oscillating against each other — booking the same room twice, contradicting each other to a customer. Beer\'s test: if removing it would cause the units to trip over one another, it is System 2.',
  },
  system3: {
    label: 'System 3 — Control',
    short: 'Runs the here-and-now: allocates resources across System 1.',
    long: 'Day-to-day management of the whole collection of operations. It bargains resources with each System 1, holds them accountable for delivery, and optimises across them. It looks inward and at the present, which is exactly the tension it has with System 4.',
  },
  system3star: {
    label: 'System 3* — Audit',
    short: 'Sporadic direct inspection that bypasses the normal line.',
    long: 'The occasional walk on the floor: quality audits, spot checks, listening to a support call. It exists because System 3 otherwise only ever sees what System 1 chooses to report. Deliberately irregular and deliberately not routine reporting.',
  },
  system4: {
    label: 'System 4 — Intelligence',
    short: 'Looks outward and forward: the environment and the future.',
    long: 'Scans what is happening outside and what is coming — markets, technology, regulation, competitors — and plans the organisation\'s adaptation. Its future-and-outside orientation is the natural counterweight to System 3\'s present-and-inside focus.',
  },
  system5: {
    label: 'System 5 — Policy',
    short: 'Decides identity: what this organisation is and is for.',
    long: 'Sets the ground rules and arbitrates when System 3 (run it well now) and System 4 (change it for later) pull in opposite directions. Small, and mostly quiet — if System 5 is busy, something below it is not working.',
  },
  environment: {
    label: 'Environment',
    short: 'The outside world the system operates in.',
    long: 'Customers, suppliers, regulators, competitors, weather — whatever the organisation must absorb variety from. Each System 1 has its own local environment; System 4 attends to the total, future environment.',
  },
};

export const CHANNEL_GLOSSARY: Record<VsmChannelType, Explainer> = {
  command: {
    label: 'Command channel',
    short: 'Line of authority and accountability, 5 → 4 → 3 → 1.',
    long: 'How policy becomes direction and how accountability comes back. It carries relatively little traffic in a healthy system; most of what happens should not need to travel this way.',
  },
  coordination: {
    label: 'Coordination channel',
    short: 'Between System 1 units, via System 2.',
    long: 'Shared schedules, standards and conventions moving between operational units so they do not oscillate against each other. Peer-to-peer in effect, even though it passes through System 2.',
  },
  audit: {
    label: 'Audit channel',
    short: 'System 3* looking directly into an operation.',
    long: 'Sporadic, direct, and deliberately outside the normal reporting line — it exists precisely to see what routine reporting would not show.',
  },
  algedonic: {
    label: 'Algedonic channel',
    short: 'Pain signal that jumps straight to System 5.',
    long: 'From the Greek for pain/pleasure. When something is badly enough wrong that the normal chain would be too slow, this alert bypasses every level and lands on System 5. If it fires often, the ordinary channels are not doing their job.',
  },
  operational: {
    label: 'Operational channel',
    short: 'A unit transacting with its environment, or with another unit.',
    long: 'The actual work crossing a boundary — orders in, product out, a handoff between two operational units.',
  },
  environmental: {
    label: 'Environmental channel',
    short: 'The outside world being sensed.',
    long: 'What System 4 picks up when it scans, or what reaches an operational unit directly from its local environment.',
  },
};

export const BPMN_GLOSSARY: Record<ProcessNodeType, Explainer> = {
  startEvent: {
    label: 'Start event',
    short: 'What sets this process off.',
    long: 'A trigger — a request arrives, a date is reached, someone asks. A process can have more than one, but every path has to begin at one.',
  },
  endEvent: {
    label: 'End event',
    short: 'Where a path through the process finishes.',
    long: 'An outcome. Several end events is normal and often clearer than funnelling everything into one — "order shipped" and "order cancelled" are different endings.',
  },
  task: {
    label: 'Task',
    short: 'One unit of work someone performs.',
    long: 'The atom of a BPMN process. If you find yourself describing several things happening inside a task, that is the signal to expand it into a sub-process.',
  },
  subProcess: {
    label: 'Sub-process',
    short: 'A task that is itself a whole process. Double-click to drill in.',
    long: 'Drawn collapsed, with a + marker. It has its own diagram and its own description, which is how you build top-down: name the box now, flesh out its insides later.',
  },
  exclusiveGateway: {
    label: 'Exclusive gateway',
    short: 'A decision — exactly one way out is taken.',
    long: 'Diamond with an ×. Every outgoing flow needs a condition label, and the conditions should cover every case, or work can arrive here and stop.',
  },
  parallelGateway: {
    label: 'Parallel gateway',
    short: 'A split or join — every way out is taken.',
    long: 'Diamond with a +. Splitting starts all branches at once; joining waits for all of them. A split usually wants a matching join, or the process finishes while work is still running.',
  },
};

export function explainNodeType(type: ProcessNodeType): Explainer {
  return BPMN_GLOSSARY[type] ?? BPMN_GLOSSARY.task;
}

export function explainVsmType(type: VsmNodeType): Explainer {
  return VSM_GLOSSARY[type] ?? VSM_GLOSSARY.system1;
}

export function explainChannel(channel: VsmChannelType): Explainer {
  return CHANNEL_GLOSSARY[channel] ?? CHANNEL_GLOSSARY.command;
}

export const VSM_SHORT_LABEL: Record<VsmNodeType, string> = {
  system1: 'S1',
  system2: 'S2',
  system3: 'S3',
  system3star: 'S3*',
  system4: 'S4',
  system5: 'S5',
  environment: 'Env',
};
