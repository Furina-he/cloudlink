import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// PRD 7.4：依赖黑名单。业务代码只能用 7.3 映射表指定的实现
const banned = {
  paths: [
    { name: 'framer-motion', message: '动画统一使用 motion/react' },
    { name: 'sonner', message: '通知统一使用 @/components/ui/toast' },
    { name: 'next-themes', message: '主题由模板自带的 ThemeProvider 管理' },
    { name: 'clsx', message: '使用 @/lib/utils 的 cn' },
    { name: 'tailwind-merge', message: '使用 @/lib/utils 的 cn' },
    { name: 'react-markdown', message: 'Markdown 渲染统一使用 streamdown' },
    { name: '@dnd-kit/react', message: '统一使用 @dnd-kit/core 与 @dnd-kit/sortable，不混用两代 API' },
    { name: 'radix-ui', message: '本项目基础库为 Base UI，请使用 @/components/ui/*' },
    { name: 'react-router', message: 'MVP 不引入路由，视图由 useUIStore.view 管理' },
    { name: '@tanstack/react-query', message: '本地 IPC 数据统一放在 Zustand store' },
    { name: '@tauri-apps/api/core', importNames: ['invoke'], message: '只能在 src/lib/ipc.ts 中调用 invoke' },
    { name: '@tauri-apps/api/event', importNames: ['listen'], message: '只能在 src/lib/events.ts 中订阅事件' },
  ],
  patterns: [
    { group: ['@radix-ui/*', '@base-ui/react', '@base-ui/react/*'], message: '业务代码只能从 @/components/ui 引入组件' },
    { group: ['react-icons', 'react-icons/*', '@heroicons/*', '@tabler/icons-react', '@phosphor-icons/*', '@iconify/*', '@hugeicons/*', '@remixicon/*'], message: '图标统一使用 lucide-react' },
    { group: ['@mui/*', 'antd', '@chakra-ui/*', '@mantine/*', '@headlessui/*', 'react-aria-components'], message: 'UI 统一使用 shadcn/ui' },
    { group: ['react-beautiful-dnd', '@hello-pangea/dnd', 'react-dnd', 'sortablejs', 'react-sortablejs'], message: '拖拽统一使用 dnd-kit' },
    { group: ['allotment', 'react-split', 'react-split-pane', 'react-mosaic-component'], message: '布局统一使用 @/components/ui/resizable' },
    { group: ['redux', '@reduxjs/*', 'jotai', 'recoil', 'mobx', 'valtio'], message: '状态统一使用 zustand' },
    { group: ['moment', 'dayjs', 'date-fns', 'luxon'], message: '时间格式化使用 src/lib/format.ts（基于 Intl）' },
    { group: ['prismjs', 'highlight.js', 'react-syntax-highlighter', '@uiw/*', '@monaco-editor/*', 'codemirror', '@codemirror/*'], message: '代码展示统一使用 @/components/ui/code-block' },
    { group: ['react-hot-toast', 'react-toastify', 'notistack'], message: '通知统一使用 @/components/ui/toast' },
  ],
}

export default defineConfig([
  // src-tauri 是 Rust 工程；.claude 是 Coding Agent 的 skill 文件，都不属于前端源码
  globalIgnores(['dist', 'src-tauri', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**', 'src/lib/ipc.ts', 'src/lib/events.ts', 'src/mocks/**'],
    rules: { 'no-restricted-imports': ['error', banned] },
  },
])
