"use client";

import { useState, useEffect } from "react";
import { useSocket } from "./SocketContext";
import CreateGameModal from "./CreateGameModal";
import "./GameLobby.css";
import EloWidget from "./EloWidget";

function GameLobby({ onGameStart, onBack, gameType }) {
  const { socket, user } = useSocket();
  const [activeGames, setActiveGames] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [joinPassword, setJoinPassword] = useState("");
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showConfirmDeleteModal, setShowConfirmDeleteModal] = useState(false);
  const [gameToDelete, setGameToDelete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const safeGameType = (gameType || "briskula").toString();

  const refreshGames = () => {
    setLoading(true);
    if (socket) {
      socket.emit("getActiveGames", { gameType: safeGameType });
    }
  };

  useEffect(() => {
    if (!socket) return;

    // Request active games when component mounts
    socket.emit("getActiveGames", { gameType: safeGameType });

    // Listen for active games updates
    socket.on("activeGamesUpdate", (games) => {
      // Filter games by gameType to show only relevant games in this lobby
      const filteredGames = games.filter(
        (game) => game.gameType === safeGameType,
      );
      console.log(
        `🎮 Filtered to ${filteredGames.length} ${safeGameType} games`,
      );

      setActiveGames(filteredGames);
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

    // Listen for game deletion
    socket.on("gameDeleted", (data) => {
      console.log("🗑️ Game deleted successfully:", data);
      if (data.message) {
        // If we receive a message, it means we were notified that someone else deleted the game
        setError(data.message);
      } else {
        setError(""); // Clear any errors
      }
      refreshGames(); // Refresh to remove the deleted game
    });

    // Listen for deletion errors
    socket.on("gameDeletionError", (errorData) => {
      console.error("❌ Delete game error:", errorData);
      setError(errorData.message);
    });

    return () => {
      socket.off("activeGamesUpdate");
      socket.off("gameCreated");
      socket.off("gameJoined");
      socket.off("gameStart");
      socket.off("joinGameError");
      socket.off("gameCreationError");
      socket.off("gameDeleted");
      socket.off("gameDeletionError");
    };
  }, [socket, safeGameType, onGameStart]);

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
      gameType: safeGameType,
      gameMode: gameData.maxPlayers === 2 ? "1v1" : "2v2",
      password: gameData.password,
      hasPassword: gameData.hasPassword,
      // Include akuze setting for Treseta
      ...(safeGameType === "treseta" &&
        gameData.akuzeEnabled !== undefined && {
          akuzeEnabled: gameData.akuzeEnabled,
        }),
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

  const handleDeleteGame = (gameId) => {
    if (!socket || !user) {
      setError("Connection error");
      return;
    }

    const game = activeGames.find((g) => g.id === gameId);
    if (!game) {
      setError("Game not found");
      return;
    }

    // Check if user is the creator
    if (game.creator !== user.name) {
      setError("You can only delete games you created");
      return;
    }

    // Show custom confirmation modal
    setGameToDelete(game);
    setShowConfirmDeleteModal(true);
  };

  const confirmDeleteGame = () => {
    if (!gameToDelete) return;

    console.log("📤 Deleting game:", gameToDelete.id);
    socket.emit("deleteGame", {
      roomId: gameToDelete.id,
    });

    // Close modal and reset state
    setShowConfirmDeleteModal(false);
    setGameToDelete(null);
  };

  const cancelDeleteGame = () => {
    setShowConfirmDeleteModal(false);
    setGameToDelete(null);
  };

  // Handle keyboard events for confirmation modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showConfirmDeleteModal) {
        if (e.key === "Escape") {
          cancelDeleteGame();
        } else if (e.key === "Enter") {
          confirmDeleteGame();
        }
      }
    };

    if (showConfirmDeleteModal) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showConfirmDeleteModal]);

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
          <h1>
            {safeGameType.charAt(0).toUpperCase() + safeGameType.slice(1)} Lobby
          </h1>
        </div>
        <div className="header-right">
          <EloWidget compact />
          <button
            className="refresh-btn"
            onClick={refreshGames}
            title="Refresh games"
          >
            🔄 <span className="btn-text">Refresh</span>
          </button>
          <button
            className="create-btn"
            onClick={() => setShowCreateModal(true)}
          >
            ➕ <span className="btn-text">Create Game</span>
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
            <p>Be the first to create a {safeGameType} game!</p>
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
                <div className="game-header-lobby">
                  <div className="game-title-area">
                    <h3>{game.name}</h3>
                    {game.creator === user?.name && (
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteGame(game.id)}
                        title="Delete game"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
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
          gameType={safeGameType}
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

      {/* Confirm Delete Modal */}
      {showConfirmDeleteModal && gameToDelete && (
        <div className="modal-overlay">
          <div className="confirm-delete-modal">
            <div className="modal-header">
              <h3>Obriši igru</h3>
              <button className="close-btn" onClick={cancelDeleteGame}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="warning-icon">⚠️</div>
              <p className="confirm-message">
                Jeste li sigurni da želite obrisati igru{" "}
                <strong>"{gameToDelete.name}"</strong>?
              </p>
              <p className="warning-text">
                Ova akcija se ne može poništiti. Svi igrači će biti uklonjeni iz
                igre.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="cancel-btn"
                onClick={cancelDeleteGame}
                autoFocus
              >
                Otkaži
              </button>
              <button
                className="delete-confirm-btn"
                onClick={confirmDeleteGame}
              >
                🗑️ Obriši igru
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameLobby;
