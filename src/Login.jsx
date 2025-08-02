// Login.jsx - Komponenta za autentikaciju sa Supabase

import React, { useState, useEffect } from "react";
import { auth } from "./supabase.js";
import "./Login.css";

function Login({ onLogin }) {
  const [loginMode, setLoginMode] = useState("guest"); // 'guest', 'login', ili 'register'
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Check if user is already logged in
  useEffect(() => {
    const checkUser = async () => {
      const { user } = await auth.getUser();
      if (user) {
        onLogin({
          name: user.user_metadata?.username || user.email,
          email: user.email,
          isGuest: false,
          userId: user.id,
        });
      }
    };
    checkUser();
  }, [onLogin]);

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
      } else if (loginMode === "login") {
        // Supabase login
        const { data, error } = await auth.signIn(
          formData.email,
          formData.password
        );
        if (error) throw error;

        await onLogin({
          name: data.user.user_metadata?.username || data.user.email,
          email: data.user.email,
          isGuest: false,
          userId: data.user.id,
        });
      } else if (loginMode === "register") {
        // Supabase registracija
        if (!formData.name.trim()) {
          throw new Error("Ime je obavezno");
        }
        if (!formData.email.trim() || !formData.email.includes("@")) {
          throw new Error("Unesite važeću email adresu");
        }
        if (formData.password.length < 6) {
          throw new Error("Password mora imati najmanje 6 karaktera");
        }

        const { data, error } = await auth.signUp(
          formData.email,
          formData.password,
          formData.name
        );
        if (error) throw error;

        if (data.user) {
          await onLogin({
            name: formData.name.trim(),
            email: formData.email.trim(),
            isGuest: false,
            userId: data.user.id,
          });
        }
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
            className={`mode-btn ${loginMode === "login" ? "active" : ""}`}
            onClick={() => setLoginMode("login")}
          >
            🔑 Prijaviť se
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

          {/* Ime korisnika - samo za guest i register */}
          {(loginMode === "guest" || loginMode === "register") && (
            <div className="form-group">
              <label htmlFor="name">
                {loginMode === "guest"
                  ? "Nadimak (opcionalno)"
                  : "Ime korisnika"}
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder={
                  loginMode === "guest" ? "Guest_123" : "Unesite ime"
                }
                required={loginMode === "register"}
              />
            </div>
          )}

          {/* Email (za login i registraciju) */}
          {(loginMode === "login" || loginMode === "register") && (
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

          {/* Password (za login i registraciju) */}
          {(loginMode === "login" || loginMode === "register") && (
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Unesite password"
                required
                minLength={6}
              />
            </div>
          )}

          {/* Gumb za prijavu */}
          <button type="submit" className="login-btn" disabled={isLoading}>
            {isLoading ? (
              <span>⏳ Prijavljivanje...</span>
            ) : loginMode === "guest" ? (
              "🎮 Uđi u igru"
            ) : loginMode === "login" ? (
              "🔑 Prijaviť se"
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
