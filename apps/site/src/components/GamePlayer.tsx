import { useEffect, useRef, useState } from 'react';

export type Lang = 'en' | 'zh';

/** Localized copy handed to the island so it ships no dictionary of its own. */
export interface GamePlayerStrings {
  coverAlt: string;
  iframeTitle: string;
  start: string;
  fullscreen: string;
  open: string;
  exit: string;
  escHint: string;
  loading: string;
  loaded: string;
  notEmbeddable: string;
  needsDesktop: string;
  openAnyway: string;
}

export interface GamePlayerProps {
  lang: Lang;
  strings: GamePlayerStrings;
  coverUrl: string;
  playUrl: string;
  embeddable: boolean;
  controls: string[];
}

export default function GamePlayer({
  lang,
  strings,
  coverUrl,
  playUrl,
  embeddable,
  controls,
}: GamePlayerProps) {
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [started, setStarted] = useState(false);
  const [mounted, setMounted] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarsePointer(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      delete document.documentElement.dataset.theater;
    };
  }, []);

  const needsDesktop = coarsePointer && !controls.includes('touch');
  const unavailable = !embeddable;

  const start = () => {
    if (unavailable || needsDesktop) return;
    setStarted(true);
    document.documentElement.dataset.theater = 'on';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The stage is capped to the viewport while dimmed; bring it fully into view.
    stageRef.current?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    if (reduceMotion) {
      setMounted(true);
      return;
    }
    timerRef.current = window.setTimeout(() => setMounted(true), 400);
  };

  const exit = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    setMounted(false);
    setStarted(false);
    delete document.documentElement.dataset.theater;
    window.setTimeout(() => startRef.current?.focus(), 0);
  };

  const goFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    void stage.requestFullscreen?.().catch(() => {});
  };

  if (unavailable || needsDesktop) {
    return (
      <div className="game-player" data-pagefind-ignore data-lang={lang}>
        <div className="player-stage">
          <img
            className="player-cover"
            src={coverUrl}
            alt={strings.coverAlt}
            width="1200"
            height="750"
            decoding="async"
          />
        </div>
        <p className="player-message">
          {unavailable ? strings.notEmbeddable : strings.needsDesktop}
        </p>
        <div className="player-actions">
          {unavailable ? (
            <a className="btn btn-primary" href={playUrl} target="_blank" rel="noopener noreferrer">
              {strings.open}
            </a>
          ) : (
            <a className="btn btn-ghost" href={playUrl} target="_blank" rel="noopener noreferrer">
              {strings.openAnyway}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="game-player" data-pagefind-ignore data-lang={lang}>
      <div className="player-stage" ref={stageRef}>
        {mounted ? (
          <iframe
            className="player-frame"
            src={playUrl}
            title={strings.iframeTitle}
            allow="fullscreen; pointer-lock; gamepad; autoplay"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : (
          <>
            <img
              className="player-cover"
              src={coverUrl}
              alt={strings.coverAlt}
              width="1200"
              height="750"
              decoding="async"
            />
            {!started && (
              <div className="player-overlay">
                <button ref={startRef} type="button" className="btn btn-primary" onClick={start}>
                  {strings.start}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {started && (
        <div className="player-controls">
          <button type="button" className="btn btn-on-dark" onClick={goFullscreen}>
            {strings.fullscreen}
          </button>
          <a
            className="btn btn-on-dark"
            href={playUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {strings.open}
          </a>
          <button type="button" className="btn btn-on-dark" onClick={exit}>
            {strings.exit}
          </button>
          <span className="player-hint">{strings.escHint}</span>
          <span className="visually-hidden" aria-live="polite">
            {mounted ? strings.loaded : strings.loading}
          </span>
        </div>
      )}
    </div>
  );
}
