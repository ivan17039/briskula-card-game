// Login.jsx - Komponenta za autentikaciju

import React, { useState } from "react";
import "./Login.css";

function Login({ onLogin }) {
  const [loginMode, setLoginMode] = useState("guest"); // 'guest' ili 'register'
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      if (loginMode === "guest") {
        // Guest pristup
        const guestName = formData.name.trim() || `Guest_${Date.now()}`;
        await onLogin({
          name: guestName,
          isGuest: true,
        });
      } else {
        // Registracija (za sada samo frontend validacija)
        if (!formData.name.trim()) {
          throw new Error("Ime je obavezno");
        }
        if (!formData.email.trim() || !formData.email.includes("@")) {
          throw new Error("Unesite važeću email adresu");
        }

        await onLogin({
          name: formData.name.trim(),
          email: formData.email.trim(),
          isGuest: false,
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>
          <img
            src="/cards_img/kupeICON.png"
            alt="Dinari"
            className="title-suit-icon"
          />
          Briskula Online
        </h1>
        <p className="subtitle">Pridružite se igri protiv drugih igrača!</p>

        {/* Izbor načina prijave */}
        <div className="login-mode-selector">
          <button
            type="button"
            className={`mode-btn ${loginMode === "guest" ? "active" : ""}`}
            onClick={() => setLoginMode("guest")}
          >
            🎮 Igraj kao gost
          </button>
          <button
            type="button"
            className={`mode-btn ${loginMode === "register" ? "active" : ""}`}
            onClick={() => setLoginMode("register")}
          >
            👤 Registriraj se
          </button>
        </div>

        {/* Forma */}
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}

          {/* Ime korisnika */}
          <div className="form-group">
            <label htmlFor="name">
              {loginMode === "guest" ? "Nadimak (opcionalno)" : "Ime korisnika"}
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder={loginMode === "guest" ? "Guest_123" : "Unesite ime"}
              required={loginMode === "register"}
            />
          </div>

          {/* Email (samo za registraciju) */}
          {loginMode === "register" && (
            <div className="form-group">
              <label htmlFor="email">Email adresa</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="your@email.com"
                required
              />
            </div>
          )}

          {/* Gumb za prijavu */}
          <button type="submit" className="login-btn" disabled={isLoading}>
            {isLoading ? (
              <span>⏳ Prijavljivanje...</span>
            ) : loginMode === "guest" ? (
              "🎮 Uđi u igru"
            ) : (
              "👤 Registriraj se"
            )}
          </button>
        </form>

        {/* Info o guest pristupu */}
        {loginMode === "guest" && (
          <div className="guest-info">
            <p>
              <strong>Guest pristup:</strong>
              <br />
              • Možete odmah početi igrati
              <br />
              • Nema trajnog rangiranja
              <br />• Ime će biti nasumično ako ne unesete svoje
            </p>
          </div>
        )}

        {/* Info o registraciji */}
        {loginMode === "register" && (
          <div className="register-info">
            <p>
              <strong>Registracija omogućuje:</strong>
              <br />
              • Trajno čuvanje statistika
              <br />
              • Sudjelovanje u turnirima
              <br />• Personalizirani profil
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;
