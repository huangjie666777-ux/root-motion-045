import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Quat, RigidTransform, Vec3 } from './types.js';

const QUAT_TOLERANCE = 1e-3;

export function identityRigidTransform(): RigidTransform {
  return { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
}

export function assertRigidTransform(t: RigidTransform, what: string): void {
  if (!t || typeof t !== 'object') throw new Error(what + ' 必须是刚体变换');
  if (!Array.isArray(t.position) || t.position.length !== 3 || !t.position.every(Number.isFinite)) {
    throw new Error(what + ' 平移必须是三个有限数');
  }
  if (!Array.isArray(t.rotation) || t.rotation.length !== 4 || !t.rotation.every(Number.isFinite)) {
    throw new Error(what + ' 旋转含非法数值');
  }
  const len = Math.hypot(...t.rotation);
  if (Math.abs(len - 1) > QUAT_TOLERANCE) throw new Error(what + ' 旋转不是单位四元数');
}

export function rigidToMatrix(t: RigidTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...t.position),
    new Quaternion(...t.rotation),
    new Vector3(1, 1, 1),
  );

}

export function matrixToRigid(m: Matrix4): RigidTransform {
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  m.decompose(position, rotation, scale);
  if ([scale.x, scale.y, scale.z].some((s) => Math.abs(s - 1) > 1e-6)) {
    throw new Error('刚体变换不能包含非单位缩放');
  }
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
}

/** 返回 parent * child：先应用 child，再应用 parent。 */
export function composeRigid(parent: RigidTransform, child: RigidTransform): RigidTransform {
  return matrixToRigid(rigidToMatrix(parent).multiply(rigidToMatrix(child)));
}

export function invertRigid(t: RigidTransform): RigidTransform {
  return matrixToRigid(rigidToMatrix(t).invert());
}

export function transformPoint(t: RigidTransform, p: Vec3): Vec3 {
  const v = new Vector3(...p).applyMatrix4(rigidToMatrix(t));
  return [v.x, v.y, v.z];
}

export function quatFromThree(q: Quaternion): Quat {
  return [q.x, q.y, q.z, q.w];
}
