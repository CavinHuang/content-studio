import '../creator-v2-library.css';
import LibraryWorkspace from '../../components/LibraryWorkspace';

// V2 route (设计对应表：V2.2 素材库 → /library)。可筛选素材、引用来源、
// 图像与关联作品；导入/归档/移除影响/视觉系列全部走真实既有 API，
// 不可用项呈现可操作错误而非静态模拟。
export const metadata = { title: '素材库' };
export default function LibraryPage() {
  return <LibraryWorkspace />;
}
