"use client";

import { useState, useEffect } from "react";
import { useSocket } from "./SocketContext";
import "./Matchmaking.css";

function Matchmaking({ onGameStart, gameMode, gameType, onBackToModeSelect }) {
  const { socket, user, findMatch, cancelMatch } = useSocket();
  const [matchmakingState, setMatchmakingState] = useState("idle");
  const [queuePosition, setQueuePosition] = useState(0);
  const [message, setMessage] = useState("");
  const [foundPlayers, setFoundPlayers] = useState([]);

  useEffect(() => {
    if (!socket) return;

    socket.on("matchmaking", (data) => {
      console.log("🔍 Matchmaking update:", data);

      switch (data.status) {
        case "waiting":
          setMatchmakingState("searching");
          setQueuePosition(data.queuePosition || 0);
          setMessage(data.message);
          break;

        case "already_waiting":
          setMatchmakingState("searching");
          setQueuePosition(data.queuePosition || 0);
          setMessage(data.message);
          break;

        case "cancelled":
          setMatchmakingState("idle");
          setMessage("Traženje otkazano");
          setTimeout(() => setMessage(""), 3000);
          break;

        case "players_found":
          setMatchmakingState("found");
          setFoundPlayers(data.players || []);
          setMessage(data.message);
          break;

        default:
          setMessage(data.message || "");
      }
    });

    socket.on("gameStart", (gameData) => {
      console.log("🎮 Igra počinje:", gameData);
      setTimeout(() => {
        onGameStart(gameData);
      }, 2000);
    });

    return () => {
      socket.off("matchmaking");
      socket.off("gameStart");
    };
  }, [socket, onGameStart]);

  const handleFindMatch = () => {
    setMatchmakingState("searching");
    setMessage(`Tražimo igrače za ${gameType}...`);
    findMatch(gameMode, gameType);
  };

  const handleCancelMatch = () => {
    setMatchmakingState("idle");
    cancelMatch();
  };

  const getPlayersNeeded = () => {
    return gameMode === "1v1" ? 2 : 4;
  };

  const getModeDescription = () => {
    const gameName = gameType === "treseta" ? "Trešeta" : "Briskula";
    return gameMode === "1v1"
      ? `Klasična ${gameName} - jedan protiv jedan`
      : `Timska ${gameName} - dva tima od po dva igrača`;
  };

  return (
    <div className="matchmaking-container">
      <div className="matchmaking-card">
        <div className="mode-header">
          <button
            className="back-btn"
            onClick={onBackToModeSelect}
            title="Nazad na odabir načina"
          >
            ←
          </button>
          <div className="mode-info">
            <h2>
              {gameType === "treseta" ? "Trešeta" : "Briskula"} -{" "}
              {gameMode === "1v1" ? "1 vs 1" : "2 vs 2"}
            </h2>
            <p>{getModeDescription()}</p>
          </div>
        </div>

        <div className="user-info">
          <div className="user-avatar">
            {user?.name?.charAt(0).toUpperCase() || "?"}
          </div>
          <div className="user-details">
            <h3>{user?.name || "Nepoznati korisnik"}</h3>
            <span className="user-type">
              {user?.isGuest ? "🎮 Guest korisnik" : "👤 Registrirani korisnik"}
            </span>
          </div>
        </div>

        <div className="matchmaking-status">
          {matchmakingState === "idle" && (
            <div className="idle-state">
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
              <h3>
                Spremni za{" "}
                {gameMode === "1v1"
                  ? gameType === "treseta"
                    ? "Trešeta"
                    : "Briskula"
                  : gameType === "treseta"
                  ? "Timska Trešeta"
                  : "2v2 Briskula"}{" "}
                igru?
              </h3>
              <p>Trebamo {getPlayersNeeded()} igrača za početak</p>
              <button className="find-match-btn" onClick={handleFindMatch}>
                🔍 Pronađi protivnike
              </button>
            </div>
          )}

          {matchmakingState === "searching" && (
            <div className="searching-state">
              <div className="loading-spinner"></div>
              <h3>Tražim protivnika...</h3>
              <p>Molimo pričekajte</p>
              <button className="cancel-btn" onClick={handleCancelMatch}>
                ❌ Otkaži
              </button>
            </div>
          )}

          {matchmakingState === "found" && (
            <div className="found-state">
              <div className="success-icon">✅</div>
              <h3>
                {gameMode === "1v1"
                  ? "Protivnik pronađen!"
                  : "Svi igrači pronađeni!"}
              </h3>

              {gameMode === "2v2" && foundPlayers.length > 0 && (
                <div className="teams-preview">
                  <div className="team team-1">
                    <h4>Tim 1</h4>
                    <div className="team-players">
                      {foundPlayers
                        .filter((p) => p.team === 1)
                        .map((player, index) => (
                          <div key={index} className="player-info">
                            <div className="player-avatar">
                              {player.name.charAt(0).toUpperCase()}
                            </div>
                            <span>{player.name}</span>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="vs-divider">VS</div>

                  <div className="team team-2">
                    <h4>Tim 2</h4>
                    <div className="team-players">
                      {foundPlayers
                        .filter((p) => p.team === 2)
                        .map((player, index) => (
                          <div key={index} className="player-info">
                            <div className="player-avatar">
                              {player.name.charAt(0).toUpperCase()}
                            </div>
                            <span>{player.name}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {gameMode === "1v1" && foundPlayers.length > 0 && (
                <div className="opponent-info">
                  <div className="opponent-avatar">
                    {foundPlayers[0]?.name?.charAt(0).toUpperCase() || "?"}
                  </div>
                  <span className="opponent-name">
                    {foundPlayers[0]?.name || "Protivnik"}
                  </span>
                </div>
              )}

              <p>Igra počinje za nekoliko sekundi...</p>
              <div className="starting-animation">
                <div className="dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="matchmaking-info">
          <h4>
            ℹ️{" "}
            {gameMode === "1v1"
              ? gameType === "treseta"
                ? "1v1 Trešeta"
                : "1v1 Briskula"
              : gameType === "treseta"
              ? "Timska Trešeta"
              : "2v2 Briskula"}
          </h4>
          <p>
            🎯 Cilj:{" "}
            {gameType === "treseta"
              ? "Skupiti 31 ili 41 punta"
              : "Prvi ostane bez karata"}{" "}
            | ⚡ Realtime multiplayer
          </p>
        </div>

        {message && matchmakingState === "idle" && (
          <div className="status-message">{message}</div>
        )}
      </div>
    </div>
  );
}

export default Matchmaking;
