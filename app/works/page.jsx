import '../creator-v2-works.css';
import WorksLibrary from '../../components/WorksLibrary';

// V2 route (设计对应表：V2.2 作品库 → /works)。作品搜索、阶段筛选、
// 创建与继续；主稿与公众号/知乎稿归属同篇作品；打开回到实际作品。
export const metadata = { title: '作品库' };
export default function WorksPage() {
  return <WorksLibrary />;
}
