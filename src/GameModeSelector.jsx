"use client";

import { useState } from "react";
import "./GameModeSelector.css";

function GameModeSelector({ onModeSelect }) {
  const [selectedMode, setSelectedMode] = useState(null);

  const handleModeSelect = (mode) => {
    setSelectedMode(mode);
    setTimeout(() => {
      onModeSelect(mode);
    }, 300);
  };

  return (
    <div className="game-mode-container">
      <div className="game-mode-card">
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
          <p>Kako želite igrati Briskulu?</p>
        </div>

        <div className="mode-options">
          <div
            className={`mode-option ${
              selectedMode === "1v1" ? "selected" : ""
            }`}
            onClick={() => handleModeSelect("1v1")}
          >
            <div className="mode-icon">👤 vs 👤</div>
            <h3>1 vs 1</h3>
            <p>Klasična Briskula</p>
            <ul>
              <li>Dva igrača</li>
              <li>Brža igra</li>
              <li>Individualna strategija</li>
            </ul>
            <div className="mode-badge">Klasično</div>
          </div>

          <div
            className={`mode-option ${
              selectedMode === "2v2" ? "selected" : ""
            }`}
            onClick={() => handleModeSelect("2v2")}
          >
            <div className="mode-icon">👥 vs 👥</div>
            <h3>2 vs 2</h3>
            <p>Timska Briskula</p>
            <ul>
              <li>Četiri igrača</li>
              <li>Timska strategija</li>
              <li>Komunikacija s partnerom</li>
            </ul>
            <div className="mode-badge">Timski</div>
          </div>
        </div>

        <div className="mode-info">
          <h4>ℹ️ Pravila igre</h4>
          <div className="rules-grid">
            <div className="rule-item">
              <strong>Cilj:</strong> Prvi do 61+ bodova
            </div>
            <div className="rule-item">
              <strong>Karte:</strong> 40 karata (As, 2-7, Fant, Konj, Kralj)
            </div>
            <div className="rule-item">
              <strong>Bodovi:</strong> As(11), Trica(10), Kralj(4), Konj(3),
              Fant(2)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameModeSelector;
