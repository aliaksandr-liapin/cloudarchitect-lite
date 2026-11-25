import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AddPanel } from './AddPanel';
import { HelpLink, PanelToggle, ToolToggles, ToolWindow } from './ToolWindow';
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
  it('ToolToggles are one joined group', () => {
    const html = render(<ToolToggles open={[]} findings={0} versions={0} onToggle={() => {}} />);
    expect(html).toContain('class="tool-toggles seg"');
  });
  it('PanelToggle shows and hides the side panel, saying which', () => {
    const open = render(<PanelToggle open onToggle={() => {}} />);
    expect(open).toContain('aria-label="Side panel"');
    expect(open).toContain('aria-pressed="true"');
    expect(open).toContain('title="Hide side panel"');
    expect(render(<PanelToggle open={false} onToggle={() => {}} />)).toContain(
      'title="Show side panel"',
    );
  });
  it('HelpLink opens the user manual in a new tab', () => {
    const html = render(<HelpLink />);
    expect(html).toContain(
      'href="https://github.com/aliaksandr-liapin/cloudarchitect-lite/blob/main/docs/manual/README.md"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('aria-label="User manual"');
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
