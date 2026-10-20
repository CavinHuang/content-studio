import { Suspense } from "react";
import "../creator-v2-illustrations.css";
import IllustrationStudio from "../../components/IllustrationStudio";

// V2 route (设计对应表：V2.3 视觉工作台 → /illustrations?project=…)。
// 三栏 studio：图位列表 / 主视觉与候选 / Prompt 与自然语言改图；
// 选中≠批准，明确采用才批准并允许渠道映射与交接；全部走真实 API。
export const metadata = { title: "视觉工作台" };
export default function Page() {
  return (
    <Suspense fallback={<p style={{ padding: 32 }}>正在打开视觉工作台…</p>}>
      <IllustrationStudio />
    </Suspense>
  );
}
