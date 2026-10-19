'use client';
// Creator V2 shared primitives — the unified feedback vocabulary for all
// creator workspaces: page header, section surface, work card, filter
// chips, inline status, error state and empty state. Visual language
// follows the V2.2 design source (public/design/creator-v2.2.html) and
// the token baseline in app/creator-v2.css.
import Link from 'next/link';
import Icon from './Icon';

const STAGE_TONE = {
  草稿中: 'info',
  审稿中: 'info',
  待发布: 'warning',
  已发布: 'success',
};

export function Tag({ tone = 'default', title, children }) {
  return (
    <span className={'cv2-tag' + (tone !== 'default' ? ' ' + tone : '')} title={title || undefined}>
      {children}
    </span>
  );
}

export function PageHeader({ eyebrow, title, description, actions, as = 'h1' }) {
  const Heading = as;
  return (
    <header className="cv2-page-head">
      <div>
        {eyebrow ? <p className="cv2-eyebrow">{eyebrow}</p> : null}
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="cv2-head-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionCard({ title, description, aside, children, pad = true, className = '' }) {
  return (
    <section className={'cv2-surface' + (pad ? ' cv2-surface-pad' : '') + (className ? ' ' + className : '')}>
      {title || aside ? (
        <div className="cv2-section-top">
          <div>
            {title ? <h3>{title}</h3> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {aside ? <div className="cv2-section-aside">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function FilterChips({ label, options, value, onChange }) {
  return (
    <div className="cv2-chips" role="group" aria-label={label}>
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const text = typeof opt === 'string' ? opt : opt.label;
        return (
          <button
            key={val}
            type="button"
            className="cv2-chip"
            aria-pressed={value === val}
            onClick={() => onChange?.(val)}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function InlineStatus({ tone = 'info', busy = false, children }) {
  return (
    <p className={'cv2-status is-' + tone} role="status" aria-busy={busy || undefined}>
      <span className="cv2-status-dot" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function ErrorState({ title = '加载失败', error, hint, onRetry, retryLabel = '重试' }) {
  return (
    <div className="cv2-error-state" role="alert">
      <span className="cv2-error-icon">
        <Icon name="alert" size={20} />
      </span>
      <strong>{title}</strong>
      {error ? <p>{String(error.message || error)}</p> : null}
      {hint ? <p>{hint}</p> : null}
      {onRetry ? (
        <button type="button" className="cv2-btn" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon = 'folder' }) {
  return (
    <div className="cv2-empty">
      <Icon name={icon} size={26} />
      {title ? <strong>{title}</strong> : null}
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}

// stageTone overrides the label→tone lookup so honest stage labels that
// are not in STAGE_TONE (e.g. the works library's "作者报告已发表（未核验）")
// can still render the right tone. Channel entries may be plain strings or
// { name, title } objects whose title becomes the tag's native tooltip.
export function WorkCard({ href, title, subtitle, stage, stageTone, updated, channels = [], footer, onClick }) {
  const head = (
    <div className="cv2-section-top" style={{ marginBottom: 0 }}>
      {stage ? <Tag tone={stageTone || STAGE_TONE[stage] || 'info'}>{stage}</Tag> : <span />}
      {updated ? <span className="cv2-micro">{updated}</span> : null}
    </div>
  );
  const body = (
    <>
      {head}
      <h3>{title}</h3>
      {subtitle ? <p>{subtitle}</p> : null}
      <div className="cv2-work-footer">
        <div className="cv2-chips">
          {channels.map((c, i) => {
            const name = typeof c === 'string' ? c : c?.name;
            if (!name) return null;
            return (
              <Tag key={name + i} title={typeof c === 'string' ? undefined : c?.title}>
                {name}
              </Tag>
            );
          })}
        </div>
        {footer}
      </div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="cv2-work-card">
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="cv2-work-card" onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer' }}>
        {body}
      </button>
    );
  }
  return <article className="cv2-work-card">{body}</article>;
}
