export interface HoverCardContent {
  eyebrow: string;
  title: string;
  short?: string;
  body?: string;
  /** The text this element was generated from, or vice versa. */
  provenance?: string;
  footer?: string;
}

export interface HoverCardProps {
  content: HoverCardContent;
  point: { x: number; y: number };
}

export function HoverCard({ content, point }: HoverCardProps) {
  // Keep the card on screen without needing a measurement pass.
  const width = 320;
  const left = Math.min(Math.max(12, point.x + 16), window.innerWidth - width - 12);
  const flipUp = point.y > window.innerHeight - 260;
  const style = flipUp
    ? { left, bottom: window.innerHeight - point.y + 16, width }
    : { left, top: point.y + 18, width };

  return (
    <div className="hover-card" style={style} role="tooltip">
      <div className="hover-eyebrow">{content.eyebrow}</div>
      <div className="hover-title">{content.title}</div>
      {content.short && <p className="hover-short">{content.short}</p>}
      {content.body && <p className="hover-body">{content.body}</p>}
      {content.provenance && (
        <blockquote className="hover-provenance">{content.provenance}</blockquote>
      )}
      {content.footer && <div className="hover-footer">{content.footer}</div>}
    </div>
  );
}
