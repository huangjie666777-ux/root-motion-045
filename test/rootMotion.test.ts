import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import {
  RootMotionPlayer,
  Skeleton,
  rootMotionOverInterval,
  sampleRootMotion,
  skinVerticesToWorld,
  solveWorldTwoBoneIk,
  transformPoint,
} from '../src/index.js';
import { humanoidBones, rootMotionWalkClip, straightRootWalkClip, waveClip } from './helpers.js';

const skeleton = new Skeleton(humanoidBones());

test('从片段起始根刚体提取平移与旋转', () => {
  const clip = rootMotionWalkClip();
  const motion = sampleRootMotion(clip, skeleton, 'hips', 0.5, 'once');
  assert.deepEqual(motion.position, [0, 0, 0]);
  const moved = transformPoint(motion, [0, 0, 1]);
  assert.ok(Math.abs(moved[0] - 1) < 1e-9);
  assert.ok(Math.abs(moved[2] - 0) < 1e-9);
});

test('loop 跨圈按刚体顺序复合且包含终点', () => {
  const clip = rootMotionWalkClip();
  const motion = rootMotionOverInterval(clip, skeleton, 'hips', 0.5, 1.5, 'loop');
  const p = transformPoint(motion, [0, 0, 0]);
  assert.ok(Math.abs(p[0]) < 1e-9);
  assert.ok(Math.abs(p[2]) < 1e-9);
  const facing = transformPoint(motion, [1, 0, 0]);
  assert.ok(Math.abs(facing[0] + 1) < 1e-9);
  assert.ok(Math.abs(facing[2]) < 1e-9);
});

test('分步推进与一次推进一致，once 到末帧后停止', () => {
  const clip = rootMotionWalkClip();
  const oneShot = new RootMotionPlayer({ skeleton, clip, rootBoneId: 'hips', loop: 'loop' }).advance(0.5);
  const splitA = new RootMotionPlayer({ skeleton, clip, rootBoneId: 'hips', loop: 'loop' });
  splitA.advance(0.25);
  const split = splitA.advance(0.25);
  assert.deepEqual(oneShot.characterTransform, split.characterTransform);
  assert.deepEqual(oneShot.localPose.get('hips'), split.localPose.get('hips'));
  assert.equal(split.time, 0.5);

  const oneShotCross = new RootMotionPlayer({ skeleton, clip, rootBoneId: 'hips', loop: 'loop' }).advance(1.25);
  const splitCrossPlayer = new RootMotionPlayer({ skeleton, clip, rootBoneId: 'hips', loop: 'loop' });
  splitCrossPlayer.advance(0.75);
  const splitCross = splitCrossPlayer.advance(0.5);
  assert.deepEqual(oneShotCross.characterTransform, splitCross.characterTransform);
  assert.deepEqual(oneShotCross.localPose.get('hips'), splitCross.localPose.get('hips'));

  const oncePlayer = new RootMotionPlayer({ skeleton, clip, rootBoneId: 'hips', loop: 'once' });
  const end = oncePlayer.advance(1);
  const stopped = oncePlayer.advance(2);
  assert.deepEqual(stopped.characterTransform, end.characterTransform);
  assert.equal(stopped.time, 1);
  assert.equal(oncePlayer.time, 1);
  assert.deepEqual(stopped.localPose.get('leg.L'), end.localPose.get('leg.L'));
});

test('直线根运动跨圈位移按刚体运动累计，初始变换参与世界定位', () => {
  const clip = straightRootWalkClip();
  const motion = rootMotionOverInterval(clip, skeleton, 'hips', 0.25, 2.2, 'loop');
  assert.deepEqual(motion.position.map((n) => Number(n.toFixed(10))), [1.95, 0, 0]);
  assert.deepEqual(motion.rotation, [0, 0, 0, 1]);

  const player = new RootMotionPlayer({
    skeleton,
    clip,
    rootBoneId: 'hips',
    loop: 'loop',
    initialTransform: { position: [2, 0, 0], rotation: [0, 0, 0, 1] },
  });
  const frame = player.advance(0.5);
  assert.deepEqual(frame.characterTransform.position, [2.5, 0, 0]);
});

test('根姿态保持起始值，覆盖层不能改变根，实例状态独立', () => {
  const clip = straightRootWalkClip();
  const a = new RootMotionPlayer({ skeleton, clip, rootBoneId: 'hips', loop: 'loop' });
  const b = new RootMotionPlayer({ skeleton, clip, rootBoneId: 'hips', loop: 'loop' });
  const fa = a.advance(0.6);
  b.advance(0.2);
  assert.deepEqual(fa.localPose.get('hips')!.translation, [0, 1, 0]);
  assert.deepEqual(fa.localPose.get('hips')!.rotation, [0, 0, 0, 1]);
  assert.deepEqual(fa.localPose.get('hips')!.scale, [1, 1, 1]);
  assert.deepEqual(fa.localPose.get('hips')!.rotation.length, 4);
  assert.ok(Math.abs(a.time - b.time) > 1e-9);

  const withOverlay = new RootMotionPlayer({
    skeleton,
    clip: straightRootWalkClip(),
    rootBoneId: 'hips',
    loop: 'loop',
    overlay: { clip: waveClip(), time: 0, loop: 'loop', strength: 1 },
  }).advance(0.3);
  assert.deepEqual(withOverlay.localPose.get('hips')!.translation, [0, 1, 0]);
  assert.deepEqual(withOverlay.localPose.get('hips')!.rotation, [0, 0, 0, 1]);
  assert.notDeepEqual(withOverlay.localPose.get('arm.R')!.rotation, [0, 0, 0, 1]);
});

test('非法增量不推进状态', () => {
  const player = new RootMotionPlayer({
    skeleton,
    clip: straightRootWalkClip(),
    rootBoneId: 'hips',
    loop: 'loop',
  });
  player.advance(0.4);
  const snapshot = { time: player.time, transform: player.currentTransform };
  assert.throws(() => player.advance(-0.1), /非负有限/);
  assert.throws(() => player.advance(Number.POSITIVE_INFINITY), /非负有限/);
  assert.deepEqual({ time: player.time, transform: player.currentTransform }, snapshot);
});

test('世界 IK 经角色变换适配，蒙皮输出不重复应用世界矩阵', () => {
  const clip = straightRootWalkClip();
  const player = new RootMotionPlayer({ skeleton, clip, rootBoneId: 'hips', loop: 'loop' });
  player.advance(1);
  const frame = player.advance(0.25);
  const worldTarget = [frame.characterTransform.position[0] + 0.5, 1.35, 0] as const;
  const worldBend = [frame.characterTransform.position[0] + 0.1, 2, 0.1] as const;
  const ik = solveWorldTwoBoneIk(skeleton, frame.localPose, {
    rootJointId: 'spine',
    middleJointId: 'arm.R',
    endJointId: 'hand.R',
    target: worldTarget,
    bendReference: worldBend,
    weight: 1,
    characterTransform: frame.characterTransform,
  });
  assert.ok(ik.distanceToTarget < 1e-8);
  assert.ok(new Vector3(...ik.actualWorldEndPosition).distanceTo(new Vector3(...worldTarget)) < 1e-8);
  assert.equal(ik.reachable, true);

  const out = skinVerticesToWorld(
    skeleton,
    [[0.55, 1.35, 0]],
    [[{ boneId: 'hand.R', weight: 1 }]],
    ik.worldMatrices,
    frame.characterTransform,
  );
  assert.deepEqual(out[0].map((n) => Number(n.toFixed(8))), ik.actualWorldEndPosition.map((n) => Number(n.toFixed(8))));
});
