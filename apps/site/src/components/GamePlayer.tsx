import { useEffect, useRef, useState } from 'react';

export interface GamePlayerProps {
  title: string;
  coverUrl: string;
  playUrl: string;
  embeddable: boolean;
  controls: string[];
}

export default function GamePlayer({
  title,
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
      <div className="game-player" data-pagefind-ignore>
        <div className="player-stage">
          <img
            className="player-cover"
            src={coverUrl}
            alt={`${title} 封面`}
            width="1200"
            height="750"
            decoding="async"
          />
        </div>
        <p className="player-message">
          {unavailable
            ? '作者的网站不允许嵌入播放。'
            : '这个游戏需要键盘和鼠标，建议在电脑上玩。'}
        </p>
        <div className="player-actions">
          {unavailable ? (
            <a className="btn btn-primary" href={playUrl} target="_blank" rel="noopener noreferrer">
              新窗口打开
            </a>
          ) : (
            <a className="btn btn-ghost" href={playUrl} target="_blank" rel="noopener noreferrer">
              仍然打开
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="game-player" data-pagefind-ignore>
      <div className="player-stage" ref={stageRef}>
        {mounted ? (
          <iframe
            className="player-frame"
            src={playUrl}
            title={`${title} 游戏画面`}
            allow="fullscreen; pointer-lock; gamepad; autoplay"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <>
            <img
              className="player-cover"
              src={coverUrl}
              alt={`${title} 封面`}
              width="1200"
              height="750"
              decoding="async"
            />
            {!started && (
              <div className="player-overlay">
                <button ref={startRef} type="button" className="btn btn-primary" onClick={start}>
                  开始游戏
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {started && (
        <div className="player-controls">
          <button type="button" className="btn btn-on-dark" onClick={goFullscreen}>
            全屏
          </button>
          <a
            className="btn btn-on-dark"
            href={playUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            新窗口打开
          </a>
          <button type="button" className="btn btn-on-dark" onClick={exit}>
            退出游戏
          </button>
          <span className="player-hint">按 Esc 释放鼠标</span>
          <span className="visually-hidden" aria-live="polite">
            {mounted ? '游戏已加载' : '正在加载游戏'}
          </span>
        </div>
      )}
    </div>
  );
}
