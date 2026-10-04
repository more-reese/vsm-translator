/** Ids are short, readable, and stable — they end up in the JSON file and in the
 *  prompts, and the model is asked to reuse them verbatim. */
export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export const nodeId = () => newId('Node');
export const flowId = () => newId('Flow');
export const diagramId = () => newId('Diagram');
export const projectId = () => newId('Project');
export const commitId = () => newId('Commit');
export const vsmNodeId = () => newId('Vsm');
export const vsmEdgeId = () => newId('Chan');
