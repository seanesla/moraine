import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import FloodMapV2 from "./FloodMapV2";
import type { ScenarioResult } from "../../../types/scenario";
import type { Lake } from "../../../types/lake";

interface FloodMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: ScenarioResult;
  lake: Lake;
}

export default function FloodMapModal({
  isOpen,
  onClose,
  result,
  lake,
}: FloodMapModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="v2-modal-backdrop animate-fade-in-up"
      style={{ animationDuration: "0.25s" }}
      onMouseDown={handleBackdropClick}
    >
      <div
        className="v2-modal-dialog animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flood-map-modal-title"
      >
        <div className="v2-modal-header">
          <div className="v2-modal-title-block">
            <span className="v2-modal-subtitle">Flood Impact Simulation</span>
            <span id="flood-map-modal-title" className="v2-modal-title">
              {lake.name}
            </span>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close flood map"
            className="v2-modal-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="v2-modal-body">
          <FloodMapV2 mode="expanded" result={result} lake={lake} />
        </div>
      </div>
    </div>
  );
}
