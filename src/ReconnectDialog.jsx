import React from "react";
import { useSocket } from "./SocketContext";
import "./ReconnectDialog.css";

function ReconnectDialog({ onDismiss, onReconnect }) {
  const { gameState, isConnected, reconnectAttempts } = useSocket();

  if (!gameState) return null;

  const handleReconnect = () => {
    onReconnect();
  };

  const handleDismiss = () => {
    onDismiss();
  };

  return (
    <div className="reconnect-overlay">
      <div className="reconnect-dialog">
        <div className="reconnect-header">
          <h2>🔄 Ponovno spajanje</h2>
          <div className="connection-status">
            {isConnected ? "✅ Spojen" : "❌ Nije spojen"}
          </div>
        </div>

        <div className="reconnect-content">
          <p>Detektirana je prekinuta igra:</p>
          <div className="game-info">
            <div className="info-item">
              <strong>Soba:</strong> {gameState.roomId}
            </div>
            <div className="info-item">
              <strong>Tip igre:</strong> {gameState.gameType || "briskula"}
            </div>
            <div className="info-item">
              <strong>Način:</strong> {gameState.gameMode || "1v1"}
            </div>
          </div>

          {!isConnected && (
            <div className="connection-warning">
              <p>⚠️ Nema konekcije sa serverom</p>
              <small>Pokušava se reconnectirati automatski...</small>
            </div>
          )}

          {reconnectAttempts > 0 && (
            <div className="reconnect-attempts">
              <small>Pokušaj reconnectiranja: {reconnectAttempts}</small>
            </div>
          )}
        </div>

        <div className="reconnect-actions">
          <button
            className="btn-primary"
            onClick={handleReconnect}
            disabled={!isConnected}
          >
            🔄 Povezi me nazad u sobu
          </button>
          <button className="btn-secondary" onClick={handleDismiss}>
            ❌ Odustani i idi na glavni meni
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReconnectDialog;
