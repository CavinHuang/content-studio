'use client';
// Creator V2 unified shell (shared chrome for all creator workspaces).
// Structure and visual form follow the approved design source
// public/design/creator-v2.2.html:138-139,167 (dark fixed sidebar,
// breadcrumb topbar, mobile bottom tabs + "更多" panel); tokens come
// from public/design/assets/creator-v2-tokens.json via app/creator-v2.css.
// The eleven entries are the eleven formal V2 routes (see
// .superpowers/v2-audit.md §1); unlike the prototype, no demo data and
// no fabricated counts are rendered — the "当前正在推进" card only
// appears when /api/creator/overview really returns a project.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, send } from '../lib/creator-client';
import Icon from './creator/Icon';

// Ten primary workspaces + 偏好与连接 (rendered in the sidebar's lower
// group, as in the V2.2 source) = eleven workspace entries.
const NAV = [
  { href: '/', label: '工作台', icon: 'home' },
  { href: '/hotspots', label: '热点雷达', icon: 'flame' },
  { href: '/topics', label: '选题发现', icon: 'compass' },
  { href: '/compose', label: '创作空间', icon: 'edit' },
  { href: '/illustrations', label: '视觉工作台', icon: 'image' },
  { href: '/works', label: '作品', icon: 'file' },
  { href: '/publish', label: '发布中心', icon: 'send' },
  { href: '/calendar', label: '内容日历', icon: 'calendar' },
  { href: '/insights', label: '效果复盘', icon: 'book' },
  { href: '/library', label: '素材库', icon: 'folder' },
];
const SETTINGS = { href: '/settings', label: '偏好与连接', icon: 'settings' };

// Mobile: five quick entries (tokens.json layout.mobileNavItems) + 更多.
const MOBILE_QUICK = [
  { href: '/', label: '工作台', icon: 'home' },
  { href: '/hotspots', label: '热点', icon: 'flame' },
  { href: '/topics', label: '选题', icon: 'compass' },
  { href: '/works', label: '作品', icon: 'file' },
  { href: '/illustrations', label: '配图', icon: 'image' },
];
const MOBILE_MORE = [
  { href: '/compose', label: '创作空间', icon: 'edit' },
  { href: '/publish', label: '发布中心', icon: 'send' },
  { href: '/calendar', label: '内容日历', icon: 'calendar' },
  { href: '/insights', label: '效果复盘', icon: 'book' },
  { href: '/library', label: '素材库', icon: 'folder' },
  { href: '/settings', label: '偏好与连接', icon: 'settings' },
];

// Fallback breadcrumb names for legacy deep links that still render
// outside the V2 route set (they keep working until their pages are
// migrated; see .superpowers/v2-audit.md §2).
const LEGACY_NAMES = {
  '/create': '新建作品',
  '/compose/handoff': '排版交接',
  '/illustrations/queue': '配图队列',
  '/discover': '发现',
  '/review': '复核',
  '/sources': '信源',
  '/validation': '验证',
  '/knowledge': '知识库',
  '/editor': '编辑器',
  '/delivery': '交付',
  '/signin': '登录',
  '/login': '远程登录',
};

function isActive(path, href) {
  return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}

function currentEntry(path) {
  const all = [...NAV, SETTINGS];
  const hit = all.find((n) => isActive(path, n.href));
  if (hit) return hit;
  if (LEGACY_NAMES[path]) return { label: LEGACY_NAMES[path] };
  const segment = path.split('/')[1];
  return segment ? { label: decodeURIComponent(segment) } : { label: '工作台' };
}

function NavItem({ href, label, icon, active }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      <span className="cv2-nav-icon">
        <Icon name={icon} />
      </span>
      <span>{label}</span>
    </Link>
  );
}

