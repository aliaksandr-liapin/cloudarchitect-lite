import { awsCatalog } from '@cloudarchitect/catalog';
import { validateProject, type Project } from '@cloudarchitect/domain';
import type { IconSource } from './icons';

/** Static GitHub Pages build: runs entirely in the browser and never calls `/api`. */
export const DEMO = import.meta.env.VITE_DEMO === 'true';

export const REPO_URL = 'https://github.com/aliaksandr-liapin/cloudarchitect-lite';
export const INSTALL_URL = `${REPO_URL}#install`;

export const DEMO_BANNER = 'Demo: runs entirely in your browser, nothing is sent anywhere.';
export const DEMO_GENERATE_MESSAGE =
  'This demo has no AI. Install CloudArchitect Lite with your own key to generate designs.';

/** What the first validation finding points at (node, else container, else the consuming node of its edge), selected on boot. */
export function demoBootSelection(project: Project): string | undefined {
  const f = validateProject(project, awsCatalog)[0];
  if (!f) return undefined;
  return (
    f.nodeIds[0] ?? f.containerIds[0] ?? project.edges.find((e) => e.id === f.edgeIds[0])?.target
  );
}

/** The icon pack published next to the demo (`tools/fetch-icons.ts --out`), already shaped like an `IconSet`. */
export const demoIconSource: IconSource = async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}icons.json`);
    if (!res.ok) return { state: 'failed' };
    return { state: 'ready', icons: await res.json() };
  } catch {
    return { state: 'failed' };
  }
};
