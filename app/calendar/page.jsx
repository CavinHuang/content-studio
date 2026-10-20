import '../creator-v2-calendar.css';
import CalendarWorkspace from '../../components/CalendarWorkspace';

// V2 route (设计对应表：V2.2 内容日历 → /calendar)。周/月视图基于真实
// 计划（选题 targetDate + 系列下次准备日期）；无排期诚实空态；不捏造
// 发布日期，也不默认自动发布——日历只是计划。
export const metadata = { title: '内容日历' };
export default function CalendarPage() {
  return <CalendarWorkspace />;
}
