import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { MIN_CONTAINER_SIZE, MIN_NODE_SIZE } from './layout';
import type { ContainerNodeData, ServiceNodeData } from './layout';

export type ResizeRect = { x: number; y: number; width: number; height: number };
/** Editing hooks `App` attaches to the nodes `toFlow` builds. */
export type EditableData = {
  resizable?: boolean;
  onResized?: (id: string, rect: ResizeRect) => void;
  /** Containers only: the smallest box that still holds their children. */
  minSize?: { width: number; height: number };
  /** Containers only: whether a proposed box still holds the children plus padding. */
  fits?: (rect: ResizeRect) => boolean;
  /** Data URL of the official icon, once the pack is ready; absent means a generic tile. */
  iconUrl?: string;
};

/**
 * Service node. Shows the official icon (unaltered, on a neutral tile) when `iconUrl` is set; nodes
 * without one (unresolved, external, or icons not downloaded) show a generic tile that is visibly
 * marked as generic — never a look-alike of an official icon.
 */
export function ServiceNode({ id, data, selected }: NodeProps) {
  const { node, displayName, variant, resizable, onResized, iconUrl } = data as ServiceNodeData &
    EditableData;
  const unresolved = variant === 'unresolved';
  const service = unresolved ? `${displayName} · not in verified catalog` : displayName;
  return (
    <div className={`svc ${selected ? 'is-selected' : ''} is-${variant}`}>
      <NodeResizer
        isVisible={Boolean(selected && resizable)}
        minWidth={MIN_NODE_SIZE.width}
        minHeight={MIN_NODE_SIZE.height}
        onResizeEnd={(_, p) => onResized?.(id, p)}
      />
      <Handle type="target" position={Position.Left} />
      {iconUrl ? (
        <div className="svc-icon is-official">
          <img src={iconUrl} alt="" draggable={false} />
        </div>
      ) : (
        <div className="svc-icon" aria-hidden="true" title="Generic icon">
          {unresolved ? '?' : variant === 'external' ? '○' : '▢'}
        </div>
      )}
      <div className="svc-text">
        <div className="svc-label" title={node.label}>
          {node.label}
        </div>
        <div className="svc-service" title={service}>
          {service}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ContainerNode({ id, data, selected }: NodeProps) {
  const { container, resizable, onResized, minSize, fits, iconUrl } = data as ContainerNodeData &
    EditableData;
  const subnet = container.properties?.subnetType;
  return (
    <div
      className={`ctr ctr-${container.kind} ${subnet ? `ctr-${subnet}` : ''} ${selected ? 'is-selected' : ''}`}
    >
      <NodeResizer
        isVisible={Boolean(selected && resizable)}
        minWidth={minSize?.width ?? MIN_CONTAINER_SIZE.width}
        minHeight={minSize?.height ?? MIN_CONTAINER_SIZE.height}
        shouldResize={(_, p) => fits?.(p) ?? true}
        onResizeEnd={(_, p) => onResized?.(id, p)}
      />
      <div className="ctr-label">
        {iconUrl && <img className="ctr-icon" src={iconUrl} alt="" draggable={false} />}
        {container.label}
        <span className="ctr-kind">{subnet ? `${subnet} subnet` : container.kind}</span>
      </div>
    </div>
  );
}

export const nodeTypes = { service: ServiceNode, container: ContainerNode };
