import type { Finding } from '@cloudarchitect/domain';

/** What a component's marker shows: its worst finding's severity, and one line per finding. */
export type Mark = { severity: Finding['severity']; lines: string[] };

const RANK: Record<Finding['severity'], number> = { info: 0, warning: 1, error: 2 };

/**
 * Findings per component (node or container id). A connector finding goes on the component it
 * points at, as clicking the finding does.
 */
export function findingMarks(
  findings: readonly Finding[],
  edges: readonly { id: string; target: string }[],
): Map<string, Mark> {
  const marks = new Map<string, Mark>();
  for (const f of findings) {
    const ids = new Set([
      ...f.nodeIds,
      ...f.containerIds,
      ...f.edgeIds.flatMap((id) => edges.filter((e) => e.id === id).map((e) => e.target)),
    ]);
    const line = f.ruleId ? `${f.ruleId}: ${f.explanation}` : f.explanation;
    for (const id of ids) {
      const mark = marks.get(id);
      if (!mark) marks.set(id, { severity: f.severity, lines: [line] });
      else {
        mark.lines.push(line);
        if (RANK[f.severity] > RANK[mark.severity]) mark.severity = f.severity;
      }
    }
  }
  return marks;
}

/** The marker's drawn size in pixels at 100% zoom (`.mark` in styles.css). */
export const MARK_SIZE = 18;
/** The smallest the marker gets on screen, however far out the canvas is zoomed. */
const MIN_SCREEN_SIZE = 14;

/**
 * How much to enlarge the marker at a canvas zoom level. Markers live inside the components, so
 * they shrink with them; without this a whole-diagram view draws them about 5 pixels wide.
 */
export function markScale(zoom: number): number {
  return Math.max(1, MIN_SCREEN_SIZE / MARK_SIZE / zoom);
}
