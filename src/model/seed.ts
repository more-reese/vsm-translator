import { layoutProcessFull, layoutVsm } from './layout';
import type { Project, ProcessDiagram, VsmDiagram } from './types';

/**
 * The example project loaded on first launch. It is deliberately generic (a small
 * custom-furniture workshop) and deliberately exercises every feature at once:
 * text ↔ diagram provenance on every element, a collapsed sub-process you can
 * drill into, a VSM whose Workshop unit links down to that sub-process, and a
 * commit already in the history.
 */

const ROOT_ID = 'Diagram_seedroot';
const BUILD_ID = 'Diagram_seedbuild';

const ROOT_TEXT = [
  '1. A customer submits an order through the website.',
  '2. @Sales checks the order is complete and confirms the price.',
  '3. IF the order needs custom sizing THEN',
  '     3a. @Design draws the piece and gets the customer to sign it off.',
  '   ELSE',
  '     3b. go straight to the build.',
  '4. @Workshop builds the piece (sub-process).',
  '5. At the same time:',
  '     5a. @Logistics books a delivery slot.',
  '     5b. @Finance raises the invoice.',
  '6. @Logistics delivers the piece and closes the order.',
].join('\n');

const BUILD_TEXT = [
  '1. @Workshop pulls the materials for the job.',
  '2. @Workshop cuts and shapes the parts.',
  '3. @Workshop assembles the piece and applies the finish.',
  '4. IF the finish fails inspection THEN',
  '     4a. @Workshop reworks the finish, then inspects again.',
  '   ELSE',
  '     4b. the piece is ready to hand over.',
].join('\n');

const VSM_TEXT = [
  'Customers, timber suppliers and safety regulation are the world this business sits in.',
  'The workshop, the design studio and the delivery team are the three operating units.',
  'A shared production calendar and a common materials standard keep the three from tripping over each other.',
  'The operations manager allocates people and money across the three units week by week.',
  'Every few weeks someone inspects a finished piece on the shop floor, outside the normal reporting.',
  'The owner watches the market, new materials and where furniture buying is heading, and plans what the business becomes next.',
  'The partners set what the business stands for, and settle it when running well now and changing for later pull against each other.',
].join('\n');

function rootDiagram(): ProcessDiagram {
  const nodes = layoutProcessFull(
    [
      {
        id: 'Node_seedstart',
        type: 'startEvent',
        name: 'Order received',
        sourceText: 'A customer submits an order through the website.',
        sourceLines: [1, 1],
        note: 'The trigger. Everything downstream waits on this.',
      },
      {
        id: 'Node_seedcheck',
        type: 'task',
        name: 'Check order and confirm price',
        actor: 'Sales',
        sourceText: '@Sales checks the order is complete and confirms the price.',
        sourceLines: [2, 2],
      },
      {
        id: 'Node_seedgate',
        type: 'exclusiveGateway',
        name: 'Needs custom sizing?',
        sourceText: 'IF the order needs custom sizing THEN',
        sourceLines: [3, 3],
        note: 'Exactly one branch is taken. Standard sizes skip the design step entirely.',
      },
      {
        id: 'Node_seeddesign',
        type: 'task',
        name: 'Draw and get sign-off',
        actor: 'Design',
        sourceText: '@Design draws the piece and gets the customer to sign it off.',
        sourceLines: [4, 4],
      },
      {
        id: 'Node_seedbuild',
        type: 'subProcess',
        name: 'Build the piece',
        actor: 'Workshop',
        sourceText: '@Workshop builds the piece (sub-process).',
        sourceLines: [7, 7],
        childDiagramId: BUILD_ID,
        note: 'A whole process of its own. Double-click to drill in — it has its own text and its own diagram.',
      },
      {
        id: 'Node_seedsplit',
        type: 'parallelGateway',
        name: 'Split',
        sourceText: 'At the same time:',
        sourceLines: [8, 8],
        note: 'Both branches start at once. Nothing downstream runs until both have finished.',
      },
      {
        id: 'Node_seedslot',
        type: 'task',
        name: 'Book delivery slot',
        actor: 'Logistics',
        sourceText: '@Logistics books a delivery slot.',
        sourceLines: [9, 9],
      },
      {
        id: 'Node_seedinvoice',
        type: 'task',
        name: 'Raise the invoice',
        actor: 'Finance',
        sourceText: '@Finance raises the invoice.',
        sourceLines: [10, 10],
      },
      {
        id: 'Node_seedjoin',
        type: 'parallelGateway',
        name: 'Join',
        sourceText: 'At the same time:',
        sourceLines: [8, 8],
        note: 'Waits for both branches before letting the process continue.',
      },
      {
        id: 'Node_seeddeliver',
        type: 'task',
        name: 'Deliver and close the order',
        actor: 'Logistics',
        sourceText: '@Logistics delivers the piece and closes the order.',
        sourceLines: [11, 11],
      },
      {
        id: 'Node_seedend',
        type: 'endEvent',
        name: 'Order closed',
        sourceText: '@Logistics delivers the piece and closes the order.',
        sourceLines: [11, 11],
      },
    ],
    rootEdges(),
  );

  return {
    id: ROOT_ID,
    name: 'Order to delivery',
    text: ROOT_TEXT,
    nodes,
    edges: rootEdges(),
  };
}

