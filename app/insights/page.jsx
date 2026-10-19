import Link from 'next/link';
import CreatorShell from '../../components/CreatorShell';
import { PageHeader, InlineStatus, SectionCard, EmptyState } from '../../components/creator/primitives';

// V2 route placeholder — /insights becomes the effect-review workspace
// (real author-entered metrics, publishing facts timeline, style
// learning) in the implementation pass. There is no platform-data
// integration endpoint, so nothing is fabricated here.
export const metadata = { title: '效果复盘' };

export default function InsightsPage() {
  return (
    <CreatorShell>
      <PageHeader
        eyebrow="INSIGHTS / LEARNING"
        title="效果复盘"
        description="发布后，让经验回到下一篇：真实表现、写作判断与经作者确认的风格学习。"
      />
      <InlineStatus tone="info">占位页面：效果复盘的正式界面尚未实现，以下是目前可用的真实入口。</InlineStatus>
      <div className="cv2-entry-grid">
        <SectionCard title="发布与效果记录" description="发布链接与复盘数据的录入入口当前在素材库。">
          <Link className="cv2-btn primary" href="/library">
            打开素材库
          </Link>
        </SectionCard>
        <SectionCard title="连接与额度" description="模型连接、发布账号与费用额度在偏好与连接中维护。">
          <Link className="cv2-btn" href="/settings">
            打开偏好与连接
          </Link>
        </SectionCard>
      </div>
      <EmptyState
        icon="book"
        title="暂无已验证平台数据"
        hint="效果复盘页将由实现阶段接入作者手工录入的指标与发布事实时间线。没有可验证数据时不展示任何指标。"
      />
    </CreatorShell>
  );
}
