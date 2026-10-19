// Creator V2 icon set — SVG path data copied from the committed design
// source public/design/creator-v2.2.html (icoPath map, line 124) so the
// production shell renders the exact icons of the approved design.
const PATHS = {
  home: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  flame: '<path d="M12 22c-4.5 0-8-3.4-8-8 0-3.7 2.7-6.8 4.4-8 .1 2.8 1 4 2 4.5C11 7.2 12.7 4.5 15 2c.4 4.8 5 7.1 5 12 0 4.6-3.5 8-8 8Z"/><path d="M12 22c-2.1 0-3.5-1.7-3.5-3.6 0-1.8 1.2-3 2-3.9.7 1 1.6 1.7 2 2.1.5-1.3 1-2.1 1.7-2.9 1 1.5 1.7 3 1.7 4.6 0 2-1.4 3.7-3.9 3.7Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-3 7-4-4 7-3z"/>',
  file: '<path d="M7 3h8l5 5v13H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/><path d="M15 3v5h5M8 13h8M8 17h7"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v10H3V6Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19 13 2-1-2-1-.8-3 1-2-2-2-2 1-3-.8-1-2-1 2-3 .8-2-1-2 2 1 2-.8 3-2 1 2 1 .8 3-1 2 2 2 2-1 3 .8 1 2 1-2 3-.8 2 1 2-2-1-2 .8-3Z"/>',
  book: '<path d="M4 4.5C8 3 12 4 12 7v14c0-3-4-4-8-2V4.5ZM20 4.5c-4-1.5-8-.5-8 2.5v14c0-3 4-4 8-2V4.5Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  edit: '<path d="M15 5 19 9M4 20l4-.8L20 7a2.8 2.8 0 0 0-4-4L4 15l-.8 5Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="M5 5l14 14M19 5 5 19"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
  filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
  bookmark: '<path d="M5 3h14v18l-7-5-7 5V3Z"/>',
  spark: '<path d="m12 2 2.1 7.9L22 12l-7.9 2.1L12 22l-2.1-7.9L2 12l7.9-2.1L12 2Z"/>',
  alert: '<path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
};

export default function Icon({ name, size = 18 }) {
  const d = PATHS[name] || PATHS.compass;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
