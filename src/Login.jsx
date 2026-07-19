// Login.jsx - Komponenta za autentikaciju sa Supabase

import React, { useState, useEffect } from "react";
import { track } from "@plausible-analytics/tracker";
import { auth } from "./supabase.js";
import { useSocket } from "./SocketContext";
import "./Login.css";

function Login({ onLogin, pendingJoinCode, forceRecoveryMode = false }) {
  const { user } = useSocket();
  const isRecoveryRedirect =
    typeof window !== "undefined" &&
    forceRecoveryMode &&
    (window.location.hash.includes("type=recovery") ||
      window.location.search.includes("type=recovery"));

  const [loginMode, setLoginMode] = useState(
    isRecoveryRedirect ? "recovery" : "guest",
  ); // 'guest', 'login', 'register', 'reset', ili 'recovery'
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Check if user is already logged in
  useEffect(() => {
    if (user && !isRecoveryRedirect) {
      // User is already logged in, skip to next screen
      onLogin(user);
      return;
    }

    if (isRecoveryRedirect) {
      setLoginMode("recovery");
    }

    const checkUser = async () => {
      if (isRecoveryRedirect) {
        return;
      }

      const { user: supabaseUser } = await auth.getUser();
      if (supabaseUser) {
        onLogin({
          name: supabaseUser.user_metadata?.username || supabaseUser.email,
          email: supabaseUser.email,
          isGuest: false,
          userId: supabaseUser.id,
        });
      }
    };
    checkUser();
  }, [onLogin, user, isRecoveryRedirect]);

  // Listen for password recovery redirects and keep the form in recovery mode
  useEffect(() => {
    const { data } = auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setLoginMode("recovery");
        setFormData((current) => ({
          ...current,
          email: session?.user?.email || current.email,
          password: "",
          confirmPassword: "",
        }));
        setError("");
      }
    });

    return () => {
      data?.subscription?.unsubscribe();
    };
  }, []);

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setSuccessMessage("");
  };

  // Generate random 5-character guest name
  const generateGuestId = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      if (loginMode === "guest") {
        // Guest pristup
        const guestName = formData.name.trim() || `Guest_${generateGuestId()}`;
        await onLogin({
          name: guestName,
          isGuest: true,
        });

        // Track guest login
        try {
          track("User Login", {
            props: {
              loginType: "guest",
            },
          });
        } catch (err) {
          console.debug("Analytics tracking error:", err);
        }
      } else if (loginMode === "login") {
        // Supabase login
        const { data, error } = await auth.signIn(
          formData.email,
          formData.password,
        );

        if (error) {
          // Handleuj specifične login greške
          if (
            error.message.includes("Invalid login credentials") ||
            error.message.includes("invalid")
          ) {
            throw new Error("Neispravni podaci za prijavu");
          } else if (error.message.includes("too many")) {
            throw new Error("Previše pokušaja. Pokušajte kasnije.");
          } else {
            throw new Error(error.message || "Greška pri prijavi");
          }
        }

        await onLogin({
          name: data.user.user_metadata?.username || data.user.email,
          email: data.user.email,
          isGuest: false,
          userId: data.user.id,
        });

        // Track registered user login
        try {
          track("User Login", {
            props: {
              loginType: "registered",
            },
          });
        } catch (err) {
          console.debug("Analytics tracking error:", err);
        }
      } else if (loginMode === "register") {
        // Supabase registracija
        if (!formData.name.trim()) {
          throw new Error("Ime je obavezno");
        }

        // Simple email validation
        if (!formData.email.trim()) {
          throw new Error("Email je obavezan");
        }
        if (!formData.email.includes("@") || !formData.email.includes(".")) {
          throw new Error("Unesite važeću email adresu");
        }

        if (formData.password.length < 6) {
          throw new Error("Password mora imati najmanje 6 karaktera");
        }

        const { data, error } = await auth.signUp(
          formData.email.trim(),
          formData.password,
          formData.name.trim(),
        );

        if (error) {
          // Handleuj specifične Supabase greške
          if (
            error.message.includes("already registered") ||
            error.message.includes("already been registered")
          ) {
            throw new Error("Korisnik sa ovim emailom već postoji");
          } else if (error.message.includes("invalid email")) {
            throw new Error("Email adresa nije važeća");
          } else if (error.message.includes("password")) {
            throw new Error("Password nije dovoljno jak");
          } else {
            throw new Error(error.message || "Greška pri registraciji");
          }
        }

        if (data.user) {
          await onLogin({
            name: formData.name.trim(),
            email: formData.email.trim(),
            isGuest: false,
            userId: data.user.id,
          });

          // Track new user registration
          try {
            track("User Registered", {
              props: {
                loginType: "new_account",
              },
            });
          } catch (err) {
            console.debug("Analytics tracking error:", err);
          }
        }
      } else if (loginMode === "reset") {
        if (!formData.email.trim()) {
          throw new Error("Email je obavezan");
        }

        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        const { error } = await auth.requestPasswordReset(
          formData.email.trim(),
          redirectTo,
        );

        if (error) {
          throw new Error(error.message || "Greška pri slanju reset linka");
        }

        setSuccessMessage(
          "Poslali smo vam link za reset lozinke na navedeni email.",
        );
      } else if (loginMode === "recovery") {
        if (formData.password.length < 6) {
          throw new Error("Nova lozinka mora imati najmanje 6 karaktera");
        }

        if (formData.password !== formData.confirmPassword) {
          throw new Error("Lozinke se ne podudaraju");
        }

        const { error } = await auth.updateAccount({
          password: formData.password,
        });

        if (error) {
          throw new Error(error.message || "Greška pri spremanju nove lozinke");
        }

        const { user: supabaseUser } = await auth.getUser();
        if (supabaseUser) {
          await onLogin({
            name: supabaseUser.user_metadata?.username || supabaseUser.email,
            email: supabaseUser.email,
            isGuest: false,
            userId: supabaseUser.id,
          });
        }

        setSuccessMessage("Lozinka je ažurirana. Prijavljujem vas...");

        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", window.location.pathname);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // If user is already logged in, show loading or redirect
  if (user && !isRecoveryRedirect) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="loading-state">
            <h2>Već ste ulogirani</h2>
            <p>Preusmjeravam vas...</p>
          </div>
        </div>
      </div>
    );
  }

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

        {/* Pending join code notification */}
        {pendingJoinCode && (
          <div className="join-code-notification">
            <div className="join-code-icon">🔗</div>
            <div className="join-code-text">
              <strong>Prijavite se kako biste se pridružili igri!</strong>
              <p>
                Vaš prijatelj vas je pozvao da se pridružite igri s kodom:{" "}
                <strong>{pendingJoinCode}</strong>
              </p>
            </div>
          </div>
        )}

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
            🔑 Prijavi se
          </button>
          <button
            type="button"
            className={`mode-btn ${loginMode === "register" ? "active" : ""}`}
            onClick={() => setLoginMode("register")}
          >
            👤 Registriraj se
          </button>
          <button
            type="button"
            className={`mode-btn ${loginMode === "reset" ? "active" : ""}`}
            onClick={() => setLoginMode("reset")}
          >
            🔁 Reset lozinke
          </button>
        </div>

        {/* Forma */}
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}
          {successMessage && (
            <div className="success-message">{successMessage}</div>
          )}

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
          {(loginMode === "login" || loginMode === "register" || loginMode === "reset") && (
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
          {(loginMode === "login" || loginMode === "register" || loginMode === "recovery") && (
            <div className="form-group">
              <label htmlFor="password">
                {loginMode === "recovery" ? "Nova lozinka" : "Password"}
              </label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder={
                  loginMode === "recovery"
                    ? "Unesite novu lozinku"
                    : "Unesite password"
                }
                required
                minLength={6}
              />
            </div>
          )}

          {loginMode === "recovery" && (
            <div className="form-group">
              <label htmlFor="confirmPassword">Potvrdi lozinku</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                placeholder="Ponovite novu lozinku"
                required
                minLength={6}
              />
            </div>
          )}

          {loginMode === "reset" && (
            <div className="password-reset-note">
              Unesite email i poslat ćemo vam sigurni link za postavljanje nove
              lozinke.
            </div>
          )}

          {loginMode === "recovery" && (
            <div className="password-reset-note">
              Unesite novu lozinku za račun koji je otvoren putem reset linka.
            </div>
          )}

          {/* Gumb za prijavu */}
          <button type="submit" className="login-btn" disabled={isLoading}>
            {isLoading ? (
              <span>⏳ Prijavljivanje...</span>
            ) : loginMode === "guest" ? (
              "🎮 Uđi u igru"
            ) : loginMode === "login" ? (
              "🔑 Prijavi se"
            ) : (
              loginMode === "register"
                ? "👤 Registriraj se"
                : loginMode === "reset"
                  ? "🔁 Pošalji link"
                  : "💾 Spremi novu lozinku"
            )}
          </button>

          {loginMode === "reset" && (
            <button
              type="button"
              className="secondary-action-btn"
              onClick={() => setLoginMode("login")}
            >
              Nazad na prijavu
            </button>
          )}
        </form>

        {/* Info o guest pristupu */}
        {loginMode === "guest" && (
          <div className="guest-info">
            <p>
              <strong>Guest pristup:</strong>
              <br />
              • Možete odmah početi igrati
              <br />• Ime će biti nasumično ako ne unesete svoje
              <br />• Registracijom otključavate ELO i leaderboard
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
              <br />• ELO rangiranje i leaderboard
            </p>
          </div>
        )}

        {loginMode === "reset" && (
          <div className="register-info">
            <p>
              <strong>Sigurnosna preporuka:</strong>
              <br />• Ako je Google označio račun kao kompromitiran, obavezno
              koristite novu i jedinstvenu lozinku
              <br />• Nemojte ponovno koristiti staru lozinku na drugim
              servisima
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;
