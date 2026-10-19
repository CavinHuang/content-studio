import './creator-v2-home.css';
import CreatorHome from '../../components/CreatorHome';

// Legacy /create deep link — the creation-focused variant of the V2 home
// (quick-create input autofocused). Kept so existing bookmarks and the
// topbar "新建作品" action keep working.
export const metadata = { title: '新建作品' };
export default function Page() {
  return <CreatorHome creation />;
}
