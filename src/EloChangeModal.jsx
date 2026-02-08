import React, { useEffect, useState } from "react";
import "./EloChangeModal.css";

function EloChangeModal({
  isWinner,
  eloChange,
  oldElo,
  newElo,
  oldLevel,
  newLevel,
  onClose,
}) {
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Trigger animation after mount
    const timer = setTimeout(() => setShowContent(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const levelUp = newLevel > oldLevel;
  const levelDown = newLevel < oldLevel;

  return (
    <div className="elo-modal-overlay" onClick={onClose}>
      <div
        className={`elo-modal-content ${showContent ? "show" : ""} ${
          isWinner ? "winner" : "loser"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="elo-modal-header">
          <div className="result-emoji">{isWinner ? "🎉" : "😔"}</div>
          <h2>{isWinner ? "Pobjeda!" : "Poraz"}</h2>
        </div>

        <div className="elo-change-display">
          <div
            className={`elo-delta ${eloChange >= 0 ? "positive" : "negative"}`}
          >
            {eloChange >= 0 ? "+" : ""}
            {eloChange} ELO
          </div>
          <div className="elo-progression">
            <span className="old-elo">{oldElo}</span>
            <span className="arrow">→</span>
            <span className="new-elo">{newElo}</span>
          </div>
        </div>

        {(levelUp || levelDown) && (
          <div
            className={`level-change ${levelUp ? "level-up" : "level-down"}`}
          >
            {levelUp && (
              <>
                <div className="level-icon">🎊</div>
                <p>Čestitamo! Napredovali ste na Level {newLevel}</p>
              </>
            )}
            {levelDown && (
              <>
                <div className="level-icon">📉</div>
                <p>Pali ste na Level {newLevel}</p>
              </>
            )}
          </div>
        )}

        <div className="current-rank">
          <div className={`rank-badge level-${newLevel}`}>{newLevel}</div>
          <span>Level {newLevel}</span>
        </div>

        <button className="elo-modal-close" onClick={onClose}>
          Nastavi
        </button>
      </div>
    </div>
  );
}

export default EloChangeModal;
