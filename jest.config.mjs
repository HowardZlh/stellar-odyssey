import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
  // 核心业务逻辑覆盖率要求（AGENTS.md 要求 80%+，本项目按 90% 执行）：
  // 物理计算、尺度管理、时间系统、动画插值、音效混合、状态管理、数据完整性
  collectCoverageFrom: [
    'src/utils/**/*.ts',
    'src/store/**/*.ts',
    'src/data/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};

export default createJestConfig(config);
