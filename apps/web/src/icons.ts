import { awsCatalog, type IconSet } from '@cloudarchitect/catalog';
import type { ArchNode, Container } from '@cloudarchitect/domain';

/** Download state of the official icon pack, as the gateway reports it. */
export type IconState = 'missing' | 'fetching' | 'ready' | 'failed';
export type IconSource = () => Promise<{ state: IconState; icons?: IconSet }>;
export type IconUrls = Record<string, string>;

const iconByService = new Map(awsCatalog.services.map((s) => [s.id, s.iconAssetId]));

/** Encodes SVG text (UTF-8) as base64 data URLs, usable in `<img>` under CSP `img-src data:` and in exports. */
export function toDataUrls(set: IconSet): IconUrls {
  const out: IconUrls = {};
  for (const [id, svg] of Object.entries(set.icons)) {
    let bin = '';
    for (const b of new TextEncoder().encode(svg)) bin += String.fromCharCode(b);
    out[id] = `data:image/svg+xml;base64,${btoa(bin)}`;
  }
  return out;
}

/** Icon of a catalog service node; undefined for unresolved and external nodes. */
export function serviceIcon(node: ArchNode, urls: IconUrls): string | undefined {
  if (!node.serviceId) return undefined;
  const id = iconByService.get(node.serviceId);
  return id ? urls[id] : undefined;
}

/** Icon of a container; availability zones, plain groups and untyped subnets have none. */
export function containerIcon(container: Container, urls: IconUrls): string | undefined {
  switch (container.kind) {
    case 'aws-cloud':
    case 'region':
    case 'vpc':
      return urls[`aws/group/${container.kind}`];
    case 'subnet': {
      const type = container.properties?.subnetType;
      return type ? urls[`aws/group/subnet-${type}`] : undefined;
    }
    default:
      return undefined;
  }
}

/** Reads the pack once; data URLs when it is ready, otherwise just the state. Independent of `api` so the demo can pass a static source. */
export async function loadIcons(source: IconSource): Promise<{ state: IconState; urls: IconUrls }> {
  const { state, icons } = await source();
  return { state, urls: state === 'ready' && icons ? toDataUrls(icons) : {} };
}

export const MISSING_POLLS = 5;
export const FETCHING_POLLS = 100;
export type IconStep = 'done' | 'poll' | 'retry' | 'give-up';

/**
 * What to do after the `attempts`-th poll saw `state`. `missing` (no download running, or a gateway
 * without an icon store) triggers one retry, then a few polls, then gives up; `fetching` polls for
 * at most ~5 minutes. So neither the notice nor the polling can run forever.
 */
export function nextIconStep(state: IconState, attempts: number): IconStep {
  if (state === 'ready' || state === 'failed') return 'done';
  if (state === 'fetching') return attempts < FETCHING_POLLS ? 'poll' : 'give-up';
  if (attempts === 0) return 'retry';
  return attempts < MISSING_POLLS ? 'poll' : 'give-up';
}
