import '../creator-v2-hotspots.css';
import HotspotsRadar from '../../components/HotspotsRadar';

// V2 route (设计对应表：V2.2 热点雷达 → /hotspots)。独立一级页：
// 真实信源 source-items 流（标题/来源/同步时间/原文链接/同步状态）、
// 搜索与来源筛选、详情面板与移动底部抽屉、「收为选题候选」真实转换。
// 无可信热度/趋势计算依据，页面不展示热度分（偏差登记见
// docs/implementation/CREATOR-V2-DESIGN-DEVIATIONS.md）。
export const metadata = { title: '热点雷达' };
export default function HotspotsPage() {
  return <HotspotsRadar />;
}