function rootEdges() {
  return [
    { id: 'Flow_seed01', source: 'Node_seedstart', target: 'Node_seedcheck' },
    { id: 'Flow_seed02', source: 'Node_seedcheck', target: 'Node_seedgate' },
    {
      id: 'Flow_seed03',
      source: 'Node_seedgate',
      target: 'Node_seeddesign',
      name: 'needs sizing',
      sourceText: '3a. @Design draws the piece and gets the customer to sign it off.',
      sourceLines: [4, 4] as [number, number],
    },
    {
      id: 'Flow_seed04',
      source: 'Node_seedgate',
      target: 'Node_seedbuild',
      name: 'standard size',
      sourceText: '3b. go straight to the build.',
      sourceLines: [6, 6] as [number, number],
    },
    { id: 'Flow_seed05', source: 'Node_seeddesign', target: 'Node_seedbuild' },
    { id: 'Flow_seed06', source: 'Node_seedbuild', target: 'Node_seedsplit' },
    { id: 'Flow_seed07', source: 'Node_seedsplit', target: 'Node_seedslot' },
    { id: 'Flow_seed08', source: 'Node_seedsplit', target: 'Node_seedinvoice' },
    { id: 'Flow_seed09', source: 'Node_seedslot', target: 'Node_seedjoin' },
    { id: 'Flow_seed10', source: 'Node_seedinvoice', target: 'Node_seedjoin' },
    { id: 'Flow_seed11', source: 'Node_seedjoin', target: 'Node_seeddeliver' },
    { id: 'Flow_seed12', source: 'Node_seeddeliver', target: 'Node_seedend' },
  ];
}

function buildEdges() {
  return [
    { id: 'Flow_build01', source: 'Node_buildstart', target: 'Node_buildpull' },
    { id: 'Flow_build02', source: 'Node_buildpull', target: 'Node_buildcut' },
    { id: 'Flow_build03', source: 'Node_buildcut', target: 'Node_buildassemble' },
    { id: 'Flow_build04', source: 'Node_buildassemble', target: 'Node_buildgate' },
    {
      id: 'Flow_build05',
      source: 'Node_buildgate',
      target: 'Node_buildrework',
      name: 'fails',
      sourceText: '4a. @Workshop reworks the finish, then inspects again.',
      sourceLines: [5, 5] as [number, number],
    },
    {
      id: 'Flow_build06',
      source: 'Node_buildgate',
      target: 'Node_buildend',
      name: 'passes',
      sourceText: '4b. the piece is ready to hand over.',
      sourceLines: [7, 7] as [number, number],
    },
    // Deliberate loop back to the inspection gateway — proves the router handles it.
    { id: 'Flow_build07', source: 'Node_buildrework', target: 'Node_buildgate' },
  ];
}

function buildDiagram(): ProcessDiagram {
  const nodes = layoutProcessFull(
    [
      {
        id: 'Node_buildstart',
        type: 'startEvent',
        name: 'Job released',
        sourceLines: [1, 1],
        sourceText: '@Workshop pulls the materials for the job.',
      },
      {
        id: 'Node_buildpull',
        type: 'task',
        name: 'Pull materials',
        actor: 'Workshop',
        sourceText: '@Workshop pulls the materials for the job.',
        sourceLines: [1, 1],
      },
      {
        id: 'Node_buildcut',
        type: 'task',
        name: 'Cut and shape parts',
        actor: 'Workshop',
        sourceText: '@Workshop cuts and shapes the parts.',
        sourceLines: [2, 2],
      },
      {
        id: 'Node_buildassemble',
        type: 'task',
        name: 'Assemble and finish',
        actor: 'Workshop',
        sourceText: '@Workshop assembles the piece and applies the finish.',
        sourceLines: [3, 3],
      },
      {
        id: 'Node_buildgate',
        type: 'exclusiveGateway',
        name: 'Finish passes inspection?',
        sourceText: 'IF the finish fails inspection THEN',
        sourceLines: [4, 4],
      },
      {
        id: 'Node_buildrework',
        type: 'task',
        name: 'Rework the finish',
        actor: 'Workshop',
        sourceText: '@Workshop reworks the finish, then inspects again.',
        sourceLines: [5, 5],
        note: 'Loops straight back to the inspection — rework is re-inspected, not waved through.',
      },
      {
        id: 'Node_buildend',
        type: 'endEvent',
        name: 'Piece ready',
        sourceText: 'the piece is ready to hand over.',
        sourceLines: [7, 7],
      },
    ],
    buildEdges(),
  );

  return {
    id: BUILD_ID,
    name: 'Build the piece',
    parentDiagramId: ROOT_ID,
    parentNodeId: 'Node_seedbuild',
    text: BUILD_TEXT,
    nodes,
    edges: buildEdges(),
  };
}

