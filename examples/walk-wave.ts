/**
 * 完整示例：角色用 loop 根行走向前推进，叠加右臂局部挥手覆盖层；
 * IK 目标固定在世界空间，推进后仍将右手贴合到该目标，并输出世界蒙皮顶点。
 * 运行：npm run example
 */
import {
  RootMotionPlayer,
  Skeleton,
  skinVerticesToWorld,
  solveWorldTwoBoneIk,
  type SkinInfluence,
  type Vec3,
} from '../src/index.js';
import { humanoidBones, straightRootWalkClip, waveClip } from '../test/helpers.js';

const skeleton = new Skeleton(humanoidBones());
const player = new RootMotionPlayer({
  skeleton,
  clip: straightRootWalkClip(),
  rootBoneId: 'hips',
  loop: 'loop',
  overlay: {
    clip: waveClip(),
    time: 0,
    loop: 'loop',
    strength: 1,
    mask: { 'arm.R': 1 },
  },
});

const worldTarget: Vec3 = [1.3, 1.35, 0];
const worldBend: Vec3 = [1.25, 2.1, 0.12];

const fmt = (v: readonly number[]) => v.map((n) => n.toFixed(4)).join(', ');
console.log('=== 固定世界 IK 目标 ===');
console.log('target:      [' + fmt(worldTarget) + ']');
console.log('bend ref:    [' + fmt(worldBend) + ']');

for (const dt of [0.75, 0.5]) {
  const frame = player.advance(dt);
  const ik = solveWorldTwoBoneIk(skeleton, frame.localPose, {
    rootJointId: 'spine',
    middleJointId: 'arm.R',
    endJointId: 'hand.R',
    target: worldTarget,
    bendReference: worldBend,
    weight: 1,
    characterTransform: frame.characterTransform,
  });
  const vertices: Vec3[] = [
    [0.55, 1.35, 0],
    [0, 1.25, 0],
    [9, 9, 9],
  ];
  const weights: SkinInfluence[][] = [
    [{ boneId: 'hand.R', weight: 1 }],
    [{ boneId: 'hips', weight: 1 }, { boneId: 'spine', weight: 1 }],
    [],
  ];
  const worldVertices = skinVerticesToWorld(
    skeleton,
    vertices,
    weights,
    ik.worldMatrices,
    frame.characterTransform,
  );

  console.log('\n=== 推进 ' + dt + 's，累计 t=' + frame.time + 's ===');
  console.log('角色位置:    [' + fmt(frame.characterTransform.position) + ']');
  console.log('hips 局部 T: [' + fmt(frame.localPose.get('hips')!.translation) + '] (根运动不重复进姿态)');
  console.log('世界末端:    [' + fmt(ik.actualWorldEndPosition) + ']');
  console.log('可达:', ik.reachable, ' 残差:', ik.distanceToTarget.toFixed(8));
  console.log('世界蒙皮顶点:');
  worldVertices.forEach((p, i) => console.log('v' + i + ' [' + fmt(p) + ']'));
}
