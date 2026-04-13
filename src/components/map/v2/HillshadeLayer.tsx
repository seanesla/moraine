import { useEffect, useState } from "react";
import { ImageOverlay } from "react-leaflet";
import type { Lake } from "../../../types/lake";
import { tauriAssetUrl } from "../../../lib/tauriAsset";

type Bounds = [[number, number], [number, number]];

const HILLSHADE_BOUNDS: Record<string, Bounds> = {
  hkh: [
    [26.0, 79.0],
    [35.0, 95.0],
  ],
  andes: [
    [-18.0, -78.0],
    [-8.0, -66.0],
  ],
  alps: [
    [44.0, 6.0],
    [48.0, 14.0],
  ],
  central_asia: [
    [37.0, 70.0],
    [44.0, 80.0],
  ],
};

interface HillshadeLayerProps {
  lake: Lake;
}

export default function HillshadeLayer({ lake }: HillshadeLayerProps) {
  const packId = lake.pack_id;
  const bounds = packId ? HILLSHADE_BOUNDS[packId] : null;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!packId || !bounds) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    const assetUrl = tauriAssetUrl(`packs/${packId}/hillshade.webp`);
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setUrl(assetUrl);
    };
    img.onerror = () => {
      if (!cancelled) setUrl(null);
    };
    img.src = assetUrl;
    return () => {
      cancelled = true;
    };
  }, [packId, bounds]);

  if (!bounds || !url) return null;

  return (
    <ImageOverlay url={url} bounds={bounds} opacity={0.55} interactive={false} />
  );
}
