"use client";

import { useState, useEffect } from "react";
import { useSocket } from "./SocketContext";
import "./GameTypeSelector.css";

function GameTypeSelector({ onGameTypeSelect, onBack, onLogout, user }) {
  const [selectedType, setSelectedType] = useState(null);
  const { clearUserSession } = useSocket();

  // Development console toggle (Ctrl + Shift + D)
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const handleKeyPress = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        const console = document.getElementById("dev-console");
        if (console) {
          console.style.display =
            console.style.display === "none" ? "block" : "none";
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);

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

        {/* Development console - hidden by default */}
        {import.meta.env.DEV && (
          <div
            className="dev-console"
            style={{ display: "none" }}
            id="dev-console"
          >
            <div className="dev-info">🛠️ Development Console</div>
            <div className="dev-actions">
              <button
                type="button"
                className="dev-btn clear-session"
                onClick={clearUserSession}
                title="Potpuno obriši session"
              >
                🧹 Clear Session
              </button>
              <button
                type="button"
                className="dev-btn view-storage"
                onClick={() => console.log("localStorage:", localStorage)}
                title="Prikaži localStorage u konzoli"
              >
                💾 View Storage
              </button>
              <button
                type="button"
                className="dev-btn close-console"
                onClick={() =>
                  (document.getElementById("dev-console").style.display =
                    "none")
                }
                title="Zatvori dev konzolu"
              >
                ❌ Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GameTypeSelector;
