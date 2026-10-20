import { Suspense } from 'react';
import '../creator-v2-publish.css';
import PublishCenter from '../../components/PublishCenter';

// V2 route (设计对应表：V2.2 发布中心 → /publish)。正式接管旧 StudioApp
// 的发布入口：按渠道分区（公众号/知乎独立）、四项人工检查与真实交付
// 时间线；导出≠草稿箱≠真实发布，任何外部发布须单独显式授权。
export const metadata = { title: '发布中心' };
export default function PublishPage() {
  return (
    <Suspense fallback={<p style={{ padding: 32 }}>正在打开发布中心…</p>}>
      <PublishCenter />
    </Suspense>
  );
}