function vsmDiagram(): VsmDiagram {
  const nodes = layoutVsm(
    [
      {
        id: 'Vsm_seedenv',
        type: 'environment',
        name: 'Customers, suppliers, regulation',
        sourceText: 'Customers, timber suppliers and safety regulation are the world this business sits in.',
        sourceLines: [1, 1],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        id: 'Vsm_seedworkshop',
        type: 'system1',
        name: 'Workshop',
        note: 'Links down to the "Build the piece" process — this is the operation that runs it.',
        linkedDiagramId: BUILD_ID,
        sourceText: 'The workshop, the design studio and the delivery team are the three operating units.',
        sourceLines: [2, 2],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        id: 'Vsm_seeddesign',
        type: 'system1',
        name: 'Design studio',
        sourceText: 'The workshop, the design studio and the delivery team are the three operating units.',
        sourceLines: [2, 2],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        id: 'Vsm_seeddelivery',
        type: 'system1',
        name: 'Delivery team',
        sourceText: 'The workshop, the design studio and the delivery team are the three operating units.',
        sourceLines: [2, 2],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        id: 'Vsm_seeds2',
        type: 'system2',
        name: 'Production calendar & materials standard',
        sourceText:
          'A shared production calendar and a common materials standard keep the three from tripping over each other.',
        sourceLines: [3, 3],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        id: 'Vsm_seeds3',
        type: 'system3',
        name: 'Operations manager',
        sourceText: 'The operations manager allocates people and money across the three units week by week.',
        sourceLines: [4, 4],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        id: 'Vsm_seeds3star',
        type: 'system3star',
        name: 'Shop-floor inspection',
        sourceText:
          'Every few weeks someone inspects a finished piece on the shop floor, outside the normal reporting.',
        sourceLines: [5, 5],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        id: 'Vsm_seeds4',
        type: 'system4',
        name: 'Owner — market & materials watch',
        sourceText:
          'The owner watches the market, new materials and where furniture buying is heading, and plans what the business becomes next.',
        sourceLines: [6, 6],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
      {
        id: 'Vsm_seeds5',
        type: 'system5',
        name: 'Partners — what the business is',
        sourceText:
          'The partners set what the business stands for, and settle it when running well now and changing for later pull against each other.',
        sourceLines: [7, 7],
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      },
    ],
    false,
  );

  return {
    id: 'Vsm_seed',
    name: 'The business as a viable system',
    text: VSM_TEXT,
    nodes,
    edges: [
      { id: 'Chan_seed01', source: 'Vsm_seeds5', target: 'Vsm_seeds4', channel: 'command' },
      { id: 'Chan_seed02', source: 'Vsm_seeds4', target: 'Vsm_seeds3', channel: 'command' },
      { id: 'Chan_seed03', source: 'Vsm_seeds3', target: 'Vsm_seedworkshop', channel: 'command' },
      { id: 'Chan_seed04', source: 'Vsm_seeds3', target: 'Vsm_seeddesign', channel: 'command' },
      { id: 'Chan_seed05', source: 'Vsm_seeds3', target: 'Vsm_seeddelivery', channel: 'command' },
      {
        id: 'Chan_seed06',
        source: 'Vsm_seeds2',
        target: 'Vsm_seedworkshop',
        channel: 'coordination',
      },
      { id: 'Chan_seed07', source: 'Vsm_seeds2', target: 'Vsm_seeddesign', channel: 'coordination' },
      {
        id: 'Chan_seed08',
        source: 'Vsm_seeds2',
        target: 'Vsm_seeddelivery',
        channel: 'coordination',
      },
      {
        id: 'Chan_seed09',
        source: 'Vsm_seeds3star',
        target: 'Vsm_seedworkshop',
        channel: 'audit',
        name: 'spot check',
      },
      {
        id: 'Chan_seed10',
        source: 'Vsm_seedworkshop',
        target: 'Vsm_seeds5',
        channel: 'algedonic',
        name: 'something is badly wrong',
      },
      { id: 'Chan_seed11', source: 'Vsm_seedenv', target: 'Vsm_seeds4', channel: 'environmental' },
      {
        id: 'Chan_seed12',
        source: 'Vsm_seedworkshop',
        target: 'Vsm_seedenv',
        channel: 'operational',
      },
    ],
  };
}

export function createSeedProject(): Project {
  const now = new Date().toISOString();
  const content = {
    rootDiagramId: ROOT_ID,
    diagrams: {
      [ROOT_ID]: rootDiagram(),
      [BUILD_ID]: buildDiagram(),
    },
    vsm: vsmDiagram(),
  };

  return {
    id: 'Project_example',
    name: 'Example — Furniture workshop',
    createdAt: now,
    updatedAt: now,
    content,
    history: [
      {
        id: 'Commit_seed',
        timestamp: now,
        summary: 'Seed example — order to delivery, plus the business as a viable system',
        direction: 'init',
        mode: 'process',
        focusDiagramId: ROOT_ID,
        changes: [],
        snapshot: content,
      },
    ],
  };
}
