import React, { useEffect, useState } from "react";
import { auth } from "./supabase.js";
import { useSocket } from "./SocketContext";
import "./AboutModal.css";
import "./AccountModal.css";

function AccountModal({ onClose }) {
  const { user, updateUserProfile } = useSocket();
  const [formData, setFormData] = useState({
    name: user?.name || "",
    password: "",
    confirmPassword: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    setFormData({
      name: user?.name || "",
      password: "",
      confirmPassword: "",
    });
  }, [user]);

  const handleInputChange = (e) => {
    setFormData((current) => ({
      ...current,
      [e.target.name]: e.target.value,
    }));
    setError("");
    setSuccessMessage("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      if (!user) {
        throw new Error("Nema prijavljenog korisnika");
      }

      if (user.isGuest) {
        throw new Error("Gost računi nemaju dostupno upravljanje računom");
      }

      if (formData.password && formData.password.length < 6) {
        throw new Error("Nova lozinka mora imati najmanje 6 karaktera");
      }

      if (formData.password && formData.password !== formData.confirmPassword) {
        throw new Error("Lozinke se ne podudaraju");
      }

      const updates = {};
      if (formData.name.trim() && formData.name.trim() !== user.name) {
        updates.name = formData.name.trim();
      }
      if (formData.password) {
        updates.password = formData.password;
      }

      if (!updates.name && !updates.password) {
        throw new Error("Nema promjena za spremiti");
      }

      await updateUserProfile(updates);

      setFormData((current) => ({
        ...current,
        password: "",
        confirmPassword: "",
      }));
      setSuccessMessage("Promjene su spremljene.");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendResetEmail = async () => {
    setIsResetting(true);
    setError("");
    setSuccessMessage("");

    try {
      if (!user?.email) {
        throw new Error("Nedostaje email adresa korisnika");
      }

      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error: resetError } = await auth.requestPasswordReset(
        user.email,
        redirectTo,
      );

      if (resetError) {
        throw new Error(resetError.message || "Nije moguće poslati reset link");
      }

      setSuccessMessage(
        "Reset link je poslan na vaš email. Provjerite pristiglu poštu.",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content account-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Račun</h2>
          <button className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body account-modal-body">
          <p className="account-intro">
            Upravite naziv profila i lozinku. Za registrirane račune dostupno je
            i slanje reset linka na email.
          </p>

          {error && <div className="account-status error-status">{error}</div>}
          {successMessage && (
            <div className="account-status success-status">
              {successMessage}
            </div>
          )}

          <form onSubmit={handleSave} className="account-form">
            <div className="account-grid">
              <div className="form-group">
                <label htmlFor="accountName">Ime korisnika</label>
                <input
                  type="text"
                  id="accountName"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  disabled={user?.isGuest}
                />
              </div>

              <div className="form-group">
                <label htmlFor="accountEmail">Email</label>
                <input
                  type="email"
                  id="accountEmail"
                  value={user?.email || ""}
                  disabled
                />
              </div>
            </div>

            <div className="account-note">
              <strong>Sigurnost:</strong> koristite jedinstvenu lozinku koja se
              ne koristi na drugim servisima.
            </div>

            <div className="account-grid">
              <div className="form-group">
                <label htmlFor="accountPassword">Nova lozinka</label>
                <input
                  type="password"
                  id="accountPassword"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  minLength={6}
                  disabled={user?.isGuest}
                />
              </div>

              <div className="form-group">
                <label htmlFor="accountConfirmPassword">
                  Potvrdi novu lozinku
                </label>
                <input
                  type="password"
                  id="accountConfirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  minLength={6}
                  disabled={user?.isGuest}
                />
              </div>
            </div>

            {user?.isGuest && (
              <div className="account-note guest-note">
                Gost računi mogu koristiti samo privremeni nadimak. Za trajno
                upravljanje računom registrirajte se s email adresom.
              </div>
            )}

            <div className="account-actions">
              <button
                type="submit"
                className="account-primary-btn"
                disabled={isSaving || user?.isGuest}
              >
                {isSaving ? "Spremanje..." : "Spremi promjene"}
              </button>

              <button
                type="button"
                className="account-secondary-btn"
                onClick={handleSendResetEmail}
                disabled={isResetting || user?.isGuest}
              >
                {isResetting ? "Šaljem..." : "Pošalji reset link"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AccountModal;
