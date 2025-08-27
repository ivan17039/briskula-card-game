"use client";

import { useState } from "react";
import "./GameModeSelector.css";

function GameModeSelector({ onModeSelect, onBack, gameType }) {
  const [selectedMode, setSelectedMode] = useState("custom");

  const handleModeSelect = (mode) => {
    setSelectedMode(mode);
    setTimeout(() => {
      onModeSelect(mode);
    }, 300);
  };

  const gameInfo = {
    briskula: {
      name: "Briskula",
      target: "61+ bodova",
      scoring: "As(11), Trica(10), Kralj(4), Konj(3), Fant(2)",
    },
    treseta: {
      name: "Trešeta",
      target: "31/41 bodova",
      scoring: "As(1), Trica/Duja(⅓), Kralj/Konj/Fant(⅓) + Akuže",
    },
  };

  const currentGame = gameInfo[gameType] || gameInfo.briskula;

  return (
    <div className="game-mode-container">
      <div className="game-mode-card">
        {onBack && (
          <button className="back-btn" onClick={onBack}>
            ←
          </button>
        )}
        <div className="mode-header">
          <div className="game-icon">
            <img
              src="/cards_img/batiICON.png"
              alt="Bati"
              className="suit-icon"
            />
            <img
              src="/cards_img/dinarICON.png"
              alt="Dinari"
              className="suit-icon"
            />
            <img
              src="/cards_img/kupeICON.png"
              alt="Kupe"
              className="suit-icon"
            />
            <img
              src="/cards_img/spadiICON.png"
              alt="Spadi"
              className="suit-icon"
            />
          </div>
          <h2>Odaberite način igre</h2>
          <p>Kako želite igrati {currentGame.name}?</p>
        </div>

        <div className="mode-options">
          <div
            className={`mode-option ${
              selectedMode === "custom" ? "selected" : ""
            }`}
            onClick={() => handleModeSelect("custom")}
          >
            <div className="mode-icon">🎮</div>
            <h3>Stvori ili Pridruži se igri</h3>
            <p>Igraj s prijateljima ili pridruži se postojećim igrama</p>
            <ul>
              <li>Stvori vlastitu sobu (1v1 ili 2v2)</li>
              <li>Pridruži se postojećim sobama</li>
              <li>Šifra sobe za privatnost</li>
              <li>Pozovi prijatelje direktno</li>
            </ul>
            <div className="mode-badge">Sve u jednom</div>
          </div>
        </div>

        <div className="mode-info">
          <h4>ℹ️ Pravila igre</h4>
          <div className="rules-grid">
            <div className="rule-item">
              <strong>Cilj:</strong> Prvi do {currentGame.target}
            </div>
            <div className="rule-item">
              <strong>Karte:</strong> 40 karata (1-7, 11-13)
            </div>
            <div className="rule-item">
              <strong>Bodovi:</strong> {currentGame.scoring}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameModeSelector;
