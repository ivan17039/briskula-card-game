"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import { useSocket } from "./SocketContext";
import "./Game.css";
import "./Card.css";
import "./Game2v2.css";

function calculatePoints(cards) {
  return cards.reduce((total, card) => total + (card.points || 0), 0);
}

/**
 * Sortira karte po boji i jačini i grupiraj po bojama
 * @param {Array} cards - Array karata za sortiranje
 * @param {string} gameType - Tip igre (briskula ili treseta)
 * @returns {Array} - Sortirane karte s dodatnim gap-om između boja
 */
function sortCards(cards, gameType = "briskula") {
  if (!cards || cards.length === 0) return cards;

  // Definiranje redoslijeda boja (Kupe, Bati, Spadi, Dinari)
  const suitOrder = { Kupe: 1, Bati: 2, Spadi: 3, Dinari: 4 };

  // Definiranje jačine karata ovisno o tipu igre
  const getCardStrength = (card) => {
    if (gameType === "treseta") {
      // Trešeta: Trica > Duja > As > Kralj > Konj > Fanat > 7 > 6 > 5 > 4
      const tresetaStrength = {
        3: 10, // Trica - najjača
        2: 9, // Duja
        1: 8, // As
        13: 7, // Kralj
        12: 6, // Konj
        11: 5, // Fanat
        7: 4, // 7
        6: 3, // 6
        5: 2, // 5
        4: 1, // 4 - najslabija
      };
      return tresetaStrength[card.value] || 0;
    } else {
      // Briskula: As > Trica > Kralj > Konj > Fanat > 7 > 6 > 5 > 4 > Duja
      const briskulaStrength = {
        1: 10, // As - najjači
        3: 9, // Trica
        13: 8, // Kralj
        12: 7, // Konj
        11: 6, // Fanat
        7: 5, // 7
        6: 4, // 6
        5: 3, // 5
        4: 2, // 4
        2: 1, // Duja - najslabija
      };
      return briskulaStrength[card.value] || 0;
    }
  };

  return [...cards].sort((a, b) => {
    // Prvo sortiraj po boji
    const suitComparison = suitOrder[a.suit] - suitOrder[b.suit];
    if (suitComparison !== 0) {
      return suitComparison;
    }

    // Ako su iste boje, sortiraj po jačini (od najjače prema najslabijoj)
    return getCardStrength(b) - getCardStrength(a);
  });
}

