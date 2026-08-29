import React, { useEffect } from "react";

/**
 * Shared modal for all Hub pages (Calls, Leads, Reports, User Management...).
 * Usage:
 *   <HubModal open={open} onClose={() => setOpen(false)} title="..." width={480}>
 *     ...content...
 *   </HubModal>
 */
export default function HubModal({
  open,
  onClose,
  title,
  subtitle,
  width = 460,
  children,
  footer,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="hub-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="hub-modal" style={{ maxWidth: width }}>
        <div className="hub-modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="hub-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="hub-modal-body">{children}</div>

        {footer && <div className="hub-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}