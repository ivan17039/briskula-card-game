import React, { useState, useEffect } from "react";
import { useSocket } from "./SocketContext";
import "./TournamentBracket.css";

const TournamentBracket = ({ tournamentId, onBack, onGameStart }) => {
  const [bracket, setBracket] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState([]);
  const [readyMatches, setReadyMatches] = useState(new Set());
  const [myReadyMatches, setMyReadyMatches] = useState(new Set()); // matches where current user clicked ready
  const [readyStatus, setReadyStatus] = useState({}); // matchId -> { readyCount, required }
  const { socket, user } = useSocket();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket || !tournamentId) return;

    socket.emit("getTournamentBracket", { tournamentId });
    socket.emit("getTournamentLeaderboard");

    const handleBracketData = (data) => {
      setBracket(data.bracket);
      setTournament(data.tournament);
      setLoading(false);
    };
    const handleBracketUpdate = (data) => {
      if (data.tournamentId === tournamentId) setBracket(data.bracket);
    };
    const handleGameStart = (data) => {
      // Handle gameStart event from server (tournament match started or spectate)
      setBracket((prev) => {
        if (!prev) return prev;
        let changed = false;
        const updated = prev.map((round) => {
          const matches = round.matches.map((m) => {
            if (m.id === data.matchId) {
              changed = true;
              return { ...m, status: "playing", gameRoomId: data.roomId };
            }
            return m;
          });
          return { ...round, matches };
        });
        return changed ? updated : prev;
      });
      setReadyMatches((prev) => {
        const next = new Set(prev);
        next.delete(data.matchId);
        return next;
      });
      setMyReadyMatches((prev) => {
        const next = new Set(prev);
        next.delete(data.matchId);
        return next;
      });
      setReadyStatus((prev) => {
        const next = { ...prev };
        delete next[data.matchId];
        return next;
      });
      if (typeof onGameStart === "function") {
        onGameStart({
          roomId: data.roomId,
          gameType: data.gameType,
          gameMode: data.gameMode,
          isTournament: true,
          tournamentId: data.tournamentId,
          matchId: data.matchId,
          isTournamentMatch: true,
          players: data.players,
          gameState: data.gameState,
          spectator: data.spectator || false,
          isSpectatorMode: data.spectator || false, // Add this flag for Game.jsx
          // --- FIX: Prosljeđuj playerNumber i opponent iz servera ---
          playerNumber: data.playerNumber,
          opponent: data.opponent,
        });
      }
    };
    const handleLeaderboard = (data) => setLeaderboard(data);
    const handleReadyStatus = (payload) => {
      if (payload.matchId) {
        // Update ready status for the match
        setReadyStatus((prev) => ({
          ...prev,
          [payload.matchId]: {
            readyCount: payload.readyCount || 0,
            required: payload.required || 2,
          },
        }));

        // Only update UI based on whether this user clicked ready
        if (payload.youAreReady) {
          setMyReadyMatches((prev) => new Set(prev).add(payload.matchId));
        }

        // If both players are ready, clear all ready states (match starting)
        if (payload.readyCount >= (payload.required || 2)) {
          setReadyMatches((prev) => {
            const next = new Set(prev);
            next.delete(payload.matchId);
            return next;
          });
          setMyReadyMatches((prev) => {
            const next = new Set(prev);
            next.delete(payload.matchId);
            return next;
          });
        }
      }
    };
    const handleOpponentReady = ({ matchId }) => {
      // Optional: could show a toast or mark opponent ready
    };

    socket.on("tournamentBracketData", handleBracketData);
    socket.on("bracketUpdated", handleBracketUpdate);
    socket.on("gameStart", handleGameStart);
    socket.on("tournamentLeaderboard", handleLeaderboard);
    socket.on("tournamentMatchReadyStatus", handleReadyStatus);
    socket.on("tournamentOpponentReady", handleOpponentReady);

    return () => {
      socket.off("tournamentBracketData", handleBracketData);
      socket.off("bracketUpdated", handleBracketUpdate);
      socket.off("gameStart", handleGameStart);
      socket.off("tournamentLeaderboard", handleLeaderboard);
      socket.off("tournamentMatchReadyStatus", handleReadyStatus);
      socket.off("tournamentOpponentReady", handleOpponentReady);
    };
  }, [socket, tournamentId]);

  const handleReportResult = (matchId, winnerId) => {
    if (!socket) return;
    socket.emit("reportMatchResult", { tournamentId, matchId, winnerId });
  };
  // Persist current viewed tournament id (defensive in case parent unmount sequence differs)
  useEffect(() => {
    if (tournamentId) {
      localStorage.setItem("tournamentView", tournamentId);
    }
  }, [tournamentId]);

  const deadlineRemaining = (deadline) => {
    if (!deadline) return null;
    const ms = new Date(deadline).getTime() - now;
    if (ms <= 0) return "Isteklo";
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  };

  const renderMatch = (match, roundNumber) => {
    // Normalize identifiers: prefer raw IDs for logic, show names for UI
    const p1Id = match.player1;
    const p2Id = match.player2;
    const isPlayable = match.status === "pending";
    const isFinished = match.status === "finished";
    const isPlaying = match.status === "playing";
    const isWaiting = match.status === "waiting";
    const userKey = user?.userId || user?.name;
    // Check both userId and name since tournament might store either
    const isUserInMatch =
      !!user &&
      (p1Id === user.userId ||
        p1Id === user.name ||
        p2Id === user.userId ||
        p2Id === user.name);
    const remaining = deadlineRemaining(match.deadline);

    // Debug logging for finals match
    if (roundNumber === bracket?.length) {
      console.log("🔍 FINALS DEBUG:", {
        matchId: match.id,
        status: match.status,
        isPlayable,
        p1Id,
        p2Id,
        userKey,
        isUserInMatch,
        user: user,
        myReadyMatches: Array.from(myReadyMatches),
      });
    }

    return (
      <div key={match.id} className={`bracket-match ${match.status}`}>
        <div className="match-header">
          <span className="match-title">
            {roundNumber === 1
              ? "Prva runda"
              : roundNumber === bracket?.length
                ? "Finale"
                : roundNumber === bracket?.length - 1
                  ? "Polufinale"
                  : `Runda ${roundNumber}`}{" "}
            – Meč {match.matchNumber}
          </span>
          {match.status === "playing" && (
            <span className="live-badge">LIVE</span>
          )}
          {match.status === "pending" &&
            match.player1 !== "TBD" &&
            match.player2 !== "TBD" && (
              <span className="pending-badge">Čeka start</span>
            )}
          {match.deadline && (
            <span
              className={`match-deadline ${
                remaining === "Isteklo" ? "expired" : ""
              }`}
            >
              Rok: {new Date(match.deadline).toLocaleString("hr-HR")} (
              {remaining})
            </span>
          )}
        </div>
        <div className="match-players">
          <div className={`player ${match.winner === p1Id ? "winner" : ""}`}>
            <span className="player-name">
              {p1Id === "TBD" ? "Čeka se..." : match.player1Name || p1Id}
            </span>
            {isPlayable && p1Id !== "TBD" && isUserInMatch && (
              <button
                className="report-win-btn"
                onClick={() => handleReportResult(match.id, p1Id)}
              >
                Pobijedio
              </button>
            )}
          </div>
          <div className="match-vs">VS</div>
          <div className={`player ${match.winner === p2Id ? "winner" : ""}`}>
            <span className="player-name">
              {p2Id === "TBD" ? "Čeka se..." : match.player2Name || p2Id}
            </span>
            {isPlayable && p2Id !== "TBD" && isUserInMatch && (
              <button
                className="report-win-btn"
                onClick={() => handleReportResult(match.id, p2Id)}
              >
                Pobijedio
              </button>
            )}
          </div>
        </div>
        {isPlayable && p1Id !== "TBD" && p2Id !== "TBD" && isUserInMatch && (
          <div className="match-actions">
            <button
              className={`start-match-btn ${
                myReadyMatches.has(match.id) ? "disabled" : ""
              }`}
              disabled={myReadyMatches.has(match.id)}
              onClick={() => {
                console.log("🎮 Clicking ready for match:", {
                  tournamentId,
                  matchId: match.id,
                  userKey,
                  p1Id,
                  p2Id,
                });
                socket.emit("tournamentReady", {
                  tournamentId,
                  matchId: match.id,
                });
              }}
            >
              {myReadyMatches.has(match.id)
                ? "⏳ Čeka protivnika"
                : "🎮 Igraj sada"}
            </button>
            {remaining === "Isteklo" && (
              <button
                className="claim-noshow-btn"
                onClick={() => handleReportResult(match.id, userKey)}
              >
                Protivnik se nije pojavio
              </button>
            )}
          </div>
        )}
        {isPlaying && !isUserInMatch && p1Id !== "TBD" && p2Id !== "TBD" && (
          <div className="match-actions spectate-wrapper">
            <button
              className="spectate-btn"
              onClick={() =>
                socket.emit("spectateTournamentMatch", {
                  tournamentId,
                  matchId: match.id,
                })
              }
            >
              👁️ Gledaj
            </button>
          </div>
        )}
        {isPlaying && isUserInMatch && (
          <div className="match-actions spectate-wrapper">
            <button
              className="spectate-btn"
              onClick={() => {
                // Use reconnectToGame for participants to return as player, not spectator
                if (match.gameRoomId) {
                  socket.emit("reconnectToGame", {
                    roomId: match.gameRoomId,
                    playerName: user.name,
                  });
                }
              }}
            >
              🔁 Vrati se u meč
            </button>
          </div>
        )}
        {isPlayable && !isUserInMatch && p1Id !== "TBD" && p2Id !== "TBD" && (
          <div className="match-actions spectate-wrapper">
            <button className="spectate-btn disabled" disabled>
              ⏳ Čeka start
            </button>
          </div>
        )}
        {isFinished && (
          <div className="match-result">
            🏆 Pobjednik: <strong>{match.winner}</strong>
          </div>
        )}
        {isWaiting && (
          <div className="match-waiting">⏳ Čeka se prethodna runda</div>
        )}
      </div>
    );
  };

  const renderRound = (round) => (
    <div key={round.roundNumber} className="bracket-round">
      <h3 className="round-title">{round.name}</h3>
      <div className="round-matches">
        {round.matches.map((m) => renderMatch(m, round.roundNumber))}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="tournament-bracket-container">
        <div className="bracket-header">
          <button className="back-btn" onClick={onBack}>
            ←
          </button>
          <h2>Učitavanje...</h2>
        </div>
      </div>
    );
  }
  if (!tournament || !bracket) {
    return (
      <div className="tournament-bracket-container">
        <div className="bracket-header">
          <button className="back-btn" onClick={onBack}>
            ←
          </button>
          <h2>Greška</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="tournament-bracket-container">
      <div className="bracket-header">
        <button className="back-btn" onClick={onBack} title="Natrag">
          ←
        </button>
        <div className="tournament-info">
          <h2>🏆 {tournament.name}</h2>
          <div className="tournament-meta">
            <span>Igra: {tournament.gameType}</span>
            <span>
              Prijavljeno: {tournament.currentParticipants}/
              {tournament.maxParticipants}
            </span>
            <span>Status: {tournament.status}</span>
          </div>
          {tournament.winner && (
            <div className="tournament-winner-inline">
              Pobjednik: {tournament.winner}
            </div>
          )}
        </div>
        <div className="leaderboard-box">
          <h4>🏅 Leaderboard</h4>
          {leaderboard.slice(0, 5).map((row, idx) => (
            <div key={row.user_id || row.userId} className="lb-row">
              <span>{idx + 1}.</span>
              <span>{row.user_id || row.userId}</span>
              <span>{row.points}p</span>
            </div>
          ))}
        </div>
      </div>
      <div className="bracket-container">{bracket.map(renderRound)}</div>
      {tournament.status === "finished" &&
        bracket[bracket.length - 1]?.matches[0]?.winner && (
          <div className="tournament-winner">
            <h3>🎉 POBJEDNIK</h3>
            <div className="winner-name">
              {bracket[bracket.length - 1].matches[0].winner}
            </div>
          </div>
        )}
    </div>
  );
};

export default TournamentBracket;
