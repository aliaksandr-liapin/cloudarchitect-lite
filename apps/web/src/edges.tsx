import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { EdgeRoute } from './layout';

export type RoutedEdgeData = { route?: EdgeRoute; label?: string };

/** SVG path through the route points: `M x y L x y …`. */
export function routedPath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}

/**
 * Stroke set inline (theme variable; the accent colour while the edge is selected, as the React Flow class would): an exported image carries no stylesheet, so a stroke that only
 * came from the React Flow CSS class would vanish from PNG/SVG exports.
 */
const edgeStroke = (selected?: boolean) => ({
  stroke: selected ? 'var(--accent)' : 'var(--muted)',
  strokeWidth: selected ? 2 : 1.5,
});

/**
 * Draws the ELK route (bend points and label box) while it is valid; once it was dropped (hand move,
 * resize, reload) falls back to a smoothstep path with the label at its midpoint.
 */
export function RoutedEdge(props: EdgeProps) {
  const { route, label } = (props.data ?? {}) as RoutedEdgeData;
  const [smoothPath, smoothX, smoothY] = getSmoothStepPath(props);
  const path = route && route.points.length > 1 ? routedPath(route.points) : smoothPath;
  // A route without a label box keeps the smoothstep label position rather than guessing one.
  const at = route?.label
    ? { x: route.label.x + route.label.width / 2, y: route.label.y + route.label.height / 2 }
    : { x: smoothX, y: smoothY };
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        style={{ ...edgeStroke(props.selected), ...props.style }}
        interactionWidth={props.interactionWidth}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="edge-label nodrag nopan"
            title={label}
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { routed: RoutedEdge };
