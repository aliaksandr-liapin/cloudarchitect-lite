import { awsCatalog, samples } from '@cloudarchitect/catalog';
import { migrateProject, validateProject } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { demoBootSelection, INSTALL_URL } from './demo';

describe('demoBootSelection', () => {
  const project = migrateProject(samples.myblog);

  it("selects the first finding's node in the sample", () => {
    const first = validateProject(project, awsCatalog)[0];
    expect(first).toBeDefined();
    const expected =
      first!.nodeIds[0] ??
      first!.containerIds[0] ??
      project.edges.find((e) => e.id === first!.edgeIds[0])?.target;
    expect(expected).toBeTruthy();
    expect(demoBootSelection(project)).toBe(expected);
  });

  it('selects nothing when there are no findings', () => {
    expect(demoBootSelection({ ...project, nodes: [], edges: [], containers: [] })).toBeUndefined();
  });
});

describe('INSTALL_URL', () => {
  it('points at the install section', () => {
    expect(INSTALL_URL).toBe('https://github.com/aliaksandr-liapin/cloudarchitect-lite#install');
  });
});
