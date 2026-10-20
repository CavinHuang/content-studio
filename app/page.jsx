import './creator-v2-home.css';
import CreatorHome from '../components/CreatorHome';

// V2 home workspace (设计对应表：V2.2 工作台 → /)。真实"继续创作"、
// 最近作品、正在创作/待处理/精选线索首屏；首次使用引导与快捷建文。
export const metadata = { title: '工作台' };
export default function Home() {
  return <CreatorHome />;
}
