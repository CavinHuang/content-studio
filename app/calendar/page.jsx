import Link from 'next/link';
import CreatorShell from '../../components/CreatorShell';
import { PageHeader, InlineStatus, SectionCard, EmptyState } from '../../components/creator/primitives';

// V2 route placeholder — the calendar (week/month views over real series
// and project stages) arrives with the implementation pass. There is no
// scheduling backend model yet, so this placeholder fabricates no dates
// and links to the real series planning that exists today.
export const metadata = { title: '内容日历' };

export default function CalendarPage() {
  return (
    <CreatorShell>
      <PageHeader
        eyebrow="CONTENT CALENDAR"
        title="内容日历"
        description="把创作节奏安排得从容一点：只展示已经安排的作品；日历是计划，不会替你发布内容。"
      />
      <InlineStatus tone="info">占位页面：内容日历的正式界面尚未实现，以下是目前可用的真实入口。</InlineStatus>
      <div className="cv2-entry-grid">
        <SectionCard title="内容系列" description="长期系列的节奏与篇目当前在选题页中规划。">
          <Link className="cv2-btn primary" href="/topics?view=series">
            规划内容系列
          </Link>
        </SectionCard>
        <SectionCard title="作品进展" description="待发布与进行中的作品目前通过工作台跟进。">
          <Link className="cv2-btn" href="/">
            打开工作台
          </Link>
        </SectionCard>
      </div>
      <EmptyState
        icon="calendar"
        title="排期视图尚未就绪"
        hint="日历将由实现阶段基于真实的内容系列与作品阶段聚合；无排期时保持诚实的空态，不虚构发布日期。"
      />
    </CreatorShell>
  );
}
