// ESLint 9 flat config（Next 16 移除了 `next lint`，改用 ESLint CLI + eslint-config-next 原生 flat 导出）
// 迁移自 .eslintrc.json（extends next/core-web-vitals + 两条规则覆盖，语义不变）
import coreWebVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = [
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'],
  },
  ...coreWebVitals,
  {
    rules: {
      '@next/next/no-img-element': 'off',
      // Three.js/R3F 场景图属性（position/args/intensity 等）非标准 DOM 属性
      'react/no-unknown-property': 'off',
      // eslint-plugin-react-hooks v7 引入的 React Compiler 规则假设纯 React 数据流，
      // 与 R3F 渲染循环范式冲突（useFrame 中 mutate Three.js 对象/读取 ref 是官方推荐做法，
      // 且渲染循环零分配约定依赖复用可变对象），对本项目为大规模误报，予以关闭；
      // 经典 rules-of-hooks 与 exhaustive-deps 保持开启
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default eslintConfig;
