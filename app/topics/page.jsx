import {Suspense} from 'react';
import '../creator-v2-topics.css';
import TopicsDiscovery from '../../components/TopicsDiscovery';

// V2 route (设计对应表：V2.2 选题发现 → /topics)。编辑判断卡
// （读者问题/写作角度/来源依据/证据缺口）+「开始创作」真实建作品跳
// /compose；复杂简报与批量推荐在折叠区；AI 推荐需用户确认且服务配置前置。
export const metadata = { title: '选题发现' };
export default function Page(){
  return (
    <Suspense>
      <TopicsDiscovery />
    </Suspense>
  );
}
