import { migrateProject } from '@cloudarchitect/domain';
import { samples } from '@cloudarchitect/catalog';
import { describe, expect, it } from 'vitest';
import {
  FETCHING_POLLS,
  MISSING_POLLS,
  containerIcon,
  nextIconStep,
  serviceIcon,
  toDataUrls,
} from './icons';

const project = migrateProject(samples.myblog);
const urls = {
  'aws/cloudfront': 'data:cf',
  'aws/group/subnet-public': 'data:pub',
  'aws/group/vpc': 'data:vpc',
};
const container = (kind: string, subnetType?: string) =>
  ({ id: 'c', kind, label: 'c', ...(subnetType ? { properties: { subnetType } } : {}) }) as never;

describe('serviceIcon', () => {
  it('returns the CloudFront URL for a node of aws.cloudfront', () => {
    const node = project.nodes.find((n) => n.serviceId === 'aws.cloudfront');
    expect(node).toBeDefined();
    expect(serviceIcon(node!, urls)).toBe('data:cf');
  });
  it('returns undefined for unresolved and external nodes', () => {
    const base = project.nodes[0]!;
    const unresolved = { ...base, serviceId: undefined, external: undefined } as never;
    const external = {
      ...base,
      serviceId: undefined,
      external: { kind: 'user', name: 'Visitor' },
    } as never;
    expect(serviceIcon(unresolved, urls)).toBeUndefined();
    expect(serviceIcon(external, urls)).toBeUndefined();
  });
});

describe('containerIcon', () => {
  it('maps a public subnet to aws/group/subnet-public; availability-zone and group get undefined', () => {
    expect(containerIcon(container('subnet', 'public'), urls)).toBe('data:pub');
    expect(containerIcon(container('vpc'), urls)).toBe('data:vpc');
    expect(containerIcon(container('availability-zone'), urls)).toBeUndefined();
    expect(containerIcon(container('group'), urls)).toBeUndefined();
    expect(containerIcon(container('subnet'), urls)).toBeUndefined();
  });
});

describe('toDataUrls', () => {
  it('encodes SVG text losslessly', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Café – 数据</title></svg>';
    const out = toDataUrls({ provider: 'aws', release: 'r', icons: { 'aws/x': svg } });
    const url = out['aws/x']!;
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(url.split(',')[1]!), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(svg);
  });
});

describe('nextIconStep', () => {
  it('stops on ready and failed', () => {
    expect(nextIconStep('ready', 0)).toBe('done');
    expect(nextIconStep('failed', 3)).toBe('done');
  });
  it('polls while fetching, but gives up eventually', () => {
    expect(nextIconStep('fetching', 1)).toBe('poll');
    expect(nextIconStep('fetching', FETCHING_POLLS)).toBe('give-up');
  });
  it('retries missing once, polls a bounded number of times, then gives up', () => {
    expect(nextIconStep('missing', 0)).toBe('retry');
    expect(nextIconStep('missing', 1)).toBe('poll');
    expect(nextIconStep('missing', MISSING_POLLS)).toBe('give-up');
  });
});
