import { awsCatalog, samples } from '@cloudarchitect/catalog';
import { migrateProject, type Project } from '@cloudarchitect/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Details, type Selection } from './Details';

const sample = migrateProject(samples.myblog);
const base: Project = {
  ...sample,
  requirements: [
    { id: 'r1', text: 'Be fast', type: 'functional', status: 'confirmed' },
    { id: 'r2', text: 'Be cheap', type: 'functional', status: 'confirmed' },
  ],
  containers: [
    {
      id: 'vpc',
      kind: 'vpc',
      label: 'VPC',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
    },
    {
      id: 'sub',
      kind: 'subnet',
      label: 'Subnet',
      parentId: 'vpc',
      position: { x: 10, y: 10 },
      size: { width: 100, height: 100 },
      properties: { subnetType: 'public' },
    },
  ],
  nodes: [
    {
      id: 'a',
      serviceId: awsCatalog.services[0]!.id,
      provider: 'aws',
      label: 'Alpha',
      requirementIds: ['r1'],
      position: { x: 0, y: 0 },
      size: { width: 100, height: 60 },
    },
    {
      id: 'b',
      provider: 'aws',
      label: 'Beta',
      external: { kind: 'user', name: 'User' },
      requirementIds: [],
      position: { x: 200, y: 0 },
      size: { width: 100, height: 60 },
    },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'invoke', requirementIds: [] }],
};

const render = (selection: Selection, p: Project = base, disabled = false) =>
  renderToStaticMarkup(
    <Details project={p} selection={selection} disabled={disabled} onEdit={vi.fn()} />,
  );

const svcNode = (id: string, serviceId: string, configuration?: Record<string, string | boolean>) =>
  ({
    id,
    serviceId,
    provider: 'aws',
    label: id,
    requirementIds: [],
    position: { x: 0, y: 0 },
    size: { width: 100, height: 60 },
    ...(configuration ? { configuration } : {}),
  }) as Project['nodes'][number];

const withSettings: Project = {
  ...base,
  nodes: [
    ...base.nodes,
    svcNode('t', 'aws.dynamodb', { encryption: 'KMS' }),
    svcNode('q', 'aws.sqs'),
    svcNode('fn', 'aws.lambda', { legacyFlag: true }),
  ],
  edges: [
    ...base.edges,
    { id: 'e2', source: 'q', target: 'fn', kind: 'event', requirementIds: [] },
  ],
};

describe('Details', () => {
  it('connector view shows its fields', () => {
    const html = render({ kind: 'edge', id: 'e1' });
    for (const label of ['Label', 'Kind', 'Protocol', 'Auth notes', 'Delete', 'Alpha', 'Beta'])
      expect(html).toContain(label);
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('aria-label="Delete connector"');
    expect(html).toContain('<option value="invoke" selected="">Invoke</option>');
    expect(html).toContain('<option value="other">Other</option>');
  });

  it('node view lists requirements as checkboxes, linked ones checked', () => {
    const html = render({ kind: 'node', id: 'a' });
    expect(html).toContain('r1: Be fast');
    expect(html).toContain('r2: Be cheap');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('Delete');
    expect(html).toContain('Component name');
    expect(html).toContain('aria-label="Delete component"');
  });

  it('node view says when there are no requirements', () => {
    const html = render({ kind: 'node', id: 'a' }, { ...base, requirements: [] });
    expect(html).toContain('No requirements in this design');
  });

  it('subnet shows subnet type; vpc does not', () => {
    expect(render({ kind: 'node', id: 'sub' })).toContain('Subnet type');
    const vpc = render({ kind: 'node', id: 'vpc' });
    expect(vpc).not.toContain('Subnet type');
    expect(vpc).toContain('aria-label="Delete container"');
  });

  it('unknown id renders nothing', () => {
    expect(render({ kind: 'edge', id: 'nope' })).toBe('');
    expect(render({ kind: 'node', id: 'nope' })).toBe('');
  });

  it('component shows its catalog settings', () => {
    const html = render({ kind: 'node', id: 't' }, withSettings);
    expect(html).toContain('Settings');
    expect(html).toMatch(/<select[^>]*aria-label="DynamoDB encryption at rest"/);
    expect(html).toContain('<option value="KMS" selected="">KMS</option>');
    expect(html).toContain('<option value="AWS-managed">AWS-managed</option>');
    expect(html).toContain('aria-label="Remove DynamoDB encryption at rest"');
    expect(html).toContain('aria-label="Add DynamoDB global tables"');
    expect(html).toContain(
      'href="https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html"',
    );
  });

  it('connector shows settings from both ends', () => {
    const html = render({ kind: 'edge', id: 'e2' }, withSettings);
    expect(html).toContain('aria-label="Add SQS dead-letter queue"');
    expect(html).toContain('aria-label="Add Lambda on-failure destination"');
  });

  it('unknown keys are listed and removable', () => {
    const html = render({ kind: 'node', id: 'fn' }, withSettings);
    expect(html).toContain('Not in catalog');
    expect(html).toContain('legacyFlag = true');
    expect(html).toContain('aria-label="Remove legacyFlag"');
  });

  it('disabled editor disables settings', () => {
    const html = render({ kind: 'node', id: 't' }, withSettings, true);
    expect(html).toMatch(/<select[^>]*aria-label="DynamoDB encryption at rest"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-label="Add DynamoDB global tables"[^>]*disabled=""/);
    expect(html).toMatch(
      /<button[^>]*aria-label="Remove DynamoDB encryption at rest"[^>]*disabled=""/,
    );
  });

  it('container shows no settings', () => {
    expect(render({ kind: 'node', id: 'sub' })).not.toContain('Settings');
  });
});
