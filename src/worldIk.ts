import type { LocalTransform, WorldTwoBoneIkRequest, WorldTwoBoneIkResult } from './types.js';
import { Skeleton } from './skeleton.js';
import { solveTwoBoneIk } from './ik.js';
import { assertRigidTransform, invertRigid, transformPoint } from './transform.js';

/** 将固定世界目标转入当前角色空间后复用两骨骼 IK 求解器。 */
export function solveWorldTwoBoneIk(
  skeleton: Skeleton,
  localPose: ReadonlyMap<string, LocalTransform>,
  request: WorldTwoBoneIkRequest,
): WorldTwoBoneIkResult {
  assertRigidTransform(request.characterTransform, '角色变换');
  const characterInverse = invertRigid(request.characterTransform);
  const characterTarget = transformPoint(characterInverse, request.target);
  const characterBend = transformPoint(characterInverse, request.bendReference);
  const result = solveTwoBoneIk(skeleton, localPose, {
    rootJointId: request.rootJointId,
    middleJointId: request.middleJointId,
    endJointId: request.endJointId,
    target: characterTarget,
    bendReference: characterBend,
    weight: request.weight,
  });
  return {
    ...result,
    characterTransform: {
      position: [...request.characterTransform.position] as [number, number, number],
      rotation: [...request.characterTransform.rotation] as [number, number, number, number],
    },
    actualWorldEndPosition: transformPoint(request.characterTransform, result.actualEndPosition),
    worldClampedTarget: transformPoint(request.characterTransform, result.clampedTarget),
  };
}
