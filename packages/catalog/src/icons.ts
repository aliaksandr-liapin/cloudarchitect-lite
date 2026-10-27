/**
 * Pinned AWS icon pack record and the icon ids the catalog needs. Browser-safe: no `node:` imports
 * here (the verifying extractor lives in extract.ts, exported as `@cloudarchitect/catalog/extract`).
 * The icons themselves are never committed or shipped; each install downloads the pinned ZIP.
 */
import { Container, type CatalogSnapshot } from '@cloudarchitect/domain';
import { z } from 'zod';
import iconPacks from '../data/icon-packs.json' with { type: 'json' };

export const AwsIconPack = z.object({
  provider: z.literal('aws'),
  sourceUrl: z.url(),
  release: z.string().min(1),
  downloadUrl: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  termsAsPublished: z.string().min(1),
  termsCheckedAt: z.iso.date(),
  /** assetId → path of the SVG inside the ZIP. */
  files: z.record(z.string(), z.string().min(1)),
  /** Required ids that are deliberately drawn without an icon. */
  noIcon: z.array(z.string()),
  status: z.literal('pinned'),
});
export type AwsIconPack = z.infer<typeof AwsIconPack>;

/** Verified icons for one provider release: assetId → SVG text. */
export type IconSet = { provider: 'aws'; release: string; icons: Record<string, string> };

/** Parsed, schema-checked AWS icon pack record. Throws at import time if the data is invalid. */
export const awsIconPack: AwsIconPack = AwsIconPack.parse(
  iconPacks.find((p) => p.provider === 'aws'),
);

const SUBNET_TYPES = Container.shape.properties.unwrap().shape.subnetType.unwrap().options;

/**
 * Every icon id the catalog can draw: each service's `iconAssetId`, `aws/group/<kind>` per container
 * kind, and `aws/group/subnet-<type>` per subnet type (a subnet is drawn by its type, so there is no
 * plain `aws/group/subnet`).
 */
export function requiredIconIds(catalog: CatalogSnapshot): string[] {
  const ids = new Set<string>();
  for (const s of catalog.services) if (s.iconAssetId) ids.add(s.iconAssetId);
  for (const c of catalog.containers) {
    if (c.kind === 'subnet') for (const t of SUBNET_TYPES) ids.add(`aws/group/subnet-${t}`);
    else ids.add(`aws/group/${c.kind}`);
  }
  return [...ids];
}
