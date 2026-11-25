import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AddPanel } from './AddPanel';
import { ToolToggles, ToolWindow } from './ToolWindow';
import { VersionsPanel } from './VersionsPanel';

describe('tool windows UI', () => {
  it('ToolToggles labels each window, with counts, and marks the open ones', () => {
    const html = render(
      <ToolToggles open={['findings']} findings={7} versions={2} onToggle={() => {}} />,
    );
    expect(html).toMatch(/aria-pressed="false"[^>]*>Add</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Findings \(7\)</);
    expect(html).toContain('>Versions (2)<');
    expect(html).toContain('>AI model<');
  });
  it('ToolWindow is a named region with a title and a close button', () => {
    const html = render(
      <ToolWindow title="Findings" onClose={() => {}}>
        <p>x</p>
      </ToolWindow>,
    );
    expect(html).toContain('aria-label="Findings"');
    expect(html).toContain('<h2>Findings</h2>');
    expect(html).toContain('aria-label="Close Findings"');
  });
  it('panels no longer render a details wrapper', () => {
    expect(
      render(<AddPanel disabled={false} atLimit={false} iconUrls={{}} onAdd={() => {}} />),
    ).not.toContain('<details');
    expect(render(<VersionsPanel versions={[]} onRestore={() => {}} />)).not.toContain('<details');
  });
});
