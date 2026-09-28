import type { AnimationClip, LocalTransform, LoopMode, OverlayLayer, RigidTransform, RootMotionFrame, RootMotionPlayerConfig, Vec3 } from './types.js';
import { Skeleton } from './skeleton.js';
import { sampleClip, evaluatePose, resolveMaskWeights } from './pose.js';
import { validateClip } from './clip.js';
import { composeLocalMatrix, computeWorldMatrices } from './skeleton.js';
import { composeRigid, identityRigidTransform, invertRigid, matrixToRigid, assertRigidTransform } from './transform.js';
import type { Matrix4 } from 'three';

const UNIT_SCALE_TOLERANCE = 1e-6;

function assertUnitScale(scale: Vec3, what: string): void {
  if (scale.some((s) => Math.abs(s - 1) > UNIT_SCALE_TOLERANCE)) {
    throw new Error(what + ' 根骨骼仅支持单位缩放');
  }
}

function rootTrack(clip: AnimationClip, rootBoneId: string) {
  return clip.tracks.find((track) => track.boneId === rootBoneId);
}

export function assertRootMotionInputs(skeleton: Skeleton, clip: AnimationClip, rootBoneId: string): void {
  if (typeof rootBoneId !== 'string' || rootBoneId.length === 0) {
    throw new Error('根骨骼 ID 不能为空');
  }
  if (!skeleton.hasBone(rootBoneId)) throw new Error('根运动引用了未知骨骼: ' + rootBoneId);
  if (skeleton.parentIndex.get(rootBoneId) !== null) {
    throw new Error('根运动根骨骼必须是顶层骨骼: ' + rootBoneId);
  }
  validateClip(clip, skeleton);
  const bindScale = skeleton.bindLocalTransform(rootBoneId).scale;
  const track = rootTrack(clip, rootBoneId);
  if (!track || !track.scales || track.scales.length === 0) {
    assertUnitScale(bindScale, rootBoneId);
  } else {
    for (const key of track.scales) assertUnitScale(key.value, rootBoneId);
  }
}

function localRigidMatrix(t: LocalTransform): Matrix4 {
  assertUnitScale(t.scale, '');
  return composeLocalMatrix(t.translation, t.rotation, [1, 1, 1]);
}

export function sampleRootMotionStart(
  clip: AnimationClip,
  skeleton: Skeleton,
  rootBoneId: string,
): LocalTransform {
  assertRootMotionInputs(skeleton, clip, rootBoneId);
  const start = sampleClip(clip, skeleton, 0, 'once').get(rootBoneId)!;
  assertUnitScale(start.scale, rootBoneId);
  return {
    translation: [start.translation[0], start.translation[1], start.translation[2]],
    rotation: [start.rotation[0], start.rotation[1], start.rotation[2], start.rotation[3]],
    scale: [1, 1, 1],
  };
}

/** 返回片段时刻根相对片段起始根的刚体位移。 */
export function sampleRootMotion(
  clip: AnimationClip,
  skeleton: Skeleton,
  rootBoneId: string,
  time: number,
  loop: LoopMode,
): RigidTransform {
  const start = sampleRootMotionStart(clip, skeleton, rootBoneId);
  const pose = sampleClip(clip, skeleton, time, loop).get(rootBoneId)!;
  assertUnitScale(pose.scale, rootBoneId);
  const startMatrix = localRigidMatrix(start);
  const currentMatrix = localRigidMatrix(pose);
  return matrixToRigid(startMatrix.clone().invert().multiply(currentMatrix));
}

function rootMotionAt(clip: AnimationClip, skeleton: Skeleton, rootBoneId: string, time: number): RigidTransform {
  return sampleRootMotion(clip, skeleton, rootBoneId, time, 'once');
}

/** 计算播放区间内按时间顺序复合的根运动；跨圈时包含每一圈的末帧。 */
export function rootMotionOverInterval(
  clip: AnimationClip,
  skeleton: Skeleton,
  rootBoneId: string,
  fromTime: number,
  toTime: number,
  loop: LoopMode,
): RigidTransform {
  assertRootMotionInputs(skeleton, clip, rootBoneId);
  if (![fromTime, toTime].every(Number.isFinite) || fromTime < 0 || toTime < fromTime) {
    throw new Error('根运动时间区间非法');
  }
  const duration = clip.duration;
  if (loop === 'once') {
    const a = Math.min(fromTime, duration);
    const b = Math.min(toTime, duration);
    if (a === b) return identityRigidTransform();
    const from = rootMotionAt(clip, skeleton, rootBoneId, a);
    const to = rootMotionAt(clip, skeleton, rootBoneId, b);
    return composeRigid(invertRigid(from), to);
  }
  const cycleA = Math.floor(fromTime / duration);
  const cycleB = Math.floor(toTime / duration);
  const localA = fromTime - cycleA * duration;
  const localB = toTime - cycleB * duration;
  const atA = rootMotionAt(clip, skeleton, rootBoneId, localA);
  const atB = rootMotionAt(clip, skeleton, rootBoneId, localB);
  let absolute = atB;
  const fullCycle = rootMotionAt(clip, skeleton, rootBoneId, duration);
  for (let i = 0; i < cycleB - cycleA; i++) absolute = composeRigid(absolute, fullCycle);
  const motion = composeRigid(invertRigid(atA), absolute);
  return motion;
}

