"use client";

import { useCallback, useEffect, useId, useRef } from "react";

/**
 * A dialog that behaves like one.
 *
 * WCAG 2.2 AA needs all of this and none of it comes for free: focus moves into
 * the dialog on open, Tab cycles inside it rather than escaping to the page
 * behind, Escape closes, and focus returns to whatever opened it. Without the
 * last one a keyboard user is dumped at the top of the document every time they
 * cancel.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const focusables = useCallback(
    () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    focusables()[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      /* Back to the button that opened it, not the top of the page. */
      returnTo.current?.focus();
    };
  }, [focusables, onClose]);

  return (
    <div className="modal-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
      >
        <h2 className="modal-title" id={titleId}>
          {title}
        </h2>
        {description ? (
          <p className="modal-desc" id={descId}>
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
