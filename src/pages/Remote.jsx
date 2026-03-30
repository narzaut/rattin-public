import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { formatTime } from "../lib/utils";
import "./Remote.css";

export default function Remote() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get("session") || localStorage.getItem("rc-session");
  const token = searchParams.get("token");

  // Set auth token as cookie so nginx bypasses basic auth for the phone
  useEffect(() => {
    if (token) {
      document.cookie = `rc_token=${token}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax`;
      localStorage.setItem("rc-token", token);
    }
  }, [token]);

  // ── Connection state ──
  const [connStatus, setConnStatus] = useState("connecting"); // "connecting" | "connected" | "offline" | "reconnecting" | "lost"
  const [state, setState] = useState(null);
  const esRef = useRef(null);
  const lastStateTs = useRef(0);
  const reconnectCount = useRef(0);
  const offlineSince = useRef(null);

  // ── Optimistic local state (volume, seek, play/pause) ──
  const [localVolume, setLocalVolume] = useState(null); // null = use server value
  const localVolumeTimeout = useRef(null);
  const [seekDragging, setSeekDragging] = useState(false);
  const [seekDragValue, setSeekDragValue] = useState(0);
  const seekBarRef = useRef(null);
  const dragRef = useRef({ dragging: false, value: 0, duration: 0 });

  // ── Last known good values (never show 0:00 / 0:00) ──
  const lastGood = useRef({ currentTime: 0, duration: 0 });
  const [optimisticPlaying, setOptimisticPlaying] = useState(null); // null = use server
  const optimisticPlayingTimeout = useRef(null);
  const [optimisticSeekTime, setOptimisticSeekTime] = useState(null); // null = use server
  const optimisticSeekTimeout = useRef(null);

  // Persist session
  useEffect(() => {
    if (sessionId) localStorage.setItem("rc-session", sessionId);
  }, [sessionId]);

  // ── SSE connection with resilience ──
  useEffect(() => {
    if (!sessionId) return;
    let closed = false;

    function connect() {
      if (closed) return;
      const es = new EventSource(`/api/rc/events?session=${sessionId}&role=remote`);
      esRef.current = es;

      es.addEventListener("state", (e) => {
        const parsed = JSON.parse(e.data);
        lastStateTs.current = Date.now();
        reconnectCount.current = 0;

        // Update lastGood only with meaningful values
        if (parsed.duration > 0) lastGood.current.duration = parsed.duration;
        if (parsed.currentTime > 0 || (parsed.duration > 0 && parsed.currentTime === 0)) {
          lastGood.current.currentTime = parsed.currentTime;
        }

        // Clear optimistic seek if server caught up (within 2s of target)
        if (optimisticSeekTimeout.current && parsed.currentTime > 0) {
          clearTimeout(optimisticSeekTimeout.current);
          optimisticSeekTimeout.current = null;
          setOptimisticSeekTime(null);
        }

        // Clear optimistic play/pause if server matches
        if (optimisticPlaying !== null && parsed.playing === optimisticPlaying) {
          setOptimisticPlaying(null);
        }

        setState(parsed);
      });

      es.addEventListener("connected", () => {
        setConnStatus("connected");
        reconnectCount.current = 0;
        offlineSince.current = null;
      });
      es.addEventListener("disconnected", () => {
        setConnStatus("offline");
        if (!offlineSince.current) offlineSince.current = Date.now();
      });

      es.onopen = () => {
        setConnStatus((prev) => prev === "reconnecting" ? "reconnecting" : "connecting");
      };

      es.onerror = () => {
        reconnectCount.current++;
        if (reconnectCount.current > 1) {
          setConnStatus("reconnecting");
        }
        // After many failed reconnects, mark as lost
        if (reconnectCount.current > 15) {
          setConnStatus("lost");
        }
      };

      return es;
    }

    const es = connect();

    // Watchdog: if no state received in 10s while supposedly connected, mark as reconnecting
    const watchdog = setInterval(() => {
      if (state?.infoHash && Date.now() - lastStateTs.current > 10000 && connStatus === "connected") {
        setConnStatus("reconnecting");
      }
    }, 5000);

    return () => {
      closed = true;
      clearInterval(watchdog);
      if (esRef.current) esRef.current.close();
    };
  }, [sessionId]);

  // ── Send command ──
  const sendCommand = useCallback((action, value) => {
    if (!sessionId) return;
    fetch("/api/rc/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, action, value }),
    }).catch(() => {});
  }, [sessionId]);

  // ── Optimistic play/pause ──
  function handleTogglePlay() {
    const newPlaying = !(state?.playing);
    setOptimisticPlaying(newPlaying);
    clearTimeout(optimisticPlayingTimeout.current);
    optimisticPlayingTimeout.current = setTimeout(() => setOptimisticPlaying(null), 3000);
    sendCommand("toggle-play");
  }

  // ── Optimistic volume ──
  function handleVolumeChange(e) {
    const vol = parseFloat(e.target.value);
    setLocalVolume(vol);
    sendCommand("volume", vol);
    // Clear local override after server state should have caught up
    clearTimeout(localVolumeTimeout.current);
    localVolumeTimeout.current = setTimeout(() => setLocalVolume(null), 2000);
  }

  // ── Optimistic skip ──
  function handleSkip(delta) {
    const ct = getDisplayTime();
    const dur = getDisplayDuration();
    const target = Math.max(0, Math.min(dur, ct + delta));
    setOptimisticSeekTime(target);
    clearTimeout(optimisticSeekTimeout.current);
    optimisticSeekTimeout.current = setTimeout(() => setOptimisticSeekTime(null), 5000);
    sendCommand("seek-relative", delta);
  }

  // ── Seek bar touch/mouse handling ──
  function getSeekRatio(e) {
    const rect = seekBarRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function onSeekStart(e) {
    e.preventDefault();
    dragRef.current.dragging = true;
    dragRef.current.duration = getDisplayDuration();
    setSeekDragging(true);
    const ratio = getSeekRatio(e);
    const val = ratio * dragRef.current.duration;
    dragRef.current.value = val;
    setSeekDragValue(val);
  }

  useEffect(() => {
    if (!seekDragging) return;
    function move(e) {
      if (!dragRef.current.dragging) return;
      const rect = seekBarRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const val = ratio * dragRef.current.duration;
      dragRef.current.value = val;
      setSeekDragValue(val);
    }
    function end() {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      setSeekDragging(false);
      const maxSeekable = dragRef.current.duration * (state?.dlProgress ?? 1);
      const clamped = Math.min(dragRef.current.value, maxSeekable);
      // Optimistic: show seek target immediately
      setOptimisticSeekTime(clamped);
      clearTimeout(optimisticSeekTimeout.current);
      optimisticSeekTimeout.current = setTimeout(() => setOptimisticSeekTime(null), 5000);
      sendCommand("seek", clamped);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", end);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
    };
  }, [seekDragging, sendCommand]);

  // ── Display helpers: never show 0/0, use optimistic values ──
  function getDisplayTime() {
    if (seekDragging) return seekDragValue;
    if (optimisticSeekTime !== null) return optimisticSeekTime;
    const serverTime = state?.currentTime || 0;
    if (serverTime > 0) return serverTime;
    return lastGood.current.currentTime;
  }

  function getDisplayDuration() {
    const serverDur = state?.duration || 0;
    if (serverDur > 0) return serverDur;
    return lastGood.current.duration;
  }

  function getDisplayPlaying() {
    if (optimisticPlaying !== null) return optimisticPlaying;
    return state?.playing ?? false;
  }

  function getDisplayVolume() {
    if (localVolume !== null) return localVolume;
    return state?.volume ?? 1;
  }

  // ── Connection status label ──
  function connLabel() {
    switch (connStatus) {
      case "connected": return "Connected";
      case "connecting": return "Connecting...";
      case "reconnecting": return "Reconnecting...";
      case "offline": return "Player offline";
      default: return "Unknown";
    }
  }

  function connClass() {
    if (connStatus === "connected") return "online";
    if (connStatus === "reconnecting" || connStatus === "connecting") return "reconnecting";
    return "offline";
  }

  // ── No session ──
  if (!sessionId) {
    return (
      <div className="remote-page">
        <div className="remote-no-session">
          <p>No session found. Scan a QR code or open the remote link from your PC.</p>
          <button onClick={() => navigate("/")}>Go Home</button>
        </div>
      </div>
    );
  }

  // ── Connection irrevocably lost ──
  if (connStatus === "lost") {
    return (
      <div className="remote-page">
        <div className="remote-lost">
          <div className="remote-lost-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="var(--text-muted)">
              <path d="M24 8.98C20.93 5.9 16.69 4 12 4S3.07 5.9 0 8.98l2.83 2.83C5.24 9.4 8.42 8 12 8s6.76 1.4 9.17 3.81L24 8.98z" opacity="0.3"/>
              <path d="M2 16l2.83 2.83L12 11.66l7.17 7.17L22 16 12 6 2 16zm10-1.5l4.24 4.24L12 22.98l-4.24-4.24L12 14.5z"/>
            </svg>
          </div>
          <h3 className="remote-lost-title">Connection Lost</h3>
          <p className="remote-lost-desc">
            The remote session was disconnected. Open the pairing screen on your PC player to get a fresh QR code, then scan it to reconnect.
          </p>
          <button className="remote-action-btn" onClick={() => {
            // Clear stale session and retry
            reconnectCount.current = 0;
            offlineSince.current = null;
            setConnStatus("connecting");
            // Re-trigger SSE effect by toggling state
            if (esRef.current) { esRef.current.close(); esRef.current = null; }
            const es = new EventSource(`/api/rc/events?session=${sessionId}&role=remote`);
            esRef.current = es;
            es.addEventListener("state", (e) => {
              const parsed = JSON.parse(e.data);
              lastStateTs.current = Date.now();
              reconnectCount.current = 0;
              if (parsed.duration > 0) lastGood.current.duration = parsed.duration;
              if (parsed.currentTime > 0) lastGood.current.currentTime = parsed.currentTime;
              if (optimisticSeekTimeout.current) {
                clearTimeout(optimisticSeekTimeout.current);
                optimisticSeekTimeout.current = null;
                setOptimisticSeekTime(null);
              }
              setState(parsed);
            });
            es.addEventListener("connected", () => { setConnStatus("connected"); reconnectCount.current = 0; offlineSince.current = null; });
            es.addEventListener("disconnected", () => { setConnStatus("offline"); });
            es.onerror = () => {
              reconnectCount.current++;
              if (reconnectCount.current > 15) setConnStatus("lost");
              else if (reconnectCount.current > 1) setConnStatus("reconnecting");
            };
          }}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const hasPlayback = state && state.infoHash;
  const ct = getDisplayTime();
  const dur = getDisplayDuration();
  const progress = dur > 0 ? (ct / dur) * 100 : 0;
  const dlProgress = state?.dlProgress ?? 1;
  const dlPct = dlProgress * 100;
  const isPlaying = getDisplayPlaying();
  const volume = getDisplayVolume();

  // ── No active playback ──
  if (!hasPlayback) {
    return (
      <div className="remote-page">
        <div className="remote-waiting">
          <div className={`remote-status ${connClass()}`}>
            <span className="remote-status-dot" />
            {connLabel()}
          </div>
          <p className="remote-waiting-text">No active playback. Browse content to start playing.</p>
          <button className="remote-action-btn" onClick={() => navigate(`/?session=${sessionId}`)}>
            Browse Content
          </button>
        </div>
      </div>
    );
  }

  // ── Active playback — remote controls ──
  return (
    <div className="remote-page">
      <div className={`remote-status ${connClass()}`}>
        <span className="remote-status-dot" />
        {connLabel()}
      </div>

      <div className="remote-title-area">
        <h2 className="remote-title">{state.title || "Playing"}</h2>
        {state.tags?.length > 0 && (
          <div className="remote-tags">
            {state.tags.map((t) => <span key={t} className="remote-tag">{t}</span>)}
          </div>
        )}
      </div>

      <div className="remote-play-area">
        <button className="remote-skip-btn" onClick={() => handleSkip(-10)}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
          </svg>
          <span>10</span>
        </button>
        <button className="remote-play-btn" onClick={handleTogglePlay}>
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <button className="remote-skip-btn" onClick={() => handleSkip(10)}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M11.5 8c2.65 0 5.05.99 6.9 2.6L22 7v9h-9l3.62-3.62C15.23 11.22 13.46 10.5 11.5 10.5c-3.54 0-6.55 2.31-7.6 5.5L1.53 15.22C2.92 11.03 6.85 8 11.5 8z"/>
          </svg>
          <span>10</span>
        </button>
      </div>

      <div className="remote-seek-area">
        <span className="remote-time">{formatTime(ct)}</span>
        <div
          className="remote-seek-bar"
          ref={seekBarRef}
          onMouseDown={onSeekStart}
          onTouchStart={onSeekStart}
        >
          <div className="remote-seek-track">
            <div className="remote-seek-downloaded" style={{ width: `${dlPct}%` }} />
            <div className="remote-seek-fill" style={{ width: `${progress}%` }} />
            <div className="remote-seek-thumb" style={{ left: `${progress}%` }} />
          </div>
        </div>
        <span className="remote-time">{formatTime(dur)}</span>
      </div>

      <div className="remote-volume-row">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-secondary)">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
        </svg>
        <input
          type="range"
          className="remote-volume-slider"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={handleVolumeChange}
        />
      </div>

      {state.subs?.length > 0 && (
        <div className="remote-sub-row">
          <select
            className="remote-sub-select"
            value={state.activeSub || ""}
            onChange={(e) => sendCommand("subtitle", e.target.value)}
          >
            <option value="">Subtitles Off</option>
            {state.subs.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="remote-bottom-row">
        <button className="remote-browse-btn" onClick={() => navigate(`/?session=${sessionId}`)}>
          Browse
        </button>
        <button className="remote-fullscreen-btn" onClick={() => sendCommand("toggle-fullscreen")}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
          </svg>
        </button>
        <button className="remote-stop-btn" onClick={() => sendCommand("stop-stream")}>
          Stop
        </button>
      </div>
    </div>
  );
}
