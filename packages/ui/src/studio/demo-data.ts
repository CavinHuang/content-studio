/**
 * 演示 sources/topics 的共享层转接：权威副本在桌面共享模块（主进程内置示例来源
 * 与渲染端同源引用）。单独成文件以隔离跨包相对路径（文案门禁 E2：页面与数据
 * 模块源码不得出现仓库路径字符串）。
 */
import { DEMO_SOURCES, DEMO_TOPICS } from '../../../desktop/src/shared/discovery-demo'
import type { Source, Topic } from './types'

export const demoSources = structuredClone(DEMO_SOURCES) as Source[]
export const demoTopics = structuredClone(DEMO_TOPICS) as Topic[]
