"use client";

import { useState } from "react";
import "./GameTypeSelector.css";

function GameTypeSelector({ onGameTypeSelect, onBack, onLogout, user }) {
  const [selectedType, setSelectedType] = useState(null);

  // Don't render if no user
  if (!user) {
    return (
      <div className="game-type-container">
        <div className="game-type-card">
          <div className="loading-state">
            <h2>Odjavljujem...</h2>
            <p>Molimo pričekajte</p>
          </div>
        </div>
      </div>
    );
  }

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
        {/* User info header */}
        <div className="user-status-header">
          <div className="user-info">
            <div className="user-avatar">
              {user?.name?.charAt(0).toUpperCase() || "?"}
            </div>
            <div className="user-details">
              <span className="user-name">{user?.name || "Korisnik"}</span>
              <span className="user-type">
                {user?.isGuest
                  ? "🎮 Guest korisnik"
                  : "👤 Registrirani korisnik"}
              </span>
            </div>
          </div>
          <div className="header-actions">
            <button className="logout-btn" onClick={onLogout} title="Odjavi se">
              🚪 Odjavi se
            </button>
          </div>
        </div>

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
