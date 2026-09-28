# Skeletal Animation 038

TypeScript 5.8 + Three.js 0.180 的可复用骨骼动画库：分层混合（基础层 + 遮罩覆盖层）、根运动播放实例、混合后两骨骼 IK、世界 IK 适配与 CPU 线性蒙皮。

## 命令

- `npm run build` — 构建库到 `dist/`（含类型声明）
- `npm test` — 编译并运行全部单元测试
- `npm run example` — 运行“循环根行走 + 局部挥手 + 固定世界右手 IK + 世界蒙皮顶点”示例

## 数据约定

- **坐标系**：右手坐标，Y 向上。向量 `[x, y, z]`，四元数 `[x, y, z, w]` 且必须为单位四元数。
- **骨骼**（`BoneSpec`）：唯一 `id`、`parentId`（根为 `null`）、绑定局部平移/旋转/正缩放。输入允许乱序；构建时校验重复 ID、未知父级、循环与非法数值（NaN/Infinity、非单位四元数、非正缩放）。
- **矩阵**：局部矩阵按 平移×旋转×缩放 组合；世界矩阵由父级向下累乘；逆绑定矩阵在构建时由绑定姿态求逆。
- **片段**（`AnimationClip`）：正时长；每条轨道按骨骼分别给出平移/旋转/缩放关键帧，时间严格递增且位于 `[0, duration]`。平移与缩放线性插值，旋转沿最短弧球面插值并保持单位四元数；轨道两端之外夹取端值；缺失轨道回退绑定值。
- **采样**：时间必须非负。`once` 停在末帧；`loop` 按时长取模。
- **分层混合**（`evaluatePose`）：一个基础层 + 一个可选覆盖层，各自有独立采样时间与循环模式。覆盖层骨骼权重 = `strength × 遮罩权重`（均 ∈ [0,1]）。遮罩未指定的骨骼继承最近祖先权重，根默认 0，显式 0 屏蔽继承。先混合局部姿态，再由父级累乘世界矩阵——不直接混合世界矩阵。
- **根运动**（`RootMotionPlayer`）：实例持有骨架、基础片段、顶层根骨骼、播放模式、初始角色刚体变换和可选覆盖层。根的平移/旋转以片段 0 秒根变换为参考提取；角色根矩阵为无缩放刚体。`advance(deltaTime)` 只接受非负有限增量，非法增量不推进状态。loop 跨圈按刚体顺序复合整圈运动和余段，分步推进与一次推进一致；once 在末帧冻结。应用根运动后，姿态中的顶层根保持片段 0 秒局部平移/旋转，避免角色矩阵与骨骼姿态双重位移。
- **覆盖层与根运动**：根运动实例沿用旧 `OverlayLayer` 参数；内部强制根权重为 0，所以覆盖层可继续影响手臂等其他骨骼，但不能改变根局部姿态，也不会贡献额外根运动。
- **两骨骼 IK**（`solveTwoBoneIk`）：接收完整局部姿态与直接相连的 `rootJoint -> middleJoint -> endJoint`，在混合姿态后修改根关节和中间关节的局部旋转。目标点与弯曲参考点均为角色空间；局部平移、缩放、骨段长度、末端局部姿态及其余关节保持不变。IK 链及其祖先仅支持单位缩放，骨段平移长度必须非零。
- **IK 夹取与权重**：目标过远/过近时，沿根关节到目标方向夹到两段长度确定的最近可达位置；结果返回 `reachable`、`distanceToTarget`、`actualEndPosition` 和 `clampedTarget`。目标与根重合或弯曲方向共线时优先使用当前弯曲平面，再退化到确定性参考轴。`weight=0` 保持原姿态，`weight=1` 完整贴合，中间值对输入/求解旋转做最短弧插值。
- **世界 IK**（`solveWorldTwoBoneIk`）：把固定世界目标和弯曲参考点用当前角色刚体变换的逆转换到角色空间，再复用 `solveTwoBoneIk`；结果同时返回角色空间末端、`actualWorldEndPosition`、`reachable` 和残差。
- **蒙皮**（`skinVertices`）：输入绑定姿态顶点与每顶点至多 4 个骨骼权重；非负权重归一化后做线性混合蒙皮，输出角色局部空间位置。`skinVerticesToWorld` 只在角色空间蒙皮完成后应用一次角色刚体矩阵，不能把角色世界矩阵再传入骨骼矩阵重复相乘。零总权重顶点保持原位置；未知骨骼与负权重抛错。不修改任何输入，已返回数组/矩阵不会被后续推进改写，多角色实例互不共享状态。

## 快速上手

```ts
import { RootMotionPlayer, Skeleton, solveWorldTwoBoneIk, skinVerticesToWorld } from './dist/index.js';

const skeleton = new Skeleton(bones);            // BoneSpec[]，可乱序
const player = new RootMotionPlayer({
  skeleton,
  clip: walkClip,
  rootBoneId: 'hips',
  loop: 'loop',
  overlay: { clip: waveClip, time: t, loop: 'loop', strength: 1,
    mask: { 'arm.R': 1 } },
});
const frame = player.advance(deltaTime);
const ik = solveWorldTwoBoneIk(skeleton, frame.localPose, {
  rootJointId: 'spine',
  middleJointId: 'arm.R',
  endJointId: 'hand.R',
  target: fixedWorldTarget,
  bendReference: fixedWorldBendReference,
  weight: 1,
  characterTransform: frame.characterTransform,
});
const worldPositions = skinVerticesToWorld(
  skeleton, bindVertices, skinWeights, ik.worldMatrices, frame.characterTransform,
);
```

完整可运行示例见 `examples/walk-wave.ts`，测试用骨架/片段见 `test/helpers.ts`。

## 目录

- `src/types.ts` — 公共类型
- `src/skeleton.ts` — 骨架校验、绑定/世界/逆绑定矩阵
- `src/clip.ts` — 片段校验与关键帧采样
- `src/pose.ts` — 姿态采样、遮罩解析、分层混合
- `src/rootMotion.ts` — 根运动提取、跨圈累计和有状态播放实例
- `src/transform.ts` — 无缩放刚体变换工具
- `src/ik.ts` — 两骨骼 IK 求解、可达范围夹取与权重混合
- `src/worldIk.ts` — 世界目标到角色空间的 IK 适配
- `src/skinning.ts` / `src/worldSkinning.ts` — CPU 角色/世界线性混合蒙皮
- `src/index.ts` — 统一导出入口
