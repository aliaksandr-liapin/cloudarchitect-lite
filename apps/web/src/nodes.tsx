import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ContainerNodeData, ServiceNodeData } from './layout';

/**
 * Service node. Official icons are not imported yet (see CLOUD_PROVIDER_CATALOG §2), so every node
 * shows a generic tile that is visibly marked as generic — never a look-alike of an official icon.
 */
export function ServiceNode({ data, selected }: NodeProps) {
  const { node, displayName, variant } = data as ServiceNodeData;
  const unresolved = variant === 'unresolved';
  return (
    <div className={`svc ${selected ? 'is-selected' : ''} is-${variant}`}>
      <Handle type="target" position={Position.Left} />
      <div className="svc-icon" aria-hidden="true" title="Generic icon">
        {unresolved ? '?' : variant === 'external' ? '○' : '▢'}
      </div>
      <div className="svc-text">
        <div className="svc-label">{node.label}</div>
        <div className="svc-service">
          {unresolved ? `${displayName} · not in verified catalog` : displayName}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export function ContainerNode({ data, selected }: NodeProps) {
  const { container } = data as ContainerNodeData;
  const subnet = container.properties?.subnetType;
  return (
    <div
      className={`ctr ctr-${container.kind} ${subnet ? `ctr-${subnet}` : ''} ${selected ? 'is-selected' : ''}`}
    >
      <div className="ctr-label">
        {container.label}
        <span className="ctr-kind">{subnet ? `${subnet} subnet` : container.kind}</span>
      </div>
    </div>
  );
}

export const nodeTypes = { service: ServiceNode, container: ContainerNode };
