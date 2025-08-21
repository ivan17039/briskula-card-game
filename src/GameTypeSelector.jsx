"use client";

import { useState } from "react";
import "./GameTypeSelector.css";

function GameTypeSelector({ onGameTypeSelect, onBack }) {
  const [selectedType, setSelectedType] = useState(null);

  const handleTypeSelect = (type) => {
    setSelectedType(type);
    setTimeout(() => {
      onGameTypeSelect(type);
    }, 300);
  };

  const gameTypes = [
    {
      id: "briskula",
      name: "Briskula",
      icon: "🃏",
    },
    {
      id: "treseta",
      name: "Trešeta",
      icon: "🎯",
    },
  ];

  return (
    <div className="game-type-container">
      <div className="game-type-card">
        {onBack && (
          <button className="back-btn" onClick={onBack}>
            ←
          </button>
        )}
        <div className="type-header">
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
          <h2>Odaberite igru</h2>
          <p>Koju kartašku igru želite igrati?</p>
        </div>

        <div className="type-options">
          {gameTypes.map((type) => (
            <div
              key={type.id}
              className={`type-option ${
                selectedType === type.id ? "selected" : ""
              }`}
              onClick={() => handleTypeSelect(type.id)}
            >
              <div className="type-icon">{type.icon}</div>
              <h3>{type.name}</h3>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default GameTypeSelector;
