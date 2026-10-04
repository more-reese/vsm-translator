/* eslint-disable @typescript-eslint/no-explicit-any */
import { is } from 'bpmn-js/lib/util/ModelUtil';

/**
 * bpmn-js ships a palette and context pad covering the whole BPMN spec. This MVP
 * supports a deliberate subset, so both are replaced with providers offering only
 * that subset — registering under the stock names ('paletteProvider',
 * 'contextPadProvider') overrides the defaults. Widening the supported subset
 * later means adding entries here and a type to ProcessNodeType; nothing else.
 */

const SUBSET = [
  { type: 'bpmn:StartEvent', icon: 'bpmn-icon-start-event-none', title: 'Start event' },
  { type: 'bpmn:Task', icon: 'bpmn-icon-task', title: 'Task' },
  {
    type: 'bpmn:SubProcess',
    icon: 'bpmn-icon-subprocess-collapsed',
    title: 'Sub-process (drill into its own diagram)',
    options: { isExpanded: false },
  },
  {
    type: 'bpmn:ExclusiveGateway',
    icon: 'bpmn-icon-gateway-xor',
    title: 'Exclusive gateway (one way out)',
  },
  {
    type: 'bpmn:ParallelGateway',
    icon: 'bpmn-icon-gateway-parallel',
    title: 'Parallel gateway (all ways out)',
  },
  { type: 'bpmn:EndEvent', icon: 'bpmn-icon-end-event-none', title: 'End event' },
];

function CustomPalette(
  this: any,
  palette: any,
  create: any,
  elementFactory: any,
  lassoTool: any,
  handTool: any,
  globalConnect: any,
) {
  this._create = create;
  this._elementFactory = elementFactory;
  this._lassoTool = lassoTool;
  this._handTool = handTool;
  this._globalConnect = globalConnect;
  palette.registerProvider(this);
}

CustomPalette.$inject = [
  'palette',
  'create',
  'elementFactory',
  'lassoTool',
  'handTool',
  'globalConnect',
];

CustomPalette.prototype.getPaletteEntries = function getPaletteEntries(this: any) {
  const create = this._create;
  const elementFactory = this._elementFactory;

  const entries: Record<string, unknown> = {
    'hand-tool': {
      group: 'tools',
      className: 'bpmn-icon-hand-tool',
      title: 'Pan the canvas',
      action: { click: (event: any) => this._handTool.activateHand(event) },
    },
    'lasso-tool': {
      group: 'tools',
      className: 'bpmn-icon-lasso-tool',
      title: 'Select several elements',
      action: { click: (event: any) => this._lassoTool.activateSelection(event) },
    },
    'global-connect-tool': {
      group: 'tools',
      className: 'bpmn-icon-connection-multi',
      title: 'Draw a sequence flow',
      action: { click: (event: any) => this._globalConnect.start(event) },
    },
    'tool-separator': { group: 'tools', separator: true },
  };

  for (const item of SUBSET) {
    const start = (event: any) => {
      const shape = elementFactory.createShape({ type: item.type, ...(item.options ?? {}) });
      create.start(event, shape);
    };
    entries[`create-${item.type}`] = {
      group: 'create',
      className: item.icon,
      title: item.title,
      action: { dragstart: start, click: start },
    };
  }

  return entries;
};

function CustomContextPad(
  this: any,
  contextPad: any,
  modeling: any,
  elementFactory: any,
  connect: any,
  create: any,
  autoPlace: any,
  eventBus: any,
) {
  this._modeling = modeling;
  this._elementFactory = elementFactory;
  this._connect = connect;
  this._create = create;
  this._autoPlace = autoPlace;
  this._eventBus = eventBus;
  contextPad.registerProvider(this);
}

CustomContextPad.$inject = [
  'contextPad',
  'modeling',
  'elementFactory',
  'connect',
  'create',
  'autoPlace',
  'eventBus',
];

CustomContextPad.prototype.getContextPadEntries = function getContextPadEntries(
  this: any,
  element: any,
) {
  const { _elementFactory: elementFactory, _create: create, _autoPlace: autoPlace } = this;

  const append = (type: string, icon: string, title: string, options: any = {}) => {
    const startDrag = (event: any, target: any) => {
      const shape = elementFactory.createShape({ type, ...options });
      create.start(event, shape, { source: target });
    };
    return {
      group: 'model',
      className: icon,
      title,
      action: {
        dragstart: startDrag,
        click: (event: any, target: any) => {
          if (!autoPlace) return startDrag(event, target);
          const shape = elementFactory.createShape({ type, ...options });
          autoPlace.append(target, shape);
        },
      },
    };
  };

  const entries: Record<string, unknown> = {};

  // A sequence flow can only leave a flow node, and never an end event.
  if (is(element, 'bpmn:FlowNode') && !is(element, 'bpmn:EndEvent')) {
    entries['append.task'] = append('bpmn:Task', 'bpmn-icon-task', 'Append task');
    entries['append.subprocess'] = append(
      'bpmn:SubProcess',
      'bpmn-icon-subprocess-collapsed',
      'Append sub-process',
      { isExpanded: false },
    );
    entries['append.gateway'] = append(
      'bpmn:ExclusiveGateway',
      'bpmn-icon-gateway-xor',
      'Append exclusive gateway',
    );
    entries['append.parallel'] = append(
      'bpmn:ParallelGateway',
      'bpmn-icon-gateway-parallel',
      'Append parallel gateway',
    );
    entries['append.end'] = append('bpmn:EndEvent', 'bpmn-icon-end-event-none', 'Append end event');
    entries['connect'] = {
      group: 'connect',
      className: 'bpmn-icon-connection-multi',
      title: 'Connect to another element',
      action: {
        click: (event: any, target: any) => this._connect.start(event, target),
        dragstart: (event: any, target: any) => this._connect.start(event, target),
      },
    };
  }

  // Turning a task into a sub-process is the entry point for top-down modelling,
  // so it lives on the pad rather than buried in a menu.
  if (is(element, 'bpmn:Task')) {
    entries['make.subprocess'] = {
      group: 'edit',
      className: 'bpmn-icon-subprocess-expanded',
      title: 'Expand into a sub-process',
      action: {
        click: () => this._eventBus.fire('translator.expandToSubProcess', { element }),
      },
    };
  }

  if (is(element, 'bpmn:SubProcess')) {
    entries['drill.in'] = {
      group: 'edit',
      className: 'bpmn-icon-subprocess-expanded',
      title: 'Drill into this sub-process',
      action: { click: () => this._eventBus.fire('translator.drillIn', { element }) },
    };
  }

  if (!is(element, 'bpmn:Process')) {
    entries['delete'] = {
      group: 'edit',
      className: 'bpmn-icon-trash',
      title: 'Delete',
      action: { click: () => this._modeling.removeElements([element]) },
    };
  }

  return entries;
};

export const subsetPaletteModule = {
  __init__: ['paletteProvider'],
  paletteProvider: ['type', CustomPalette],
};

export const subsetContextPadModule = {
  __init__: ['contextPadProvider'],
  contextPadProvider: ['type', CustomContextPad],
};
