import { redirect } from 'next/navigation';

// Legacy deep link → V2 route. V2.2 names this screen 效果复盘, whose
// formal route is /insights (设计对应表：V2.2 效果复盘 → /insights)。
// 书签与旧入口保留语义；查询参数原样保留。
export default async function Page({ searchParams }) {
  const params = (await searchParams) || {};
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  redirect('/insights' + (qs ? '?' + qs : ''));
}
