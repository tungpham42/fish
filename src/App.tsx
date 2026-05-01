import React, { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";

// --- Global Constants ---
const THORN_WIDTH = 80;
const FISH_SIZE = 48;
const FISH_X_POSITION = 60;
const SEABED_HEIGHT = 80;
const SURFACE_HEIGHT = 40;

type Level = "Easy" | "Medium" | "Hard";

interface LevelConfig {
  gravity: number; // Buoyancy pushing up
  diveStrength: number; // Dive pushing down
  thornSpeed: number;
  thornSpawnRate: number; // ms
  thornGap: number;
}

const LEVEL_CONFIGS: Record<Level, LevelConfig> = {
  Easy: {
    gravity: -0.18,
    diveStrength: 5.0,
    thornSpeed: 3,
    thornSpawnRate: 1800,
    thornGap: 240,
  },
  Medium: {
    gravity: -0.22,
    diveStrength: 6.0,
    thornSpeed: 4.5,
    thornSpawnRate: 1500,
    thornGap: 180,
  },
  Hard: {
    gravity: -0.32,
    diveStrength: 7.0,
    thornSpeed: 6,
    thornSpawnRate: 1100,
    thornGap: 140,
  },
};

type GameState = "MENU" | "PLAYING" | "GAME_OVER";

interface ThornData {
  x: number;
  topHeight: number;
  passed: boolean;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 600 });
  const [gameState, setGameState] = useState<GameState>("MENU");
  const [level, setLevel] = useState<Level>("Medium");

  // Game Engine Logic
  const fishPosRef = useRef<number>(300);
  const fishVelocityRef = useRef<number>(0);
  const thornsRef = useRef<ThornData[]>([]);
  const scoreRef = useRef<number>(0);

  // Timing Refs for Delta Time
  const lastThornSpawnRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const reqIdRef = useRef<number>(0);

  // Use a state tick strictly to force re-renders for the frame loop
  const [, setRenderTick] = useState(0);

  const currentConfig = LEVEL_CONFIGS[level];

  // --- Web Audio API ---
  const audioCtxRef = useRef<AudioContext | null>(null);

  const initAudio = async () => {
    if (!audioCtxRef.current) {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContextClass();
    }
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
  };

  const playDiveSound = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.2);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  }, []);

  const playScoreSound = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.setValueAtTime(900, now + 0.1);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.setValueAtTime(0.15, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  }, []);

  const playCrashSound = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.4);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc.start(now);
    osc.stop(now + 0.4);
  }, []);

  // --- Responsive Resize Handler ---
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        if (gameState === "MENU") {
          fishPosRef.current = containerRef.current.clientHeight / 2;
          setRenderTick((t) => t + 1);
        }
      }
    };
    window.addEventListener("resize", updateSize);
    updateSize();
    return () => window.removeEventListener("resize", updateSize);
  }, [gameState]);

  // --- Unified Game Loop ---
  useEffect(() => {
    if (gameState !== "PLAYING") return;

    const updateLoop = (currentTime: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = currentTime;
      let dt = currentTime - lastTimeRef.current;

      if (dt > 100) dt = 16.66;
      lastTimeRef.current = currentTime;

      const timeScale = dt / 16.66;

      // 1. Apply Physics (Reverse Gravity/Buoyancy)
      fishVelocityRef.current += currentConfig.gravity * timeScale;
      // Slightly stronger terminal velocity clamp to simulate water drag
      if (fishVelocityRef.current < -7) {
        fishVelocityRef.current = -7;
      }
      fishPosRef.current += fishVelocityRef.current * timeScale;

      // 2. Move Thorns
      thornsRef.current = thornsRef.current
        .map((thorn) => ({
          ...thorn,
          x: thorn.x - currentConfig.thornSpeed * timeScale,
        }))
        .filter((thorn) => thorn.x + THORN_WIDTH > -20);

      // 3. Spawner
      if (
        currentTime - lastThornSpawnRef.current >=
        currentConfig.thornSpawnRate
      ) {
        const minThornHeight = 60;
        const maxThornHeight =
          size.height -
          SEABED_HEIGHT -
          SURFACE_HEIGHT -
          currentConfig.thornGap -
          minThornHeight;

        const safeMaxHeight = Math.max(minThornHeight, maxThornHeight);
        const randomHeight =
          Math.floor(Math.random() * (safeMaxHeight - minThornHeight + 1)) +
          minThornHeight;

        thornsRef.current.push({
          x: size.width + 50,
          topHeight: randomHeight,
          passed: false,
        });
        lastThornSpawnRef.current = currentTime;
      }

      // 4. Collision Detection
      const hitboxWidth = 24;
      const hitboxHeight = 24;

      const fishLeft = FISH_X_POSITION + (FISH_SIZE - hitboxWidth) / 2;
      const fishRight = fishLeft + hitboxWidth;
      const fishTop = fishPosRef.current + (FISH_SIZE - hitboxHeight) / 2;
      const fishBottom = fishTop + hitboxHeight;

      let isGameOver = false;

      if (
        fishPosRef.current + FISH_SIZE - 10 >= size.height - SEABED_HEIGHT ||
        fishPosRef.current + 10 <= SURFACE_HEIGHT
      ) {
        isGameOver = true;
      }

      thornsRef.current.forEach((thorn) => {
        // Shave off visual padding for the obstacle collision
        const inThornHorizontalRange =
          fishRight > thorn.x + 15 && fishLeft < thorn.x + THORN_WIDTH - 15;

        const topThornBottom = SURFACE_HEIGHT + thorn.topHeight;
        const bottomThornTop =
          SURFACE_HEIGHT + thorn.topHeight + currentConfig.thornGap;

        const hitTopThorn = fishTop < topThornBottom;
        const hitBottomThorn = fishBottom > bottomThornTop;

        if (inThornHorizontalRange && (hitTopThorn || hitBottomThorn)) {
          isGameOver = true;
        }

        if (!thorn.passed && thorn.x + THORN_WIDTH < fishLeft) {
          thorn.passed = true;
          scoreRef.current += 1;
          playScoreSound();
        }
      });

      if (isGameOver) {
        playCrashSound();
        setGameState("GAME_OVER");
        return;
      }

      setRenderTick((t) => t + 1);
      reqIdRef.current = requestAnimationFrame(updateLoop);
    };

    reqIdRef.current = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(reqIdRef.current);
  }, [gameState, currentConfig, size, playCrashSound, playScoreSound]);

  // --- Controls ---
  const handleDive = useCallback(
    (e?: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
      if (e) e.preventDefault();
      initAudio();
      if (gameState === "PLAYING") {
        playDiveSound();
        fishVelocityRef.current = currentConfig.diveStrength;
      }
    },
    [gameState, currentConfig, playDiveSound],
  );

  const startGame = async (selectedLevel: Level) => {
    await initAudio();
    setLevel(selectedLevel);
    fishPosRef.current = size.height / 2;
    fishVelocityRef.current = 0;
    thornsRef.current = [];
    scoreRef.current = 0;
    lastThornSpawnRef.current = performance.now();
    lastTimeRef.current = performance.now();
    setGameState("PLAYING");
  };

  const returnToMenu = () => {
    setGameState("MENU");
    fishPosRef.current = size.height / 2;
    thornsRef.current = [];
    scoreRef.current = 0;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handleDive();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDive]);

  // Calculate natural fish rotation based on velocity + simulated swimming wobble
  const calculateFishRotation = () => {
    if (gameState !== "PLAYING") {
      return Math.sin(Date.now() / 250) * 10; // Idle wobble
    }
    const baseRotation = Math.min(
      Math.max(fishVelocityRef.current * 7, -35),
      50,
    );
    const swimWobble = Math.sin(Date.now() / 100) * 6; // Quick tail flutter effect
    return baseRotation + swimWobble;
  };

  return (
    <div className="game-wrapper">
      <div
        className={`game-container ${gameState === "GAME_OVER" ? "game-over" : ""}`}
        ref={containerRef}
        onPointerDown={handleDive}
        style={{
          cursor: gameState === "PLAYING" ? "pointer" : "default",
          touchAction: "none",
        }}
      >
        {/* Deep Ocean Vector SVG Background (No Gradients) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 0,
            pointerEvents: "none",
          }}
        >
          <svg
            viewBox="0 0 100 100"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
          >
            {/* Deepest Abyss Base */}
            <rect x="0" y="0" width="100%" height="100%" fill="#020617" />

            {/* Layer 4: Deep Water */}
            <path
              d="M 0 0 L 100 0 L 100 85 Q 70 80 50 85 T 0 82 Z"
              fill="#082f49"
            />
            {/* Layer 3: Mid-Deep Water */}
            <path
              d="M 0 0 L 100 0 L 100 65 Q 80 70 45 62 T 0 66 Z"
              fill="#075985"
            />
            {/* Layer 2: Mid Water */}
            <path
              d="M 0 0 L 100 0 L 100 45 Q 60 40 35 48 T 0 43 Z"
              fill="#0369a1"
            />
            {/* Layer 1: Surface Water */}
            <path
              d="M 0 0 L 100 0 L 100 25 Q 50 30 25 22 T 0 26 Z"
              fill="#0284c7"
            />
          </svg>
        </div>

        {/* Dynamic Sunlight Rays */}
        <div className="light-rays"></div>

        {/* Vertical Rising Bubbles */}
        <div className="bubbles-container">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="bubble"
              style={{
                left: `${15 + i * 15}%`,
                animationDuration: `${6 + (i % 3) * 2}s`,
                animationDelay: `${i * 1.5}s`,
              }}
            >
              <svg
                viewBox="0 0 100 100"
                width={`${20 + (i % 3) * 10}px`}
                height={`${20 + (i % 3) * 10}px`}
              >
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="6"
                />
                <circle cx="35" cy="35" r="8" fill="rgba(255,255,255,0.3)" />
              </svg>
            </div>
          ))}
        </div>

        {gameState === "PLAYING" && (
          <div className="score-display">{scoreRef.current}</div>
        )}

        {gameState === "MENU" && (
          <div className="overlay-panel">
            <h1 className="overlay-title">Softy Fish</h1>
            <p className="overlay-subtitle">Navigate the ocean depths.</p>
            <p className="instruction-text">Tap or Space to Dive ⬇️</p>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              {(Object.keys(LEVEL_CONFIGS) as Level[]).map((lvl) => (
                <button
                  key={lvl}
                  onClick={(e) => {
                    e.stopPropagation();
                    startGame(lvl);
                  }}
                  className={`btn-friendly btn-${lvl.toLowerCase()}`}
                >
                  {lvl} Waters
                </button>
              ))}
            </div>
          </div>
        )}

        {gameState === "GAME_OVER" && (
          <div className="overlay-panel">
            <h2 className="overlay-title">Out of Breath!</h2>
            <p className="overlay-subtitle">
              You navigated {scoreRef.current} obstacles.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                width: "100%",
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startGame(level);
                }}
                className="btn-friendly btn-action"
              >
                Dive Again
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  returnToMenu();
                }}
                className="btn-friendly btn-menu"
              >
                Main Menu
              </button>
            </div>
          </div>
        )}

        {/* The Fish (Natural swimming physics) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: FISH_SIZE,
            height: FISH_SIZE,
            transform: `translate3d(${FISH_X_POSITION}px, ${fishPosRef.current}px, 0) rotate(${calculateFishRotation()}deg)`,
            zIndex: 10,
            transition: gameState === "MENU" ? "transform 0.1s ease" : "none",
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            style={{ overflow: "visible" }}
          >
            {/* Realistic Fins */}
            <path
              d="M 45 25 Q 55 5 70 25 Z"
              fill="#0284c7"
              stroke="#0369a1"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <path
              d="M 35 50 L -5 25 Q 15 50 -5 75 L 35 50 Z"
              fill="#38bdf8"
              stroke="#0369a1"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            {/* Sleek Body */}
            <ellipse
              cx="55"
              cy="50"
              rx="38"
              ry="24"
              fill="#e0f2fe"
              stroke="#0369a1"
              strokeWidth="4"
            />
            <path
              d="M 45 55 Q 60 80 75 60 Z"
              fill="#0284c7"
              stroke="#0369a1"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            {/* Natural Eye */}
            <circle
              cx="75"
              cy="42"
              r="7"
              fill="white"
              stroke="#0369a1"
              strokeWidth="2"
            />
            <circle cx="77" cy="42" r="3.5" fill="#0f172a" />
            <path
              d="M 82 58 Q 88 60 84 64"
              fill="none"
              stroke="#0369a1"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Deep Ocean Obstacles (Dark Kelp/Rock formations) */}
        {thornsRef.current.map((thorn, i) => {
          const bottomThornHeight =
            size.height -
            thorn.topHeight -
            currentConfig.thornGap -
            SURFACE_HEIGHT;

          return (
            <React.Fragment key={i}>
              {/* Top Formation */}
              <div
                style={{
                  position: "absolute",
                  top: SURFACE_HEIGHT,
                  left: 0,
                  width: THORN_WIDTH,
                  height: thorn.topHeight,
                  transform: `translate3d(${thorn.x}px, 0, 0)`,
                  zIndex: 5,
                }}
              >
                <svg
                  width="100%"
                  height="100%"
                  preserveAspectRatio="none"
                  style={{ overflow: "visible" }}
                >
                  <path
                    d={`M 15,-10 L ${THORN_WIDTH - 15},-10 L ${THORN_WIDTH / 2 + 10},${thorn.topHeight - 20} Q ${THORN_WIDTH / 2},${thorn.topHeight} ${THORN_WIDTH / 2 - 10},${thorn.topHeight - 20} Z`}
                    fill="#064e3b"
                    stroke="#022c22"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                  {/* Organic ridges */}
                  <line
                    x1={THORN_WIDTH / 2}
                    y1="-10"
                    x2={THORN_WIDTH / 2 - 5}
                    y2={thorn.topHeight - 30}
                    stroke="#022c22"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                  <line
                    x1={THORN_WIDTH / 2 + 15}
                    y1="-10"
                    x2={THORN_WIDTH / 2 + 5}
                    y2={thorn.topHeight - 50}
                    stroke="#022c22"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                </svg>
              </div>

              {/* Bottom Formation */}
              <div
                style={{
                  position: "absolute",
                  top:
                    SURFACE_HEIGHT + thorn.topHeight + currentConfig.thornGap,
                  left: 0,
                  width: THORN_WIDTH,
                  height: bottomThornHeight,
                  transform: `translate3d(${thorn.x}px, 0, 0)`,
                  zIndex: 5,
                }}
              >
                <svg
                  width="100%"
                  height="100%"
                  preserveAspectRatio="none"
                  style={{ overflow: "visible" }}
                >
                  <path
                    d={`M 15,${bottomThornHeight + 10} L ${THORN_WIDTH - 15},${bottomThornHeight + 10} L ${THORN_WIDTH / 2 + 10},20 Q ${THORN_WIDTH / 2},0 ${THORN_WIDTH / 2 - 10},20 Z`}
                    fill="#064e3b"
                    stroke="#022c22"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                  {/* Organic ridges */}
                  <line
                    x1={THORN_WIDTH / 2}
                    y1={bottomThornHeight + 10}
                    x2={THORN_WIDTH / 2 - 5}
                    y2="30"
                    stroke="#022c22"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                  <line
                    x1={THORN_WIDTH / 2 + 15}
                    y1={bottomThornHeight + 10}
                    x2={THORN_WIDTH / 2 + 5}
                    y2="50"
                    stroke="#022c22"
                    strokeWidth="2"
                    opacity="0.4"
                  />
                </svg>
              </div>
            </React.Fragment>
          );
        })}

        {/* Water Surface (Realistic Top Border) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            width: "100%",
            height: SURFACE_HEIGHT,
            zIndex: 15,
          }}
        >
          <svg width="100%" height="100%" preserveAspectRatio="none">
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="#0ea5e9"
              opacity="0.8"
            />
            {/* Multi-layered flowing waves */}
            <path
              d="M 0 25 Q 40 45 80 25 T 160 25 T 240 25 T 320 25 T 400 25 T 480 25 T 560 25"
              fill="#38bdf8"
              opacity="0.6"
            />
            <path
              d="M 0 35 Q 30 15 60 35 T 120 35 T 180 35 T 240 35 T 300 35 T 360 35 T 420 35 T 480 35 T 540 35"
              fill="#bae6fd"
              opacity="0.4"
            />
            <rect x="0" y="0" width="100%" height="10" fill="#e0f2fe" />
          </svg>
        </div>

        {/* Seabed (Darkened Abyss Border) */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            width: "100%",
            height: SEABED_HEIGHT,
            zIndex: 15,
          }}
        >
          <svg width="100%" height="100%" preserveAspectRatio="none">
            <rect x="0" y="20" width="100%" height="100%" fill="#0f172a" />
            {/* Deep rocky sand bumps */}
            <path
              d="M 0 25 Q 40 5 80 25 T 160 25 T 240 25 T 320 25 T 400 25 T 480 25 T 560 25"
              fill="#1e293b"
            />
            <path
              d="M -20 35 Q 30 10 70 35 T 150 35 T 230 35 T 310 35 T 390 35 T 470 35 T 550 35"
              fill="#334155"
              opacity="0.5"
            />
            {/* Shadowed rocks */}
            <circle cx="15%" cy="55" r="8" fill="#020617" />
            <circle cx="65%" cy="70" r="12" fill="#020617" />
            <circle cx="85%" cy="45" r="6" fill="#020617" />
          </svg>
        </div>
      </div>
    </div>
  );
}
