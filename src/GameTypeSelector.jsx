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
      description: "Klasična hrvatska igra",
      details: [
        "Prvi do 61+ bodova",
        "As(11), Trica(10), Kralj(4)",
        "Jednostavna pravila",
      ],
      icon: "🃏",
      badge: "Klasična",
    },
    {
      id: "treseta",
      name: "Trešeta",
      description: "Strategijska igra s akužama",
      details: [
        "Prvi do 31/41 bodova",
        "Trica > Duja > As",
        "Akužavanje kombinacija",
      ],
      icon: "🎯",
      badge: "Strategijska",
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
              <p>{type.description}</p>
              <ul>
                {type.details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
              <div className="type-badge">{type.badge}</div>
            </div>
          ))}
        </div>

        <div className="type-info">
          <h4>ℹ️ Općenito o igrama</h4>
          <div className="rules-grid">
            <div className="rule-item">
              <strong>Karte:</strong> 40 karata (1-7, 11-13)
            </div>
            <div className="rule-item">
              <strong>Boje:</strong> Kupe, Bati, Spadi, Dinari
            </div>
            <div className="rule-item">
              <strong>Način:</strong> 1v1 ili 2v2 timski
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameTypeSelector;