function Game2v2({ gameData, onGameEnd }) {
  const { socket, user, playCard, leaveRoom, findMatch } = useSocket();

  const initializeGameState = () => {
    if (!gameData) return null;

    console.log("🎮 Game2v2 gameData:", gameData);

    const myPlayerNumber = gameData.playerNumber;
    const myHand = gameData.gameState[`player${myPlayerNumber}Hand`] || [];

    // Ensure all hands exist and have proper fallbacks
    const player1Hand = gameData.gameState.player1Hand || [];
    const player2Hand = gameData.gameState.player2Hand || [];
    const player3Hand = gameData.gameState.player3Hand || [];
    const player4Hand = gameData.gameState.player4Hand || [];

    return {
      roomId: gameData.roomId,
      playerNumber: myPlayerNumber,
      myTeam: gameData.myTeam,
      players: gameData.players,
      gameType: gameData.gameType || "briskula", // Dodaj gameType

      // Debug log
      ...(console.log(
        "🎯 Game2v2 inicijaliziran sa gameType:",
        gameData.gameType
      ) || {}),
      myHand: myHand,
      playedCards: [],
      trump: gameData.gameState.trump,
      currentPlayer: gameData.gameState.currentPlayer,
      gamePhase: "playing",
      winner: null,
      message:
        gameData.gameState.currentPlayer === myPlayerNumber
          ? "Vaš red! Odaberite kartu za igranje."
          : "Čekajte svoj red...",
      remainingCardsCount: gameData.gameState.remainingDeck?.length || 0,
      team1Cards: [],
      team2Cards: [],
      // Dodaj bodove za Trešetu
      team1Points: 0,
      team2Points: 0,
      handCounts: {
        player1: player1Hand.length,
        player2: player2Hand.length,
        player3: player3Hand.length,
        player4: player4Hand.length,
      },
      // Dodaj playableCards za Trešetu
      playableCards: gameData.gameState.playableCards || [],
    };
  };

  const [gameState, setGameState] = useState(initializeGameState);
  const [selectedCard, setSelectedCard] = useState(null);
  const [showScores, setShowScores] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Function to get relative position for cross layout
  const getRelativePosition = (cardPlayerNumber, myPlayerNumber) => {
    // Map actual player positions relative to current player
    const relativePositions = {
      1: { 1: "bottom", 2: "left", 3: "top", 4: "right" },
      2: { 1: "right", 2: "bottom", 3: "left", 4: "top" },
      3: { 1: "top", 2: "right", 3: "bottom", 4: "left" },
      4: { 1: "left", 2: "top", 3: "right", 4: "bottom" },
    };

    return relativePositions[myPlayerNumber]?.[cardPlayerNumber] || "center";
  };

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (!socket || !gameState?.roomId) return;

    socket.on("cardPlayed", (data) => {
      setGameState((prev) => ({
        ...prev,
        playedCards: data.playedCards,
        myHand:
          data.playerNumber === prev.playerNumber
            ? prev.myHand.filter((c) => c.id !== data.card.id)
            : prev.myHand,
        handCounts: {
          ...prev.handCounts,
          [`player${data.playerNumber}`]: Math.max(
            0,
            prev.handCounts[`player${data.playerNumber}`] - 1
          ),
        },
        message:
          data.playerNumber === prev.playerNumber
            ? "Čekamo ostale igrače..."
            : `${data.playerName} je odigrao kartu.`,
      }));
    });

    socket.on("turnChange", (data) => {
      setGameState((prev) => ({
        ...prev,
        currentPlayer: data.currentPlayer,
        message:
          data.currentPlayer === prev.playerNumber
            ? "Vaš red! Odaberite kartu."
            : `Red igrača ${data.currentPlayerName}.`,
      }));
    });

    socket.on("roundFinished", (data) => {
      setGameState((prev) => {
        const newState = {
          ...prev,
          myHand: data[`player${prev.playerNumber}Hand`],
          trump: data.trump,
          team1Cards: data.team1Cards,
          team2Cards: data.team2Cards,
          playedCards: [],
          currentPlayer: data.currentPlayer,
          remainingCardsCount: data.remainingCards,
          gamePhase: data.gameEnd.isGameOver ? "finished" : "playing",
          winner: data.gameEnd.winner,
          handCounts: {
            player1: data.player1Hand?.length || prev.handCounts.player1 || 0,
            player2: data.player2Hand?.length || prev.handCounts.player2 || 0,
            player3: data.player3Hand?.length || prev.handCounts.player3 || 0,
            player4: data.player4Hand?.length || prev.handCounts.player4 || 0,
          },
          // Dodaj Trešeta specifične podatke
          playableCards:
            prev.gameType === "treseta"
              ? data[`player${prev.playerNumber}PlayableCards`] || []
              : prev.playableCards,
          team1Points:
            prev.gameType === "treseta" && data.team1Points
              ? data.team1Points.points
              : prev.team1Points,
          team2Points:
            prev.gameType === "treseta" && data.team2Points
              ? data.team2Points.points
              : prev.team2Points,
        };

        if (data.gameEnd.isGameOver) {
          if (data.gameEnd.winner === prev.myTeam) {
            newState.message = `🎉 Vaš tim je pobijedio! (${data.gameEnd.reason})`;
          } else if (data.gameEnd.winner === null) {
            newState.message = `🤝 Neriješeno! (${data.gameEnd.reason})`;
          } else {
            newState.message = `😔 Vaš tim je izgubio. (${data.gameEnd.reason})`;
          }
        } else {
          const winningTeam = data.roundWinningTeam;
          newState.message =
            winningTeam === prev.myTeam
              ? "Vaš tim je uzeo rundu!"
              : "Protivnički tim je uzeo rundu.";
        }

        return newState;
      });

      // Ne automatski preusmjeravaj na glavni ekran - neka igrač sam odluči
    });

    socket.on("playerDisconnected", (data) => {
      let displayMessage = data.message;
      if (data.gameMode === "2v2" && data.playerTeam) {
        displayMessage += `. Igra je prekinuta.`;
      }

      setGameState((prev) => ({
        ...prev,
        gamePhase: "finished",
        message: `${displayMessage} Kliknite 'Glavni meni' za povratak.`,
      }));
      // Ne automatski preusmjeravaj - neka igrač sam odluči
    });

    socket.on("playerLeft", (data) => {
      let displayMessage = data.message;
      if (data.gameMode === "2v2" && data.playerTeam) {
        displayMessage += ` Igra je prekinuta.`;
      }

      setGameState((prev) => ({
        ...prev,
        gamePhase: "finished",
        message: `${displayMessage} Kliknite 'Glavni meni' za povratak.`,
      }));
      // Ne automatski preusmjeravaj - neka igrač sam odluči
    });

    // Trešeta specific events
    socket.on("playableCardsUpdate", (data) => {
      if (gameState?.gameType === "treseta") {
        setGameState((prev) => ({
          ...prev,
          playableCards: data[`player${prev.playerNumber}PlayableCards`] || [],
        }));
      }
    });

    socket.on("invalidMove", (data) => {
      if (gameState?.gameType === "treseta") {
        alert(`Neispavan potez: ${data.reason}`);
        setSelectedCard(null);
      }
    });

    return () => {
      socket.off("cardPlayed");
      socket.off("turnChange");
      socket.off("roundFinished");
      socket.off("playerDisconnected");
      socket.off("playerLeft");
      socket.off("playableCardsUpdate");
      socket.off("invalidMove");
    };
  }, [socket, gameState?.roomId, onGameEnd]);

  const handleCardClick = (card) => {
    if (!gameState) return;

    if (
      gameState.gamePhase !== "playing" ||
      gameState.currentPlayer !== gameState.playerNumber
    ) {
      return;
    }

    // Provjeri je li karta playable za Trešetu
    if (
      gameState.gameType === "treseta" &&
      !gameState.playableCards.includes(card.id)
    ) {
      alert(
        "Ne možete igrati tu kartu! Morate pratiti boju ili igrati jaču kartu."
      );
      return;
    }

    if (selectedCard && selectedCard.id === card.id) {
      playCard(gameState.roomId, card);
      setSelectedCard(null);
    } else {
      setSelectedCard(card);
    }
  };

  if (!gameState) {
    return (
      <div className="game-wrapper">
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            color: "white",
            fontSize: "1.2rem",
          }}
        >
          Učitavanje igre...
        </div>
      </div>
    );
  }

  const team1Points =
    gameState.gameType === "treseta"
      ? gameState.team1Points
      : calculatePoints(gameState.team1Cards);
  const team2Points =
    gameState.gameType === "treseta"
      ? gameState.team2Points
      : calculatePoints(gameState.team2Cards);
  const cardSize = isMobile ? "small" : "medium";

  // Get player positions for 2v2 layout
  const getPlayerByPosition = (position) => {
    const positions = {
      bottom: gameState.playerNumber,
      top:
        gameState.playerNumber === 1
          ? 3
          : gameState.playerNumber === 2
          ? 4
          : gameState.playerNumber === 3
          ? 1
          : 2,
      left:
        gameState.playerNumber === 1
          ? 4
          : gameState.playerNumber === 2
          ? 1
          : gameState.playerNumber === 3
          ? 2
          : 3,
      right:
        gameState.playerNumber === 1
          ? 2
          : gameState.playerNumber === 2
          ? 3
          : gameState.playerNumber === 3
          ? 4
          : 1,
    };
    return positions[position];
  };

  const getPlayerName = (playerNumber) => {
    return (
      gameState.players.find((p) => p.playerNumber === playerNumber)?.name ||
      `Igrač ${playerNumber}`
    );
  };

  const getPlayerTeam = (playerNumber) => {
    return (
      gameState.players.find((p) => p.playerNumber === playerNumber)?.team || 1
    );
  };

  // Function to determine team color
  const getTeamColor = (playerNumber) => {
    const team = getPlayerTeam(playerNumber);
    return team === gameState.myTeam ? "teammate" : "opponent";
  };

  return (
    <div className="game-wrapper game-2v2">
      {/* Header */}
      <div className="game-header">
        <h1 className="game-title">
          <img
            src="/cards_img/dinarICON.png"
            alt="Dinari"
            className="title-suit-icon"
          />
          {gameState.gameType === "treseta" ? "Trešeta 2v2" : "Briskula 2v2"}
        </h1>

        {/* Team scores */}
        <div className="team-scores">
          <div
            className={`team-score ${gameState.myTeam === 1 ? "my-team" : ""}`}
          >
            <span className="team-label">Tim 1</span>
            <span className="team-points">{team1Points}</span>
          </div>
          <div className="vs-divider">vs</div>
          <div
            className={`team-score ${gameState.myTeam === 2 ? "my-team" : ""}`}
          >
            <span className="team-label">Tim 2</span>
            <span className="team-points">{team2Points}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="desktop-controls">
          <button
            onClick={() => setShowScores(!showScores)}
            className="game-btn btn-primary"
          >
            {showScores ? "Sakrij" : "Detalji"}
          </button>

          {gameState.gamePhase === "playing" && (
            <button
              onClick={() => {
                leaveRoom(gameState.roomId);
                onGameEnd();
              }}
              className="game-btn btn-danger"
            >
              Napusti
            </button>
          )}

          {gameState.gamePhase === "finished" && (
            <button onClick={onGameEnd} className="game-btn btn-secondary">
              Povratak
            </button>
          )}
        </div>
      </div>

      {/* Game area with 2v2 layout */}
      <div className="game-area-2v2">
        {/* Top player */}
        <div className="player-position top-player">
          <div
            className={`player-icon-display ${getTeamColor(
              getPlayerByPosition("top")
            )} ${
              gameState.currentPlayer === getPlayerByPosition("top")
                ? "current-turn"
                : ""
            }`}
          >
            <div
              className={`player-avatar ${getTeamColor(
                getPlayerByPosition("top")
              )}`}
            >
              {getPlayerName(getPlayerByPosition("top"))
                .charAt(0)
                .toUpperCase()}
            </div>
            <div className="player-name">
              {getPlayerName(getPlayerByPosition("top"))}
            </div>
            <div className="player-cards-indicator">
              <div className="cards-icon">
                {gameState.handCounts[`player${getPlayerByPosition("top")}`]}
              </div>
              <span>karata</span>
            </div>
          </div>
        </div>

        {/* Middle section with left player, play area, deck-trump, and right player */}
        <div
          className={`middle-section ${
            gameState.remainingCardsCount === 0 ||
            gameState.gameType === "treseta"
              ? "no-deck"
              : ""
          }`}
        >
          {/* Left player */}
          <div className="player-position left-player">
            <div
              className={`player-icon-display ${getTeamColor(
                getPlayerByPosition("left")
              )} ${
                gameState.currentPlayer === getPlayerByPosition("left")
                  ? "current-turn"
                  : ""
              }`}
            >
              <div
                className={`player-avatar ${getTeamColor(
                  getPlayerByPosition("left")
                )}`}
              >
                {getPlayerName(getPlayerByPosition("left"))
                  .charAt(0)
                  .toUpperCase()}
              </div>
              <div className="player-name">
                {getPlayerName(getPlayerByPosition("left"))}
              </div>
              <div className="player-cards-indicator">
                <div className="cards-icon">
                  {gameState.handCounts[`player${getPlayerByPosition("left")}`]}
                </div>
                <span>karata</span>
              </div>
            </div>
          </div>

          {/* Center play area */}
          <div className="center-area">
            <div className="played-cards-section">
              <div className="played-cards-label">Odigrane karte</div>
              <div className="played-cards-cross">
                {gameState.playedCards.map((card, index) => {
                  const position = getRelativePosition(
                    card.playerNumber,
                    gameState.playerNumber
                  );
                  const playerName =
                    gameState.players?.find(
                      (p) => p.playerNumber === card.playerNumber
                    )?.name || `Igrač ${card.playerNumber}`;

                  return (
                    <div
                      key={`played-${card.id}`}
                      className={`played-card-position ${position}`}
                    >
                      <Card card={card} size="played" />
                      <div className="card-player-label">{playerName}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Deck and Trump section - Hide if no cards remaining or Trešeta 2v2 */}
          {gameState.remainingCardsCount > 0 &&
            !(gameState.gameType === "treseta") && (
              <div className="deck-trump-section">
                <div className="deck-label">
                  Špil ({gameState.remainingCardsCount})
                </div>
                <div className="deck-trump-stack">
                  {gameState.trump && gameState.gameType !== "treseta" && (
                    <div className="trump-card">
                      <Card card={gameState.trump} size={cardSize} />
                    </div>
                  )}
                  <div className="deck-card">
                    <Card card={{}} isHidden={true} size={cardSize} />
                  </div>
                </div>
              </div>
            )}

          {/* Right player */}
          <div className="player-position right-player">
            <div
              className={`player-icon-display ${getTeamColor(
                getPlayerByPosition("right")
              )} ${
                gameState.currentPlayer === getPlayerByPosition("right")
                  ? "current-turn"
                  : ""
              }`}
            >
              <div
                className={`player-avatar ${getTeamColor(
                  getPlayerByPosition("right")
                )}`}
              >
                {getPlayerName(getPlayerByPosition("right"))
                  .charAt(0)
                  .toUpperCase()}
              </div>
              <div className="player-name">
                {getPlayerName(getPlayerByPosition("right"))}
              </div>
              <div className="player-cards-indicator">
                <div className="cards-icon">
                  {
                    gameState.handCounts[
                      `player${getPlayerByPosition("right")}`
                    ]
                  }
                </div>
                <span>karata</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom player (current user) */}
        <div className="player-position bottom-player">
          <div className="game-status">{gameState.message}</div>
          <div className="player-info my-player">
            <div className="player-name">
              {user?.name}
              {gameState.currentPlayer === gameState.playerNumber && (
                <span className="turn-indicator"> (Vaš red)</span>
              )}
            </div>
          </div>
          <div className="player-cards">
            {sortCards(gameState.myHand, gameState.gameType).map((card) => (
              <Card
                key={card.id}
                card={card}
                isPlayable={
                  gameState.gamePhase === "playing" &&
                  gameState.currentPlayer === gameState.playerNumber &&
                  (gameState.gameType !== "treseta" ||
                    gameState.playableCards.includes(card.id))
                }
                isSelected={selectedCard && selectedCard.id === card.id}
                onClick={handleCardClick}
                size={cardSize}
              />
            ))}
          </div>

          {selectedCard && (
            <div className="selection-info">
              Odabrana: {selectedCard.name} {selectedCard.suit} (
              {selectedCard.points} bodova)
              <br />
              <small>Kliknite ponovno za igranje</small>
            </div>
          )}
        </div>
      </div>

      {/* Scores overlay */}
      {showScores && (
        <div className="scores-overlay" onClick={() => setShowScores(false)}>
          <div className="scores-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scores-header">
              <h2>Detaljni rezultati - 2v2</h2>
            </div>

            <div className="teams-scores-grid">
              <div className="team-stats">
                <h3>Tim 1 {gameState.myTeam === 1 && "(Vaš tim)"}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{team1Points}</span>
                </div>
                <div className="team-players">
                  {gameState.players
                    .filter((p) => p.team === 1)
                    .map((player) => (
                      <div key={player.playerNumber} className="player-stat">
                        <span>{player.name}:</span>
                        <span>
                          {gameState.handCounts[`player${player.playerNumber}`]}{" "}
                          karata
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Show deck/trump info only if relevant */}
              {gameState.remainingCardsCount > 0 && (
                <div className="trump-info">
                  {gameState.gameType === "treseta" ? (
                    <>
                      <h3>Špil</h3>
                      <p>Preostalo: {gameState.remainingCardsCount}</p>
                    </>
                  ) : (
                    <>
                      <h3>Adut</h3>
                      {gameState.trump && (
                        <Card card={gameState.trump} size="small" />
                      )}
                      <p>Preostalo: {gameState.remainingCardsCount}</p>
                    </>
                  )}
                </div>
              )}

              <div className="team-stats">
                <h3>Tim 2 {gameState.myTeam === 2 && "(Vaš tim)"}</h3>
                <div className="stat-item">
                  <span>Bodovi:</span>
                  <span>{team2Points}</span>
                </div>
                <div className="team-players">
                  {gameState.players
                    .filter((p) => p.team === 2)
                    .map((player) => (
                      <div key={player.playerNumber} className="player-stat">
                        <span>{player.name}:</span>
                        <span>
                          {gameState.handCounts[`player${player.playerNumber}`]}{" "}
                          karata
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <button
              className="close-scores"
              onClick={() => setShowScores(false)}
            >
              Zatvori
            </button>
          </div>
        </div>
      )}

      {/* Final Score Screen for 2v2 */}
      {gameState.gamePhase === "finished" && (
        <div className="final-score-overlay">
          <div className="final-score-container">
            <div className="final-score-header">
              <h2>🎮 Partija završena!</h2>
              {gameState.winner === gameState.myTeam && (
                <div className="result-emoji">🎉</div>
              )}
              {gameState.winner === null && (
                <div className="result-emoji">🤝</div>
              )}
              {gameState.winner && gameState.winner !== gameState.myTeam && (
                <div className="result-emoji">😔</div>
              )}
            </div>

            <div className="final-teams-grid">
              <div className="final-team-score">
                <div className="team-header">
                  <h3>Tim A</h3>
                  {gameState.winner === "A" && (
                    <div className="winner-badge">👑 POBJEDNIK</div>
                  )}
                </div>
                <div className="team-points">
                  {gameState.gameType === "treseta"
                    ? gameState.teamAPoints
                    : calculatePoints(gameState.teamACards || [])}{" "}
                  bodova
                </div>
                <div className="team-cards">
                  {(gameState.teamACards || []).length} karata
                </div>
                <div className="team-players">
                  {gameState.players
                    ?.filter((p) => p.team === "A")
                    .map((player) => (
                      <div
                        key={player.playerNumber}
                        className={`team-player ${
                          player.playerNumber === gameState.playerNumber
                            ? "current-player"
                            : ""
                        }`}
                      >
                        {player.name}{" "}
                        {player.playerNumber === gameState.playerNumber &&
                          "(Vi)"}
                      </div>
                    ))}
                </div>
              </div>

              <div className="vs-divider">VS</div>

              <div className="final-team-score">
                <div className="team-header">
                  <h3>Tim B</h3>
                  {gameState.winner === "B" && (
                    <div className="winner-badge">👑 POBJEDNIK</div>
                  )}
                </div>
                <div className="team-points">
                  {gameState.gameType === "treseta"
                    ? gameState.teamBPoints
                    : calculatePoints(gameState.teamBCards || [])}{" "}
                  bodova
                </div>
                <div className="team-cards">
                  {(gameState.teamBCards || []).length} karata
                </div>
                <div className="team-players">
                  {gameState.players
                    ?.filter((p) => p.team === "B")
                    .map((player) => (
                      <div
                        key={player.playerNumber}
                        className={`team-player ${
                          player.playerNumber === gameState.playerNumber
                            ? "current-player"
                            : ""
                        }`}
                      >
                        {player.name}{" "}
                        {player.playerNumber === gameState.playerNumber &&
                          "(Vi)"}
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="game-result">
              <p>{gameState.message}</p>
            </div>

            <div className="final-score-actions">
              <button
                onClick={() => {
                  findMatch("2v2", gameState.gameType);
                }}
                className="btn-primary-large"
              >
                🔄 Revanš
              </button>
              <button onClick={onGameEnd} className="btn-secondary-large">
                🏠 Glavni meni
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Game2v2;
