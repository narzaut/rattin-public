import { useState, useEffect, useRef } from "react";

// BarcodeDetector is not yet in TypeScript's lib.dom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const BarcodeDetector: any;

interface QrScannerProps {
  onScan: (url: string) => void;
  onClose: () => void;
}

export default function QrScanner({ onScan, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const hasDetector = typeof globalThis.BarcodeDetector !== "undefined";

  useEffect(() => {
    if (!hasDetector) return;
    let stopped = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let detector: any;

    async function start() {
      try {
        detector = new BarcodeDetector({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (stopped) { stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.play().catch(() => {}); }
        scan(detector);
      } catch {
        if (!stopped) setError("Could not access camera. Check permissions.");
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function scan(det: any) {
      if (stopped) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2) {
        try {
          const results = await det.detect(v);
          if (results.length > 0) {
            const url = results[0].rawValue;
            if (url && url.includes("/api/rc/auth")) {
              cleanup();
              onScan(url);
              return;
            }
          }
        } catch {}
      }
      requestAnimationFrame(() => scan(det));
    }

    start();

    function cleanup() {
      stopped = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }

    return cleanup;
  }, [hasDetector, onScan]);

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = manualUrl.trim();
    if (url && url.includes("/api/rc/auth")) {
      onScan(url);
    } else if (url) {
      setError("Not a valid pairing URL. Use the full link from the QR code.");
    }
  }

  function handleClose() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    onClose();
  }

  return (
    <div className="qr-scanner-overlay" onClick={handleClose}>
      <div className="qr-scanner-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qr-scanner-header">
          <h3>Scan QR Code</h3>
          <button className="qr-scanner-close" onClick={handleClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {hasDetector && !error ? (
          <div className="qr-scanner-camera">
            <video ref={videoRef} playsInline muted />
            <div className="qr-scanner-frame" />
          </div>
        ) : null}

        {error && <p className="qr-scanner-error">{error}</p>}

        <div className="qr-scanner-manual">
          <p>Or paste the pairing URL:</p>
          <form onSubmit={handleManualSubmit}>
            <input
              type="url"
              placeholder="https://your-server/api/rc/auth?..."
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              autoFocus={!hasDetector}
            />
            <button type="submit">Connect</button>
          </form>
        </div>
      </div>
    </div>
  );
}
