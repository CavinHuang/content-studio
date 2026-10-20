import { redirect } from 'next/navigation';

// Legacy deep link → V2 route. V2.2 names this screen 选题发现, whose
// formal route is /topics (设计对应表：V2.2 选题发现 → /topics)。书签与旧
// 入口保留语义；查询参数原样保留（/topics 支持 ?series=&topic= 深链）。
// 旧 StudioApp 分区继续为 /sources 与 /validation 提供服务（未删除）。
export default async function Page({ searchParams }) {
  const params = (await searchParams) || {};
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  redirect('/topics' + (qs ? '?' + qs : ''));
}
