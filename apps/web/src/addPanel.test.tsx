import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AddPanel, filterServices } from './AddPanel';

const render = (over: Partial<Parameters<typeof AddPanel>[0]> = {}) =>
  renderToStaticMarkup(
    <AddPanel disabled={false} atLimit={false} iconUrls={{}} onAdd={() => {}} {...over} />,
  );

describe('filterServices', () => {
  it('finds DAX by name and groups by category', () => {
    const groups = filterServices('dax');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.services.map((s) => s.id)).toEqual(['aws.dax']);
  });
  it('an empty query lists all 38 services', () => {
    expect(filterServices('').flatMap((g) => g.services)).toHaveLength(38);
  });
  it('is case-insensitive and sorts categories alphabetically', () => {
    expect(filterServices('DAX')).toHaveLength(1);
    const cats = filterServices('').map((g) => g.category);
    expect(cats).toEqual([...cats].sort());
  });
  it('returns nothing for an unmatched query', () => {
    expect(filterServices('zzzzqq')).toEqual([]);
  });
});

describe('AddPanel', () => {
  it('has a search box and named Add buttons', () => {
    const html = render();
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search services"');
    expect(html).toContain('aria-label="Add DynamoDB Accelerator (DAX)"');
    expect(html).toContain('aria-label="Add User"');
    expect(html).toContain('aria-label="Add Third-party service"');
    expect(html).toContain('aria-label="Add VPC"');
    expect(html).toContain('draggable="true"');
    expect(html).not.toContain('maximum of 150');
  });
  it('at the limit the Add buttons are disabled and the note shows', () => {
    const html = render({ atLimit: true });
    expect(html).toContain('This design has the maximum of 150 components.');
    expect(html).toMatch(/<button[^>]*aria-label="Add User"[^>]*disabled/);
  });
});
