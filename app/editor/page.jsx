import { redirect } from 'next/navigation';

// Legacy deep link → V2 route. V2.2 names this screen 创作空间, whose
// formal route is /compose (设计对应表：V2.2 创作空间 → /compose)。
// 旧链接 /editor?project=…&channel=… 原样携带参数跳转，写作工作台直接
// 打开对应作品与渠道稿。
export default async function Page({ searchParams }) {
  const params = (await searchParams) || {};
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  redirect('/compose' + (qs ? '?' + qs : ''));
}
