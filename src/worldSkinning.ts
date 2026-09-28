import type { RigidTransform, SkinInfluence, Vec3 } from './types.js';
import { skinVertices } from './skinning.js';
import type { Skeleton } from './skeleton.js';
import { assertRigidTransform, transformPoint } from './transform.js';
import type { Matrix4 } from 'three';

/** 将角色空间蒙皮结果转换到世界空间；调用方不再额外乘角色矩阵。 */
export function skinVerticesToWorld(
  skeleton: Skeleton,
  vertices: readonly Vec3[],
  weights: readonly (readonly SkinInfluence[])[],
  worldMatrices: ReadonlyMap<string, Matrix4>,
  characterTransform: RigidTransform,
): Vec3[] {
  assertRigidTransform(characterTransform, '角色变换');
  const local = skinVertices(skeleton, vertices, weights, worldMatrices);
  return local.map((p) => transformPoint(characterTransform, p));
}
