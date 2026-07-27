# 贡献指南

感谢你对星海奥德赛 Stellar Odyssey 的关注！欢迎通过 issue 与 Pull Request 参与项目。

## 贡献者许可协议（CLA）——首次贡献必读

本项目采用 **AGPL-3.0 + 商业授权** 的双许可模式。为保障该模式的法律基础，**所有代码贡献者需签署 [CLA](CLA.md)**（许可授予型，你保留自己贡献的版权）。

签署方式：提交 PR 后，CLA 机器人会自动评论提示，在 PR 中回复以下内容即完成签署（一次签署，永久有效）：

```
I have read the CLA Document and I hereby sign the CLA
```

未签署 CLA 的 PR 无法合并。若对协议条款有疑问，请先开 issue 沟通。

## 提交 issue

- **Bug 报告**：请附复现步骤、浏览器/显卡环境、控制台报错截图
- **功能建议**：请说明使用场景；科学性相关建议请附数据来源（本项目坚持真实天文数据优先）

## 提交 Pull Request

### 流程

1. Fork 本仓库并从 `main` 创建特性分支（如 `feat/xxx`、`fix/xxx`）
2. 完成开发与测试
3. 提交 PR 至 `main`，填写变更说明
4. 通过全部门禁检查 + 维护者 code review 后合并

### 门禁要求（PR 自动检查，全部必须通过）

| 检查 | 内容 |
|---|---|
| `build` | 静态导出构建成功 |
| `test` | TypeScript 类型检查 + 全量单元测试，**覆盖率 ≥90%**（statements/branches/functions/lines） |
| `vulnerability-check` | 生产依赖无 high/critical 已知漏洞 |
| `cla` | CLA 已签署 |

### 代码规范要点

- TypeScript 严格模式，函数须有显式返回类型，禁用 `any`
- 纯逻辑（物理计算、数据处理）放 `src/utils/`，必须附单元测试
- Three.js 对象须正确释放内存；渲染循环内禁止创建新对象（零分配约定）
- 天体物理参数必须基于真实科学数据并注释来源（NASA JPL / SIMBAD 等）；艺术化处理须显式登记
- 用户可见的变更须登记到 `CHANGELOG.md` 的 `[Unreleased]` 区段

### 本地开发命令

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器
npm test             # 单元测试
npm run test:coverage # 覆盖率（gate ≥90%）
npm run type-check   # 类型检查
npm run lint         # ESLint
npm run build        # 静态导出构建
```

## 行为准则

保持友善与专业。对科学问题的争论请基于数据来源，而非立场。
