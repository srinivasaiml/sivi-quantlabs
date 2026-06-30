import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { FoldNode } from './lib/foldingTree';
import type { Point } from './lib/math';
import { FoldState } from './store';

interface BoxProps {
  node: FoldNode;
  isRoot?: boolean;
  myLocalOrigin?: Point;
  parentLocalOrigin?: Point;
  foldAxis?: THREE.Vector3;
  foldAngle?: number;
}

export function BoxNode({ 
  node, 
  isRoot = true, 
  myLocalOrigin, 
  parentLocalOrigin = { x: 0, y: 0 },
  foldAxis = new THREE.Vector3(1, 0, 0),
  foldAngle = 0
}: BoxProps) {
  const groupRef = useRef<THREE.Group>(null);

  const localOrigin = isRoot ? node.face.center : myLocalOrigin!;

  const groupPosition = useMemo(() => {
    if (isRoot) return new THREE.Vector3(0, 0, 0);
    return new THREE.Vector3(
      localOrigin.x - parentLocalOrigin.x,
      -(localOrigin.y - parentLocalOrigin.y), // Y is flipped in 3D
      0
    );
  }, [isRoot, localOrigin, parentLocalOrigin]);

  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    if (node.face.vertices.length > 0) {
      const v0 = node.face.vertices[0];
      shape.moveTo(v0.x - localOrigin.x, -(v0.y - localOrigin.y));
      for (let i = 1; i < node.face.vertices.length; i++) {
        const v = node.face.vertices[i];
        shape.lineTo(v.x - localOrigin.x, -(v.y - localOrigin.y));
      }
      shape.lineTo(v0.x - localOrigin.x, -(v0.y - localOrigin.y));
    }
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 1, // 1 unit thick for cardstock look
      bevelEnabled: false,
    });
    // Center the extrusion so it folds correctly from the middle of the thickness
    geo.translate(0, 0, -0.5);
    geo.computeVertexNormals();
    return geo;
  }, [node, localOrigin]);

  useFrame(() => {
    if (groupRef.current && !isRoot) {
      const angle = foldAngle * FoldState.current;
      groupRef.current.quaternion.setFromAxisAngle(foldAxis, angle);
    }
  });

  return (
    <group ref={groupRef} position={groupPosition}>
      <mesh geometry={geometry}>
        <meshStandardMaterial 
          color="#f1f5f9" 
          side={THREE.DoubleSide} 
          roughness={0.7} 
          metalness={0.1}
        />
        <lineSegments>
          <edgesGeometry args={[geometry]} />
          <lineBasicMaterial color="#94a3b8" />
        </lineSegments>
      </mesh>
      
      {node.children.map((child, i) => {
        const edgeCenter = {
          x: (child.edge.p1.x + child.edge.p2.x) / 2,
          y: (child.edge.p1.y + child.edge.p2.y) / 2,
        };
        
        // Axis vector in global space
        let dx = child.edge.p2.x - child.edge.p1.x;
        let dy = -(child.edge.p2.y - child.edge.p1.y); // Y is flipped
        const len = Math.sqrt(dx*dx + dy*dy);
        const axis = new THREE.Vector3(dx/len, dy/len, 0);

        // Determine fold angle direction. For a closed box, adjacent faces fold 90 degrees inwards.
        // It requires knowing which side of the edge the child face is.
        // To simplify, we'll try Math.PI / 2. If the box turns inside out, we flip it.
        // Or we could use the cross product of the edge and the vector to the child center.
        
        const vecToChild = {
           x: child.node.face.center.x - edgeCenter.x,
           y: -(child.node.face.center.y - edgeCenter.y)
        };
        
        // cross product of axis and vecToChild (Z component)
        // If crossZ > 0, child is on the "left" of the axis → fold inward.
        const crossZ = axis.x * vecToChild.y - axis.y * vecToChild.x;
        const angle  = crossZ > 0 ? child.angle : -child.angle;

        return (
          <BoxNode 
            key={i} 
            node={child.node} 
            isRoot={false}
            myLocalOrigin={edgeCenter}
            parentLocalOrigin={localOrigin}
            foldAxis={axis}
            foldAngle={angle}
          />
        );
      })}
    </group>
  );
}
