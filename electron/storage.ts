import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import type { Project, ProjectSummary } from '../src/model/types';

/**
 * One human-readable JSON file per project, named <id>.json, in the projects
 * directory. Pretty-printed on purpose: the whole point is that you can open a
 * project in an editor, diff it, or drop it in git without any tooling.
 */

function dir(): string {
  const d = loadConfig().projectsDir;
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function fileFor(id: string): string {
  // Ids are app-generated, but never let one escape the projects directory.
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) throw new Error(`Invalid project id: ${id}`);
  return path.join(dir(), `${safe}.json`);
}

export function listProjects(): ProjectSummary[] {
  const d = dir();
  const out: ProjectSummary[] = [];
  for (const name of fs.readdirSync(d)) {
    if (!name.endsWith('.json')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(d, name), 'utf8')) as Project;
      out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt });
    } catch {
      // A corrupt file shouldn't take down the sidebar.
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export function readProject(id: string): Project | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')) as Project;
  } catch {
    return null;
  }
}

export function writeProject(project: Project): Project {
  const next = { ...project, updatedAt: new Date().toISOString() };
  const target = fileFor(next.id);
  // Write-then-rename so a crash mid-write can't truncate an existing project.
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, target);
  return next;
}

export function deleteProject(id: string): void {
  try {
    fs.unlinkSync(fileFor(id));
  } catch {
    /* already gone */
  }
}

export function projectCount(): number {
  return listProjects().length;
}