function overlayWithoutRoot(overlay: OverlayLayer | undefined, rootBoneId: string, skeleton: Skeleton): OverlayLayer | undefined {
  if (!overlay) return undefined;
  const previousWeights = overlay.mask ? resolveMaskWeights(skeleton, overlay.mask) : new Map(skeleton.boneIds.map((id) => [id, 1]));
  const mask: Record<string, number> = {};
  for (const id of skeleton.boneIds) mask[id] = previousWeights.get(id)!;
  mask[rootBoneId] = 0;
  return { ...overlay, mask };
}

/** 有状态根运动播放实例；每个实例独立维护时间与角色刚体变换。 */
export class RootMotionPlayer {
  readonly skeleton: Skeleton;
  readonly clip: AnimationClip;
  readonly rootBoneId: string;
  readonly loop: LoopMode;
  private elapsed = 0;
  private characterTransform: RigidTransform;
  private readonly overlay?: OverlayLayer;
  private readonly overlayStartTime: number;
  private readonly rootStart: LocalTransform;

  constructor(config: RootMotionPlayerConfig) {
    if (!config || !config.skeleton || !(config.skeleton instanceof Skeleton)) {
      throw new Error('根运动播放实例需要 Skeleton');
    }
    this.skeleton = config.skeleton;
    this.clip = config.clip;
    this.rootBoneId = config.rootBoneId;
    this.loop = config.loop;
    if (this.loop !== 'once' && this.loop !== 'loop') throw new Error('播放模式必须是 once 或 loop');
    assertRootMotionInputs(this.skeleton, this.clip, this.rootBoneId);
    this.characterTransform = config.initialTransform ? {
      position: [...config.initialTransform.position] as Vec3,
      rotation: [...config.initialTransform.rotation] as [number, number, number, number],
    } : identityRigidTransform();
    assertRigidTransform(this.characterTransform, '初始角色变换');
    this.overlay = overlayWithoutRoot(config.overlay, this.rootBoneId, this.skeleton);
    this.overlayStartTime = config.overlay?.time ?? 0;
    this.rootStart = sampleRootMotionStart(this.clip, this.skeleton, this.rootBoneId);
  }

  get time(): number {
    return this.elapsed;
  }

  get currentTransform(): RigidTransform {
    return {
      position: [...this.characterTransform.position] as Vec3,
      rotation: [...this.characterTransform.rotation] as [number, number, number, number],
    };
  }

  /** 以非负有限时间增量推进；非法增量不改变实例状态。 */
  advance(deltaTime: number): RootMotionFrame {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) {
      throw new Error('推进时间增量必须是非负有限数: ' + String(deltaTime));
    }
    const requestedTime = this.elapsed + deltaTime;
    const nextTime = this.loop === 'once' ? Math.min(requestedTime, this.clip.duration) : requestedTime;
    const motion = rootMotionOverInterval(
      this.clip,
      this.skeleton,
      this.rootBoneId,
      this.elapsed,
      nextTime,
      this.loop,
    );
    const evaluated = evaluatePose(
      this.skeleton,
      { clip: this.clip, time: nextTime, loop: this.loop },
      this.overlay ? { ...this.overlay, time: this.overlayStartTime + nextTime } : undefined,
    );
    evaluated.localPose.set(this.rootBoneId, {
      translation: [...this.rootStart.translation] as Vec3,
      rotation: [...this.rootStart.rotation] as [number, number, number, number],
      scale: [1, 1, 1],
    });
    const worldMatrices = computeWorldMatrices(this.skeleton, evaluated.localPose);
    this.characterTransform = composeRigid(this.characterTransform, motion);
    this.elapsed = nextTime;
    return {
      characterTransform: this.currentTransform,
      localPose: new Map(evaluated.localPose),
      worldMatrices,
      time: this.elapsed,
    };
  }
}
