import '../creator-v2-settings.css';
import SettingsWorkspace from '../../components/SettingsWorkspace';

// V2 route (设计对应表：V2.2 偏好与连接 → /settings)。创作者画像优先；
// 模型与费用 / 发布账号 / 信源与研究按设计分组呈现而非铺满开关；页面不
// 回显任何密钥（服务端加密保存）。旧 CreatorSettings 组件已随 V2 接管删除；
// 旧深链 #services/#usage/#sources 继续定位到对应分组。
export const metadata = { title: '偏好与连接' };
export default function Page() {
  return <SettingsWorkspace />;
}
