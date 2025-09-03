"use client";

import { useState } from "react";
import "./CreateGameModal.css";

function CreateGameModal({ gameType, onClose, onCreateGame }) {
  const [formData, setFormData] = useState({
    name: "",
    maxPlayers: 2, // 2 for 1v1, 4 for 2v2
    password: "",
    hasPassword: false,
    akuzeEnabled: true, // Default to enabled for Treseta
  });
  const [errors, setErrors] = useState({});

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    // Ensure numeric fields (like maxPlayers) are stored as numbers
    const parsedValue =
      type === "checkbox"
        ? checked
        : name === "maxPlayers"
        ? parseInt(value, 10)
        : value;

    setFormData((prev) => ({
      ...prev,
      [name]: parsedValue,
    }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    // Game name validation
    if (!formData.name.trim()) {
      newErrors.name = "Game name is required";
    } else if (formData.name.trim().length < 3) {
      newErrors.name = "Game name must be at least 3 characters";
    } else if (formData.name.trim().length > 30) {
      newErrors.name = "Game name must be less than 30 characters";
    }

    // Password validation
    if (formData.hasPassword) {
      if (!formData.password.trim()) {
        newErrors.password = "Password is required when protection is enabled";
      } else if (formData.password.length < 4) {
        newErrors.password = "Password must be at least 4 characters";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const gameData = {
      name: formData.name.trim(),
      maxPlayers: parseInt(formData.maxPlayers),
      password: formData.hasPassword ? formData.password : null,
      hasPassword: formData.hasPassword,
      // Include akuze setting for Treseta
      ...(gameType === "treseta" && { akuzeEnabled: formData.akuzeEnabled }),
    };

    onCreateGame(gameData);
  };

  const getGameModeText = (players) => {
    return players === 2 ? "1v1" : "2v2";
  };

  const getGameIcon = () => {
    return gameType === "briskula" ? "🃏" : "🎯";
  };

  return (
    <div className="modal-overlay">
      <div className="create-game-modal">
        <div className="modal-header">
          <h2>
            {getGameIcon()} Create{" "}
            {gameType.charAt(0).toUpperCase() + gameType.slice(1)} Game
          </h2>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="create-game-form">
          <div className="form-section">
            <label htmlFor="name" className="form-label">
              Game Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Enter game name"
              className={`form-input ${errors.name ? "error" : ""}`}
              maxLength={30}
            />
            {errors.name && <span className="error-text">{errors.name}</span>}
          </div>

          <div className="form-section">
            <label htmlFor="maxPlayers" className="form-label">
              Game Mode
            </label>
            <div className="mode-selector">
              <label
                className={`mode-option ${
                  formData.maxPlayers === 2 ? "selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="maxPlayers"
                  value={2}
                  checked={formData.maxPlayers === 2}
                  onChange={handleInputChange}
                />
                <div className="mode-content">
                  <span className="mode-icon">👥</span>
                  <div className="mode-info">
                    <span className="mode-title">1v1</span>
                    <span className="mode-desc">Two players</span>
                  </div>
                </div>
              </label>

              <label
                className={`mode-option ${
                  formData.maxPlayers === 4 ? "selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="maxPlayers"
                  value={4}
                  checked={formData.maxPlayers === 4}
                  onChange={handleInputChange}
                />
                <div className="mode-content">
                  <span className="mode-icon">👥👥</span>
                  <div className="mode-info">
                    <span className="mode-title">2v2</span>
                    <span className="mode-desc">Four players, two teams</span>
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="checkbox-wrapper">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="hasPassword"
                  checked={formData.hasPassword}
                  onChange={handleInputChange}
                />
                <span className="checkbox-custom"></span>
                <span className="checkbox-text">
                  🔒 Password protect this game
                </span>
              </label>
            </div>

            {formData.hasPassword && (
              <div className="password-section">
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Enter password"
                  className={`form-input password-input ${
                    errors.password ? "error" : ""
                  }`}
                />
                {errors.password && (
                  <span className="error-text">{errors.password}</span>
                )}
                <div className="password-hint">
                  Players will need this password to join your game
                </div>
              </div>
            )}
          </div>

          {/* Akuze option for Treseta */}
          {gameType === "treseta" && (
            <div className="form-section">
              <div className="checkbox-wrapper">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="akuzeEnabled"
                    checked={formData.akuzeEnabled}
                    onChange={handleInputChange}
                  />
                  <span className="checkbox-custom"></span>
                  <span className="checkbox-text">
                    🃏 Omogući akužavanje u igri
                  </span>
                </label>
              </div>
              <div className="akuze-hint">
                Akuzi: Tri/Četiri asa/dvice/trice (3-4 boda), Napolitana (3
                boda)
              </div>
            </div>
          )}

          <div className="game-preview">
            <h4>Game Preview:</h4>
            <div className="preview-content">
              <div className="preview-item">
                <span className="preview-label">Name:</span>
                <span className="preview-value">
                  {formData.name.trim() || "Untitled Game"}
                </span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Type:</span>
                <span className="preview-value">
                  {getGameIcon()}{" "}
                  {gameType.charAt(0).toUpperCase() + gameType.slice(1)}
                </span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Mode:</span>
                <span className="preview-value">
                  {getGameModeText(formData.maxPlayers)}
                </span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Access:</span>
                <span className="preview-value">
                  {formData.hasPassword ? "🔒 Password Protected" : "🌐 Public"}
                </span>
              </div>
              {/* Show akuze status for Treseta */}
              {gameType === "treseta" && (
                <div className="preview-item">
                  <span className="preview-label">Akužavanje:</span>
                  <span className="preview-value">
                    {formData.akuzeEnabled ? "🃏 Omogućeno" : "🚫 Onemogućeno"}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="create-btn">
              Create Game
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateGameModal;
