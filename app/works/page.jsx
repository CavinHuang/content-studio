import Link from 'next/link';
import CreatorShell from '../../components/CreatorShell';
import { PageHeader, InlineStatus, SectionCard, EmptyState } from '../../components/creator/primitives';

// V2 route placeholder — the real /works workspace (work cards, stage
// pipeline filters, per-platform drafts) is rebuilt by the page
// implementation pass; this placeholder renders inside the shared shell,
// carries no fake data, and links only to entries that exist today.
export const metadata = { title: '作品库' };

export default function WorksPage() {
  return (
    <CreatorShell>
      <PageHeader
        eyebrow="YOUR LIBRARY / WORKS"
        title="作品库"
        description="作品卡片、阶段筛选与平台稿归属将集中在这里；主稿、公众号稿、知乎稿仍属于同一篇作品。"
      />
      <InlineStatus tone="info">占位页面：作品库的正式界面尚未实现，以下是目前可用的真实入口。</InlineStatus>
      <div className="cv2-entry-grid">
        <SectionCard title="继续创作" description="最近的文章与进行中的作品目前在首页集中呈现。">
          <Link className="cv2-btn" href="/">
            打开工作台
          </Link>
        </SectionCard>
        <SectionCard title="新建作品" description="从一个想法开始，无需先填写复杂表单。">
          <Link className="cv2-btn primary" href="/create">
            新建作品
          </Link>
        </SectionCard>
        <SectionCard title="创作空间" description="已知项目可直接进入创作空间继续编辑。">
          <Link className="cv2-btn" href="/compose">
            进入创作空间
          </Link>
        </SectionCard>
      </div>
      <EmptyState
        icon="file"
        title="作品列表尚未就绪"
        hint="作品库页面将由实现阶段接入 editorial 项目列表后，提供搜索、阶段筛选与渠道归属展示。"
      />
    </CreatorShell>
  );
}
