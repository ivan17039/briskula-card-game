import React, { useMemo } from "react";
import "./EloWidget.css";
import { useSocket } from "./SocketContext";

// Thresholds (adjustable later or fetched from backend)
const LEVELS = [
  { level: 1, min: 700, max: 849 },
  { level: 2, min: 850, max: 949 },
  { level: 3, min: 950, max: 1049 },
  { level: 4, min: 1050, max: 1149 },
  { level: 5, min: 1150, max: 1249 },
  { level: 6, min: 1250, max: 1349 },
  { level: 7, min: 1350, max: 1499 },
  { level: 8, min: 1500, max: 1649 },
  { level: 9, min: 1650, max: 1849 },
  { level: 10, min: 1850, max: Infinity },
];

function getLevel(elo) {
  return LEVELS.find((l) => elo >= l.min && elo <= l.max) || LEVELS[0];
}

function EloWidget({ compact = false, gameType = "briskula" }) {
  const { user } = useSocket();

  // Guests are unranked: show a subtle CTA or nothing (based on variant)
  if (user && user.isGuest) {
    return (
      <div
        className={`elo-widget unranked ${compact ? "compact" : "full"}`}
        title="ELO je dostupan registriranim igračima"
      >
        <div className="elo-unranked-pill">
          Unranked · Registriraj se za ELO
        </div>
      </div>
    );
  }

  // Get ELO for specific game type, or use average if not specified
  const elo = useMemo(() => {
    if (!user?.elo) return 1000;
    if (typeof user.elo === "number") return user.elo;
    // ELO is an object with briskula/treseta keys
    if (gameType && user.elo[gameType]) return user.elo[gameType];
    // Default to briskula or average
    const briskulaElo = user.elo.briskula || 1000;
    const tresetaElo = user.elo.treseta || 1000;
    return Math.round((briskulaElo + tresetaElo) / 2);
  }, [user?.elo, gameType]);

  const levelInfo = useMemo(() => getLevel(elo), [elo]);
  const currentLevel = levelInfo.level;

  // Progress toward next level (except level 10 infinite)
  const progress = useMemo(() => {
    if (currentLevel === 10) return 1;
    const next = LEVELS.find((l) => l.level === currentLevel + 1);
    if (!next) return 1;
    const span = next.min - levelInfo.min;
    const done = Math.min(Math.max(elo - levelInfo.min, 0), span);
    return span > 0 ? done / span : 0;
  }, [elo, levelInfo, currentLevel]);

  const nextLabel =
    currentLevel === 10 ? "Challenger" : `Lvl ${currentLevel + 1}`;

  const gameLabel = gameType === "treseta" ? "Trešeta" : "Briskula";

  return (
    <div className={`elo-widget ${compact ? "compact" : "full"}`}>
      <div className="elo-left">
        <div className={`elo-badge level-${currentLevel}`}>{currentLevel}</div>
        <div className="elo-numbers">
          <div className="elo-value">{elo} ELO</div>
          <div className="elo-level-label">Level {currentLevel}</div>
        </div>
      </div>
      <div
        className="elo-progress-wrapper"
        title={
          currentLevel === 10 ? "Highest tier" : `Progress to ${nextLabel}`
        }
      >
        <div className="elo-progress-bar">
          <div
            className="elo-progress-fill"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="elo-progress-text">
          {currentLevel === 10
            ? "TOP 10 Soon"
            : `${Math.round(progress * 100)}% → ${nextLabel}`}
        </div>
      </div>
    </div>
  );
}

export default EloWidget;
