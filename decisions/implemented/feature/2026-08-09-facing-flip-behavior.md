# Decision: 朝向（flip）行为——素材统一朝左基准 + 动作间连续 + 静态态随机转身

Status: implemented

## Problem

两轮问题。**第一轮**（已实施）：flip 只在两处写入（walk 随机左右、drag 按位移），只在 `showSprite` 时应用——静态陪伴态（idle/think/wait）没有朝向概念：不会随机转身，flip 变化时不刷新 sprite。**第二轮**（本次）：用户指出「素材本身是有朝向的」——逐帧像素审计证实：素材**不是**正面/对称形象（参考图完全对称，但生成的状态素材头部区左右像素比显著偏离 1：idle 2.5、working 1.9、walk 0.35 等），且**各状态朝向不一致**（idle/working/celebrate/error/disappointed/drag/think/wait 偏左；walk/eat/joy/welcome 偏右或混合）——动作切换时角色「瞬间换脸」。

## Decision

- **素材统一朝左基准（角色契约，全角色适用）**：所有状态素材人物默认朝左（flip=1 显示朝左、flip=-1 镜像显示朝右）。生图提示模板加「人物朝向一律朝左」；代码 flip 以朝左为基准（walk 向右走 flip=-1、向左走 flip=1；drag 向左拖 flip=1、向右拖 flip=-1；静态态随机转身 flip 翻转）。**代码不依赖具体角色朝向**——第二个角色遵守素材契约即零代码改动（解耦）。
- **素材修正**：walk/eat/drag/joy/play/wake/welcome 逐帧镜像为偏左（用户肉眼审计清单 + 像素复核镜像精确生效）；所有状态统一朝左。
- **动作间朝向连续**：flip 是模块级状态，walk/drag 的方向写入后，静态态（idle/think/wait）沿用其值渲染（setState 的 showSprite 读当前 flip）——不无谓跳回默认方向。
- **web 拖拽零横向位移保留朝向**：纯纵向移动或重复坐标不表示向右移动；`facingFromDrag` 只在横向位移非零时更新 flip，横向反转仍即时生效。
- **静态态随机转身**：新增纯函数 `nextFacingAt({ now, random })`（间隔 10-25s，L2 语义层代码级）决策转身时刻；tick 里静态态（idle/think/wait）到点时 `flip = -flip` 并 `applyFacing()` 刷新当前 sprite transform（不动帧/背景）；离开静态态清排程。
- **`applyFacing` 刷新封装**：复用 showSprite 的 scale 计算，只更新 transform。
- 沿用 v3/v4 纪律：随机决策在纯函数（注入随机源、可单测），index.mjs 薄执行。

## Alternatives considered

**A：素材层面画朝向（多方向图集）。** AI 生图成本高（每状态每方向重复生成）；flip 是零成本方案且已用 flip 表达方向——弃。

**B：静态态不转身，只保持 walk/drag 方向。** 满足连续性但不满足「随机朝向转换」——宠物长时间面朝一个方向不自然——弃。

**C：转身做成独立动画状态（turn）。** 需要新增素材（转身中间帧）、manifest 条目、spec 总表——成本高；flip 翻转本身已是「转身」视觉（sprite 镜像），无需中间帧——弃。

**D：不统一素材（保留各状态朝向），代码按角色/状态归一化。** 代码需知道每个状态朝向（manifest facing 字段 + 运行时镜像），每个新角色都要声明——违背「代码解耦」目标；统一素材朝左是零代码负担的契约——弃。

## Consequences

- 素材统一朝左：walk/eat/drag/joy/play/wake/welcome 已逐帧镜像；代码 flip 基准改为朝左（walk/drag 方向映射取反）。
- 朝向连续：walk 朝左停下 → idle/think 保持朝左；drag 方向延续；静态态随机转身（10-25s）。
- 第二个角色零代码接入朝向（只需素材朝左）。
- 测试：`nextFacingAt` 确定性测试（注入随机源，区间边界）；单测 102 条全绿，14 门禁全过。
- 素材改动（walk/eat 镜像）+ client 改动：重装 + 刷新生效，无需重启 web。
