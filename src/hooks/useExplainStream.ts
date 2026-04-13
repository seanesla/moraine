import { useCallback, useEffect, useRef } from "react";
import { createWebSocket } from "../lib/api";
import { useInterpretationStore } from "../stores/interpretationStore";
import type {
  InterpretationLanguage,
  InterpretationSection,
} from "../types/interpretation";
import type { Lake } from "../types/lake";
import type { ScenarioParams, ScenarioResult } from "../types/scenario";

/**
 * Client-side protocol for /ws/explain. Short-lived socket:
 *   1. open
 *   2. client sends { scenario_hash, lake, params, result, language }
 *   3. server streams events (see handlers below)
 *   4. server closes after "done" or "error"
 *
 * The hook writes everything into `interpretationStore` keyed by
 * (scenarioHash, language) so the UI never reads from local hook state.
 * That keeps language-switching instant from cache when a slot already exists.
 */

export interface StartExplainArgs {
  scenarioHash: string;
  lake: Lake;
  params: ScenarioParams;
  result: ScenarioResult;
  language: InterpretationLanguage;
}

type ExplainEvent =
  | { type: "cached"; content: string }
  | { type: "start"; language: InterpretationLanguage }
  | { type: "section"; name: InterpretationSection }
  | { type: "delta"; text: string }
  | { type: "alert"; village: string; sms: string }
  | { type: "done" }
  | { type: "error"; message: string };

export function useExplainStream() {
  const wsRef = useRef<WebSocket | null>(null);
  // Keep a snapshot of the current request's identity so late-arriving
  // messages (after a cancel, after switching languages mid-stream) are
  // written to the right slot or dropped cleanly.
  const activeRef = useRef<{ hash: string; lang: InterpretationLanguage } | null>(null);

  const init = useInterpretationStore((s) => s.init);
  const appendDelta = useInterpretationStore((s) => s.appendDelta);
  const noteSection = useInterpretationStore((s) => s.noteSection);
  const finish = useInterpretationStore((s) => s.finish);
  const setFull = useInterpretationStore((s) => s.setFull);
  const setError = useInterpretationStore((s) => s.setError);
  const appendAlert = useInterpretationStore((s) => s.appendAlert);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      try {
        ws.close();
      } catch {
        // ignore — we're discarding it anyway
      }
    }
    wsRef.current = null;
    activeRef.current = null;
  }, []);

  const start = useCallback(
    (args: StartExplainArgs) => {
      const { scenarioHash, lake, params, result, language } = args;

      // Tear down any in-flight request before starting a new one. The user
      // may flip languages mid-stream; the old socket becomes orphaned.
      closeSocket();

      init(scenarioHash, language);
      activeRef.current = { hash: scenarioHash, lang: language };

      const ws = createWebSocket("/ws/explain");
      wsRef.current = ws;

      ws.onopen = () => {
        // The backend expects a single JSON payload immediately on open.
        ws.send(
          JSON.stringify({
            scenario_hash: scenarioHash,
            lake,
            params,
            result,
            language,
          }),
        );
      };

      ws.onmessage = (event) => {
        const active = activeRef.current;
        if (!active) return;
        // Drop messages for stale requests (language flipped before this
        // socket closed).
        if (active.hash !== scenarioHash || active.lang !== language) return;

        let data: ExplainEvent;
        try {
          data = JSON.parse(event.data) as ExplainEvent;
        } catch (err) {
          setError(scenarioHash, language, `Bad server payload: ${String(err)}`);
          return;
        }

        switch (data.type) {
          case "cached":
            setFull(scenarioHash, language, data.content);
            closeSocket();
            break;
          case "start":
            // Nothing to do — status is already "connecting" from init().
            // First delta will flip us to "streaming".
            break;
          case "section":
            noteSection(scenarioHash, language, data.name);
            break;
          case "delta":
            appendDelta(scenarioHash, language, data.text);
            break;
          case "alert":
            appendAlert(scenarioHash, language, data.village, data.sms);
            break;
          case "done":
            finish(scenarioHash, language);
            closeSocket();
            break;
          case "error":
            setError(scenarioHash, language, data.message);
            closeSocket();
            break;
        }
      };

      ws.onerror = () => {
        const active = activeRef.current;
        if (!active) return;
        setError(
          active.hash,
          active.lang,
          "Lost connection to the explain service. Is the backend running?",
        );
      };

      ws.onclose = () => {
        // If the socket closes before "done" / "error" arrived, surface it so
        // the user isn't stuck on a spinner. We leave existing error states
        // alone — they took priority already.
        const active = activeRef.current;
        if (!active) return;
        const slot = useInterpretationStore
          .getState()
          .get(active.hash, active.lang);
        if (slot && slot.status !== "done" && slot.status !== "error") {
          setError(active.hash, active.lang, "The explain stream ended unexpectedly.");
        }
        wsRef.current = null;
        activeRef.current = null;
      };
    },
    [
      appendAlert,
      appendDelta,
      closeSocket,
      finish,
      init,
      noteSection,
      setError,
      setFull,
    ],
  );

  const cancel = useCallback(() => {
    closeSocket();
  }, [closeSocket]);

  // Close any socket we still own when the component unmounts.
  useEffect(() => {
    return () => {
      closeSocket();
    };
  }, [closeSocket]);

  return { start, cancel };
}
