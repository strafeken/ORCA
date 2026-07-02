import { useEffect, useState } from "react";
import { apiFetch } from "../auth/api";

/**
 * useAuthedBlobUrl — fetches `url` through apiFetch (so the Bearer token +
 * CSRF handling ConsultThread already relies on apply here too) and exposes
 * it as a local blob: object URL suitable for <img src>/<audio src>.
 *
 * Why this exists: file/voice downloads are participant-gated API routes
 * (SR-04), not static assets — a plain <img src="/api/conversations/1/files/2">
 * would be sent with no Authorization header at all and simply 401. Every
 * media element in the chat goes through this hook instead of a raw src.
 */
export function useAuthedBlobUrl(url) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    let localUrl = null;

    (async () => {
      try {
        const res = await apiFetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        if (cancelled) return;
        localUrl = URL.createObjectURL(blob);
        setObjectUrl(localUrl);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [url]);

  return { objectUrl, error };
}