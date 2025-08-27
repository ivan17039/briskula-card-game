"use client";

import { useState, useEffect } from "react";
import { useSocket } from "./SocketContext";
import CreateGameModal from "./CreateGameModal";
import "./GameLobby.css";

function GameLobby({ onGameStart, onBack, gameType }) {
  const { socket, user } = useSocket();
  const [activeGames, setActiveGames] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [joinPassword, setJoinPassword] = useState("");
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshGames = () => {
    setLoading(true);
    socket.emit("getActiveGames", { gameType });
  };

  useEffect(() => {
    if (!socket) return;

    // Request active games when component mounts
    socket.emit("getActiveGames", { gameType });

    // Listen for active games updates
    socket.on("activeGamesUpdate", (games) => {
      console.log("📋 Received active games:", games);
      setActiveGames(games);
      setLoading(false);
    });

    // Listen for successful game creation
    socket.on("gameCreated", (gameData) => {
      console.log("✅ Game created successfully:", gameData);
      setShowCreateModal(false);
      // Refresh games list to show the new game
      refreshGames();
    });

    // Listen for successful game join
    socket.on("gameJoined", (gameData) => {
      console.log("✅ Joined game successfully:", gameData);
      setShowPasswordModal(false);
      setJoinPassword("");
      setSelectedGameId(null);

      // Don't navigate yet, wait for gameStart
      setError(""); // Clear any errors
      refreshGames(); // Refresh to show updated player count
    });

    // Listen for game start (when enough players join)
    socket.on("gameStart", (gameData) => {
      console.log("🎮 Game started:", gameData);
      onGameStart(gameData);
    });

    // Listen for join errors
    socket.on("joinGameError", (errorData) => {
      console.error("❌ Join game error:", errorData);
      setError(errorData.message);
      setShowPasswordModal(false);
      setJoinPassword("");
    });

    // Listen for creation errors
    socket.on("gameCreationError", (errorData) => {
      console.error("❌ Create game error:", errorData);
      setError(errorData.message);
    });

    return () => {
      socket.off("activeGamesUpdate");
      socket.off("gameCreated");
      socket.off("gameJoined");
      socket.off("gameStart");
      socket.off("joinGameError");
      socket.off("gameCreationError");
    };
  }, [socket, gameType, onGameStart]);

  const handleCreateGame = (gameData) => {
    if (!socket || !user) {
      console.error("Socket or user not available");
      setError("Connection error");
      return;
    }

    console.log("📤 Creating game:", gameData);
    console.log("📤 User data:", user);
    socket.emit("createGame", {
      gameName: gameData.name,
      gameType,
      gameMode: gameData.maxPlayers === 2 ? "1v1" : "2v2",
      password: gameData.password,
      hasPassword: gameData.hasPassword,
    });
  };

  const handleJoinGame = (gameId, password = null) => {
    if (!socket || !user) {
      setError("Connection error");
      return;
    }

    const game = activeGames.find((g) => g.id === gameId);
    if (!game) {
      setError("Game not found");
      return;
    }

    // Check if password is required
    if (game.hasPassword && !password) {
      setSelectedGameId(gameId);
      setShowPasswordModal(true);
      return;
    }

    console.log("📤 Joining game:", gameId);
    socket.emit("joinGame", {
      roomId: gameId,
      password: password,
    });
  };

  const handlePasswordSubmit = () => {
    if (!joinPassword.trim()) {
      setError("Password is required");
      return;
    }
    handleJoinGame(selectedGameId, joinPassword);
  };

  if (loading) {
    return (
      <div className="game-lobby">
        <div className="lobby-header">
          <button className="back-btn" onClick={onBack}>
            ←
          </button>
          <h1>Game Lobby</h1>
        </div>
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading active games...</p>
          <span>Please wait</span>
        </div>
      </div>
    );
  }

  return (
    <div className="game-lobby">
      <div className="lobby-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack}>
            ←
          </button>
        </div>
        <div className="header-center">
          <h1>{gameType.charAt(0).toUpperCase() + gameType.slice(1)} Lobby</h1>
        </div>
        <div className="header-right">
          <button
            className="refresh-btn"
            onClick={refreshGames}
            title="Refresh games"
          >
            🔄 Refresh
          </button>
          <button
            className="create-btn"
            onClick={() => setShowCreateModal(true)}
          >
            ➕ Create Game
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError("")}>✕</button>
        </div>
      )}

      <div className="games-section">
        {activeGames.length === 0 ? (
          <div className="no-games">
            <div className="no-games-icon">🎮</div>
            <h3>No active games</h3>
            <p>Be the first to create a {gameType} game!</p>
            <button
              className="create-first-btn"
              onClick={() => setShowCreateModal(true)}
            >
              Create First Game
            </button>
          </div>
        ) : (
          <div className="games-grid">
            {activeGames.map((game) => (
              <div key={game.id} className="game-card">
                <div className="game-header">
                  <h3>{game.name}</h3>
                  <div className="game-badges">
                    <span className="mode-badge">{game.gameMode}</span>
                    {game.hasPassword && (
                      <span className="password-badge">🔒</span>
                    )}
                  </div>
                </div>
                <div className="game-info">
                  <p>
                    <strong>Created by:</strong> {game.creator}
                  </p>
                  <p>
                    <strong>Players:</strong> {game.playerCount}/
                    {game.maxPlayers}
                  </p>
                  <p>
                    <strong>Type:</strong> {game.gameType}
                  </p>
                  <p className="created-time">
                    Created: {new Date(game.createdAt).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  className="join-btn"
                  onClick={() => handleJoinGame(game.id)}
                  disabled={game.playerCount >= game.maxPlayers}
                >
                  {game.playerCount >= game.maxPlayers ? "Full" : "Join Game"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Game Modal */}
      {showCreateModal && (
        <CreateGameModal
          gameType={gameType}
          onClose={() => setShowCreateModal(false)}
          onCreateGame={handleCreateGame}
        />
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="modal-overlay">
          <div className="password-modal">
            <div className="modal-header">
              <h3>Enter Password</h3>
              <button
                className="close-btn"
                onClick={() => {
                  setShowPasswordModal(false);
                  setJoinPassword("");
                  setSelectedGameId(null);
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>This game is password protected.</p>
              <input
                type="password"
                placeholder="Enter password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handlePasswordSubmit()}
                autoFocus
              />
              {error && <p className="error-text">{error}</p>}
            </div>
            <div className="modal-footer">
              <button
                className="cancel-btn"
                onClick={() => {
                  setShowPasswordModal(false);
                  setJoinPassword("");
                  setSelectedGameId(null);
                }}
              >
                Cancel
              </button>
              <button className="submit-btn" onClick={handlePasswordSubmit}>
                Join Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameLobby;