export default function CreatorShell({ children }) {
  const path = usePathname();
  const [author, setAuthor] = useState(null);
  const [managed, setManaged] = useState(false);
  const [current, setCurrent] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const morePanelRef = useRef(null);

  useEffect(() => {
    api('/api/accounts/config')
      .then(async (cfg) => {
        setManaged(cfg.enabled);
        if (cfg.enabled) setAuthor((await api('/api/accounts/me')).author);
      })
      .catch(() => {});
    // Real "当前正在推进": the most recent editorial project. Hidden on
    // failure or when there is nothing in flight — never faked.
    let alive = true;
    api('/api/creator/overview')
      .then((data) => {
        if (!alive) return;
        const project = (data.projects || [])[0];
        if (project && project.id && project.title) setCurrent(project);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Close the mobile "更多" panel whenever navigation happens, on Escape,
  // and return focus to the toggle for keyboard users.
  useEffect(() => {
    setMoreOpen(false);
  }, [path]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    morePanelRef.current?.querySelector('a,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  async function logout() {
    await send('/api/accounts/logout', 'POST');
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('content-studio:')) sessionStorage.removeItem(key);
    window.location.assign('/signin');
  }

  const crumb = currentEntry(path);
  const moreActive = MOBILE_MORE.some((n) => isActive(path, n.href));

  return (
    <div className="cv2-app">
      <a className="cv2-skip" href="#cv2-main">
        跳到主内容
      </a>
      <aside className="cv2-sidebar">
        <Link href="/" className="cv2-logo">
          <span className="cv2-logo-mark" aria-hidden="true">
            c<span>.</span>
          </span>
          <span>
            <h1>Content Studio</h1>
            <small>专注内容，而非操作流程</small>
          </span>
        </Link>
        <div className="cv2-side-label" aria-hidden="true">
          Workspace
        </div>
        <nav className="cv2-nav" aria-label="创作导航">
          {NAV.map((item) => (
            <NavItem key={item.href} {...item} active={isActive(path, item.href)} />
          ))}
        </nav>
        <div className="cv2-side-lower">
          {current ? (
            <div className="cv2-progress">
              <div className="micro">当前正在推进</div>
              <strong>{current.title}</strong>
              <Link href={'/compose?project=' + encodeURIComponent(current.id)}>继续创作 →</Link>
            </div>
          ) : null}
          <nav className="cv2-nav" aria-label="偏好导航">
            <NavItem {...SETTINGS} active={isActive(path, SETTINGS.href)} />
          </nav>
          <div className="cv2-profile">
            <span className="cv2-avatar" aria-hidden="true">
              {(author?.name || '我').slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{author?.name || '我的创作空间'}</strong>
              <small>{managed ? '独立作者工作空间' : '本地工作空间'}</small>
              {managed ? (
                <button type="button" onClick={logout}>
                  退出登录
                </button>
              ) : null}
            </span>
          </div>
        </div>
      </aside>
      <div className="cv2-shell">
        <header className="cv2-topbar">
          <nav className="cv2-crumb" aria-label="面包屑">
            <span>Content Studio</span>
            <span className="cv2-nav-icon" aria-hidden="true">
              <Icon name="chevron" size={12} />
            </span>
            <b>{crumb.label}</b>
          </nav>
          <div className="cv2-topbar-actions">
            <Link className="cv2-small-btn" href="/hotspots">
              <Icon name="flame" size={14} /> 看热点
            </Link>
            <Link className="cv2-small-btn primary" href="/create">
              <Icon name="plus" size={14} /> 新建作品
            </Link>
          </div>
        </header>
        <main id="cv2-main" className="cv2-main creator-main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <nav className="cv2-mobile-tabs" aria-label="移动端导航">
        {MOBILE_QUICK.map((item) => (
          <Link key={item.href} href={item.href} aria-current={isActive(path, item.href) ? 'page' : undefined}>
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          ref={moreButtonRef}
          aria-expanded={moreOpen}
          aria-controls="cv2-mobile-more"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <Icon name="more" />
          更多
        </button>
      </nav>
      {moreOpen ? (
        <div className="cv2-mobile-more" id="cv2-mobile-more" role="dialog" aria-label="更多工作区" ref={morePanelRef}>
          <div className="cv2-mobile-more-head">
            <b>更多工作区</b>
            <button
              type="button"
              className="cv2-btn tiny"
              onClick={() => {
                setMoreOpen(false);
                moreButtonRef.current?.focus();
              }}
            >
              <Icon name="close" size={14} />
              <span className="cv2-visually-hidden">关闭更多菜单</span>
            </button>
          </div>
          {MOBILE_MORE.map((item) => (
            <Link key={item.href} href={item.href} aria-current={isActive(path, item.href) ? 'page' : undefined}>
              <span className="cv2-nav-icon">
                <Icon name={item.icon} size={16} />
              </span>
              {item.label}
              <span className="cv2-nav-icon" aria-hidden="true">
                <Icon name="chevron" size={14} />
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
