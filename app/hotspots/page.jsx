import Link from 'next/link';
import CreatorShell from '../../components/CreatorShell';
import { PageHeader, InlineStatus, SectionCard, EmptyState } from '../../components/creator/primitives';

// V2 route placeholder — /hotspots becomes an independent first-class
// hotspot radar (real source-items feed, detail drawer, convert-to-topic)
// in the implementation pass. Today the real source and topic flows live
// in settings and topics; this placeholder links only there.
export const metadata = { title: '热点雷达' };

export default function HotspotsPage() {
  return (
    <CreatorShell>
      <PageHeader
        eyebrow="HOTSPOT RADAR / SIGNAL MONITORING"
        title="热点雷达"
        description="独立的热点监控页：先发现变化，再筛选与自己相关的方向；选题判断在选题页完成。"
      />
      <InlineStatus tone="info">占位页面：热点雷达的正式界面尚未实现，以下是目前可用的真实入口。</InlineStatus>
      <div className="cv2-entry-grid">
        <SectionCard title="信源管理" description="真实信源的启用、同步与失败状态在偏好与连接中维护。">
          <Link className="cv2-btn" href="/settings">
            打开偏好与连接
          </Link>
        </SectionCard>
        <SectionCard title="选题发现" description="已收集的线索与选题判断当前在选题页进行。">
          <Link className="cv2-btn primary" href="/topics">
            进入选题发现
          </Link>
        </SectionCard>
        <SectionCard title="素材积累" description="公开线索可先沉淀为素材，等待转为选题。">
          <Link className="cv2-btn" href="/library">
            打开素材库
          </Link>
        </SectionCard>
      </div>
      <EmptyState
        icon="flame"
        title="热点流尚未接入"
        hint="热点雷达将由实现阶段接入 source-items 真实数据：标题、来源、时间、原文链接与同步状态。演示分数与虚构热度不会出现在正式页面。"
      />
    </CreatorShell>
  );
}
