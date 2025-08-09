"use client";

import { useState } from "react";
import { SocketProvider, useSocket } from "./SocketContext";
import Login from "./Login";
import GameModeSelector from "./GameModeSelector";
import Matchmaking from "./Matchmaking";
import Game from "./Game";
import Game2v2 from "./Game2v2";
import "./App.css";

function AppContent() {
  const { isConnected, connectionError, user, registerUser } = useSocket();
  const [appState, setAppState] = useState("login");
  const [gameMode, setGameMode] = useState("1v1");
  const [gameData, setGameData] = useState(null);

  const handleLogin = async (userData) => {
    await registerUser(userData);
    setAppState("modeSelect");
  };

  const handleModeSelect = (mode) => {
    setGameMode(mode);
    setAppState("matchmaking");
  };

  const handleGameStart = (data) => {
    setGameData(data);
    setAppState("game");
  };

  const handleGameEnd = () => {
    setGameData(null);
    setAppState("modeSelect");
  };

  const handleBackToModeSelect = () => {
    setAppState("modeSelect");
  };

  const handleBackToLogin = () => {
    setAppState("login");
  };

  if (connectionError) {
    return (
      <div className="connection-error">
        <h2>❌ Greška konekcije</h2>
        <p>{connectionError}</p>
        <p>Molimo provjerite internetsku vezu i pokušajte ponovno</p>
        <button onClick={() => window.location.reload()}>
          🔄 Pokušaj ponovno
        </button>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <h2>Spajanje na server...</h2>
        <p>Molimo pričekajte</p>
      </div>
    );
  }

  switch (appState) {
    case "login":
      return <Login onLogin={handleLogin} />;

    case "modeSelect":
      return <GameModeSelector onModeSelect={handleModeSelect} onBack={handleBackToLogin} />;

    case "matchmaking":
      return (
        <Matchmaking
          onGameStart={handleGameStart}
          gameMode={gameMode}
          onBackToModeSelect={handleBackToModeSelect}
        />
      );

    case "game":
      return gameMode === "2v2" ? (
        <Game2v2 gameData={gameData} onGameEnd={handleGameEnd} />
      ) : (
        <Game gameData={gameData} onGameEnd={handleGameEnd} />
      );

    default:
      return <Login onLogin={handleLogin} />;
  }
}

function App() {
  return (
    <SocketProvider>
      <div className="App">
        <AppContent />
      </div>
    </SocketProvider>
  );
}

export default App;
