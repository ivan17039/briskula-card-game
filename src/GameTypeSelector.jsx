"use client";

import { useState, useEffect } from "react";
import { useSocket } from "./SocketContext";
import "./GameTypeSelector.css";

function GameTypeSelector({ onGameTypeSelect, pendingJoinCode }) {
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

        {pendingJoinCode && (
          <div className="pending-join-banner">
            <span className="banner-icon">🔗</span>
            <div className="banner-text">
              Dobiili ste poziv! Odaberite vrstu igre da se pridružite s kodom:{" "}
              <strong>{pendingJoinCode}</strong>
            </div>
          </div>
        )}

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
