import { useEffect, useRef } from "react";
import {
  X,
  MapPin,
  RefreshCw,
  Check,
  Loader2,
  Globe,
  Package,
  Download,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import GlassCard from "../common/GlassCard";
import { usePackStore } from "../../stores/packStore";
import type { Pack, PackUpdate, RemotePackEntry } from "../../types/pack";

interface RegionManagerProps {
  open: boolean;
  onClose: () => void;
}

export default function RegionManager({ open, onClose }: RegionManagerProps) {
  const packs = usePackStore((s) => s.packs);
  const activeRegionIds = usePackStore((s) => s.activeRegionIds);
  const toggleRegion = usePackStore((s) => s.toggleRegion);
  const hydrated = usePackStore((s) => s.hydrated);

  // Phase 4: remote update state
  const updateReport = usePackStore((s) => s.updateReport);
  const checkingUpdates = usePackStore((s) => s.checkingUpdates);
  const installingPackId = usePackStore((s) => s.installingPackId);
  const lastInstallMessage = usePackStore((s) => s.lastInstallMessage);
  const checkUpdates = usePackStore((s) => s.checkUpdates);
  const installPack = usePackStore((s) => s.installPack);
  const clearInstallMessage = usePackStore((s) => s.clearInstallMessage);

  // DA #15 polish: focus the close button when the dialog opens so keyboard
  // users don't have to tab through the underlying page first. Restore focus
  // on close.
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    // Defer focus to next frame so the dialog has rendered.
    const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  // Escape key closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Auto-fade success/error messages after a few seconds
  useEffect(() => {
    if (lastInstallMessage?.kind !== "success") return;
    const t = setTimeout(() => clearInstallMessage(), 4000);
    return () => clearTimeout(t);
  }, [lastInstallMessage, clearInstallMessage]);

  if (!open) return null;

  const totalLakes = packs
    .filter((p) => activeRegionIds.includes(p.manifest.id))
    .reduce((sum, p) => sum + p.manifest.lake_count, 0);

  const updatesAvailable = updateReport?.updates_available ?? [];
  const newPacks = updateReport?.new_packs ?? [];
  const updateError = updateReport?.error ?? null;

  // Build a quick lookup so PackRow can show an "Update available" badge
  // for packs that the registry has a newer version of.
  const updateByPackId: Record<string, PackUpdate> = {};
  for (const u of updatesAvailable) updateByPackId[u.id] = u;

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if the click was on the backdrop itself, not on the dialog.
    if (e.target === e.currentTarget) onClose();
  };

  const handleCheckForUpdates = async () => {
    await checkUpdates();
  };

  const handleInstall = async (packId: string) => {
    await installPack(packId);
  };

  return (
    <div
      onMouseDown={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10
        bg-black/55 backdrop-blur-[6px]
        animate-fade-in-up"
      style={{ animationDuration: "0.25s" }}
    >
      <div
        className="relative w-full max-w-[640px] max-h-full flex flex-col
          rounded-2xl overflow-hidden
          bg-[rgba(9,9,11,0.78)] backdrop-blur-[24px] backdrop-saturate-[1.3]
          border border-white/[0.08]
          shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85),0_0_60px_-24px_var(--color-glow-primary),inset_0_1px_0_rgba(255,255,255,0.06)]
          animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg
              bg-primary/10 border border-primary/20
              shadow-[0_0_18px_-6px_var(--color-glow-primary)]">
              <Globe className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-text-primary tracking-tight leading-tight">
                Region Packs
              </h2>
              <p className="text-[11px] text-text-muted mt-0.5">
                {hydrated
                  ? `${totalLakes} lakes from ${activeRegionIds.length} of ${packs.length} regions`
                  : "Loading regions..."}
              </p>
            </div>
          </div>

          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-7 w-7 items-center justify-center rounded-lg
              text-text-muted hover:text-text-primary
              hover:bg-white/[0.06]
              border border-transparent hover:border-white/[0.08]
              transition-all duration-150 cursor-pointer
              focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 text-[10px] text-text-muted">
            <Package className="w-3 h-3" />
            <span className="uppercase tracking-[0.12em] font-semibold">
              Installed
            </span>
            {updatesAvailable.length > 0 && (
              <span className="ml-1 px-1.5 h-[15px] inline-flex items-center rounded
                text-[9px] font-semibold uppercase tracking-wider
                bg-primary/15 border border-primary/30 text-primary
                shadow-[0_0_8px_-3px_var(--color-glow-primary)]">
                {updatesAvailable.length} update{updatesAvailable.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {lastInstallMessage && (
              <span
                className={`flex items-center gap-1 text-[10px] animate-fade-in-up ${
                  lastInstallMessage.kind === "success" ? "text-success" : "text-danger"
                }`}
                style={{ animationDuration: "0.2s" }}
              >
                {lastInstallMessage.kind === "success" ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <AlertTriangle className="w-3 h-3" />
                )}
                <span className="max-w-[260px] truncate">{lastInstallMessage.text}</span>
              </span>
            )}
            <button
              onClick={handleCheckForUpdates}
              disabled={checkingUpdates}
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg
                text-[11px] font-medium
                bg-white/[0.04] hover:bg-white/[0.08]
                border border-white/[0.08] hover:border-white/[0.14]
                text-text-secondary hover:text-text-primary
                transition-all duration-200 cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {checkingUpdates ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              <span>{checkingUpdates ? "Checking..." : "Check for updates"}</span>
            </button>
          </div>
        </div>

        {/* Pack list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {!hydrated && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          )}

          {hydrated && packs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MapPin className="w-6 h-6 text-text-muted/60 mb-2" />
              <p className="text-[12px] text-text-muted">No region packs installed</p>
              <p className="text-[10px] text-text-muted/60 mt-1">
                Updates will be available in a future release
              </p>
            </div>
          )}

          {hydrated && packs.length > 0 && (
            <div className="flex flex-col gap-3">
              {packs.map((pack) => (
                <PackRow
                  key={pack.manifest.id}
                  pack={pack}
                  active={activeRegionIds.includes(pack.manifest.id)}
                  onToggle={() => toggleRegion(pack.manifest.id)}
                  update={updateByPackId[pack.manifest.id]}
                  installing={installingPackId === pack.manifest.id}
                  onInstall={() => handleInstall(pack.manifest.id)}
                />
              ))}
            </div>
          )}

          {/* New packs available from the registry but not yet installed */}
          {hydrated && newPacks.length > 0 && (
            <>
              <div className="flex items-center gap-2 mt-6 mb-3 text-[10px] text-text-muted">
                <Sparkles className="w-3 h-3 text-primary" />
                <span className="uppercase tracking-[0.12em] font-semibold">
                  Available
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {newPacks.map((entry) => (
                  <NewPackRow
                    key={entry.id}
                    entry={entry}
                    installing={installingPackId === entry.id}
                    onInstall={() => handleInstall(entry.id)}
                  />
                ))}
              </div>
            </>
          )}

          {hydrated && updateError && (
            <div className="mt-4 flex items-start gap-2 px-3 py-2 rounded-lg
              bg-danger/[0.08] border border-danger/20 text-[11px] text-danger/90">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="leading-snug">{updateError}</span>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.06]">
          <p className="text-[10px] text-text-muted/70">
            Toggle a region to show or hide its lakes in the sidebar
          </p>
          <kbd className="hidden sm:inline-flex h-5 items-center px-1.5 rounded
            text-[9px] font-mono text-text-muted/80
            bg-white/[0.04] border border-white/[0.08]">
            Esc
          </kbd>
        </div>
      </div>
    </div>
  );
}

interface PackRowProps {
  pack: Pack;
  active: boolean;
  onToggle: () => void;
  update?: PackUpdate;
  installing: boolean;
  onInstall: () => void;
}

function PackRow({ pack, active, onToggle, update, installing, onInstall }: PackRowProps) {
  const m = pack.manifest;
  const hasUpdate = !!update;

  return (
    <GlassCard variant="dense" hover={false} className="p-4">
      <div className="flex items-start gap-4">
        {/* Region icon */}
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
          border transition-all duration-200
          ${active
            ? "bg-primary/10 border-primary/25 shadow-[0_0_18px_-6px_var(--color-glow-primary)]"
            : "bg-white/[0.03] border-white/[0.06]"}`}>
          <MapPin className={`w-4 h-4 transition-colors duration-200 ${
            active ? "text-primary" : "text-text-muted"
          }`} />
        </div>

        {/* Region details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-[13px] font-semibold text-text-primary leading-tight">
              {m.name}
            </h3>
            <span className="text-[10px] font-mono text-text-muted/70">
              v{m.version}
            </span>
            {pack.is_user_installed && !pack.is_bundled && (
              <span className="text-[9px] uppercase tracking-wider text-primary/80 font-semibold">
                User
              </span>
            )}
            {hasUpdate && (
              <span className="inline-flex items-center gap-1 px-1.5 h-[15px] rounded
                text-[9px] font-semibold uppercase tracking-wider
                bg-primary/15 border border-primary/30 text-primary
                shadow-[0_0_8px_-3px_var(--color-glow-primary)]">
                <Sparkles className="w-2.5 h-2.5" />
                v{update!.available_version} available
              </span>
            )}
          </div>

          <p className="text-[11px] text-text-secondary/85 mt-1 leading-relaxed line-clamp-2">
            {m.description}
          </p>

          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
            <span className="font-mono">{m.lake_count} lakes</span>
            <span className="text-text-muted/40">·</span>
            <span className="truncate">{m.source}</span>
            <span className="text-text-muted/40">·</span>
            <span className="font-mono">{m.last_updated}</span>
          </div>

          {hasUpdate && (
            <div className="mt-2.5">
              <button
                onClick={onInstall}
                disabled={installing}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg
                  text-[10px] font-semibold tracking-wide
                  bg-gradient-to-br from-primary via-primary to-primary-hover
                  text-white border border-primary/55
                  shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_8px_24px_-12px_var(--color-glow-primary)]
                  hover:-translate-y-[0.5px] hover:shadow-[0_1px_0_rgba(255,255,255,0.32)_inset,0_12px_28px_-10px_var(--color-glow-primary)]
                  active:translate-y-0
                  transition-all duration-200 cursor-pointer
                  disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {installing ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="w-3 h-3" />
                    Update to v{update!.available_version}
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Toggle switch */}
        <ToggleSwitch active={active} onToggle={onToggle} label={`Toggle ${m.name}`} />
      </div>
    </GlassCard>
  );
}

interface NewPackRowProps {
  entry: RemotePackEntry;
  installing: boolean;
  onInstall: () => void;
}

function NewPackRow({ entry, installing, onInstall }: NewPackRowProps) {
  return (
    <GlassCard variant="dense" hover={false} className="p-4">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
          bg-primary/8 border border-primary/20
          shadow-[0_0_14px_-6px_var(--color-glow-primary)]">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-[13px] font-semibold text-text-primary leading-tight">
              {entry.name}
            </h3>
            <span className="text-[10px] font-mono text-text-muted/70">
              v{entry.version}
            </span>
            <span className="text-[9px] uppercase tracking-wider text-primary/80 font-semibold">
              New
            </span>
          </div>

          <p className="text-[11px] text-text-secondary/85 mt-1 leading-relaxed line-clamp-2">
            {entry.description}
          </p>

          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
            <span className="font-mono">{entry.lake_count} lakes</span>
            <span className="text-text-muted/40">·</span>
            <span className="font-mono">{entry.released}</span>
          </div>

          <div className="mt-2.5">
            <button
              onClick={onInstall}
              disabled={installing}
              className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg
                text-[10px] font-semibold tracking-wide
                bg-gradient-to-br from-primary via-primary to-primary-hover
                text-white border border-primary/55
                shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_8px_24px_-12px_var(--color-glow-primary)]
                hover:-translate-y-[0.5px] hover:shadow-[0_1px_0_rgba(255,255,255,0.32)_inset,0_12px_28px_-10px_var(--color-glow-primary)]
                active:translate-y-0
                transition-all duration-200 cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {installing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="w-3 h-3" />
                  Install
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

interface ToggleSwitchProps {
  active: boolean;
  onToggle: () => void;
  label: string;
}

function ToggleSwitch({ active, onToggle, label }: ToggleSwitchProps) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={active}
      aria-label={label}
      className={`relative shrink-0 mt-1 h-[22px] w-[38px] rounded-full
        transition-all duration-300 cursor-pointer
        border
        ${active
          ? "bg-primary/30 border-primary/40 shadow-[0_0_14px_-4px_var(--color-glow-primary),inset_0_1px_0_rgba(255,255,255,0.15)]"
          : "bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08]"}`}
    >
      <span
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-full
          transition-all duration-300 ease-out
          ${active
            ? "left-[18px] bg-primary shadow-[0_0_10px_var(--color-glow-primary)]"
            : "left-[2px] bg-text-muted/80"}`}
      />
    </button>
  );
}
