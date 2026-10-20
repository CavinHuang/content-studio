import '../creator-v2-insights.css';
import CreatorInsights from '../../components/CreatorInsights';

// V2 route (设计对应表：V2.2 效果复盘 → /insights)。页面只呈现两类可核对
// 数据：作者手工录入的复盘记录（creator_metrics，标注渠道/录入时间/缺失项）
// 与作者明确确认过的风格学习（style-suggestions accept 决策）。本产品没有
// 平台统计接入：未连接状态显式示「暂无已验证平台数据」，绝不伪造阅读量。
export const metadata = { title: '效果复盘' };
export default function InsightsPage() {
  return <CreatorInsights />;
}
