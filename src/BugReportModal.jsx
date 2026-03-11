import React, { useState } from "react";
import { useToast } from "./ToastProvider";
import "./BugReportModal.css";

function BugReportModal({ onClose }) {
  const { addToast } = useToast();
  const [formData, setFormData] = useState({
    type: "bug",
    description: "",
    steps: "",
    contact: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.description.trim()) {
      addToast("Molimo opišite problem", "error");
      return;
    }

    // Require minimum detail for bug reports
    if (formData.type === "bug" && formData.description.trim().length < 20) {
      addToast("Molimo detaljnije opišite problem (min. 20 znakova)", "error");
      return;
    }

    // Encourage steps for bug reports
    if (formData.type === "bug" && !formData.steps.trim()) {
      const proceed = window.confirm(
        "Niste naveli korake za reprodukciju. Bez njih teže je riješiti problem.\n\nŽelite li ipak poslati prijavu?",
      );
      if (!proceed) return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        subject: `${formData.type.toUpperCase()} prijava`,
        description: `Opis:\n${formData.description}\n\nKoraci:\n${
          formData.steps || "(nije navedeno)"
        }`,
        reporterName: localStorage.getItem("userName") || "Anon",
        reporterEmail: formData.contact || undefined,
      };

      const apiBase =
        import.meta.env.VITE_SERVER_URL ||
        import.meta.env.VITE_API_URL ||
        window.location.origin;
      const reportUrl = new URL("/api/report-bug", apiBase).toString();
      const resp = await fetch(reportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Try to parse JSON only when available
      const contentType = resp.headers.get("content-type") || "";
      let json = null;
      if (contentType.includes("application/json")) {
        try {
          json = await resp.json();
        } catch (e) {
          // fall through if body is empty
          json = null;
        }
      }

      if (!resp.ok) {
        const serverMsg = json?.error || json?.message || resp.statusText;
        throw new Error(serverMsg || `HTTP ${resp.status}`);
      }

      if (json && json.success === false) {
        throw new Error(json.error || "Slanje nije uspjelo");
      }

      addToast("Hvala! Vaša prijava je poslana.", "success");
      onClose();
    } catch (error) {
      addToast(
        `Greška pri slanju: ${error.message || "Nepoznata greška"}`,
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bug-modal-overlay" onClick={onClose}>
      <div className="bug-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="bug-modal-header">
          <h2>🐛 Prijavi problem</h2>
          <button className="bug-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bug-form">
          <div className="bug-help-banner">
            <strong>💡 Savjet:</strong> Detaljniji opisi pomažu nam brže
            riješiti probleme! Navedite što ste radili, što se dogodilo, i što
            ste očekivali.
          </div>

          <div className="form-group-bug">
            <label htmlFor="type">Vrsta problema</label>
            <select
              id="type"
              name="type"
              value={formData.type}
              onChange={handleChange}
              required
            >
              <option value="bug">🐛 Bug</option>
              <option value="feature">💡 Prijedlog</option>
              <option value="balance">⚖️ Balans igre</option>
              <option value="other">📝 Ostalo</option>
            </select>
          </div>

          <div className="form-group-bug">
            <label htmlFor="description">
              Opis problema *{" "}
              {formData.type === "bug" && formData.description.length < 20 && (
                <span className="char-hint">
                  ({formData.description.length}/20 znakova)
                </span>
              )}
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder={
                formData.type === "bug"
                  ? "Primjer: Kada igram Briskulu 1v1, nakon što odbijem karte protivnik ostaje zaglavljan 'Čeka protivnika...' i igra se ne nastavlja. Morao sam osvježiti stranicu."
                  : "Opišite što se dogodilo..."
              }
              rows="5"
              required
            />
            {formData.type === "bug" &&
              formData.description.length < 20 &&
              formData.description.length > 0 && (
                <p className="form-hint form-warning">
                  ⚠️ Molimo detaljnije - navedite što ste radili i što se
                  dogodilo
                </p>
              )}
          </div>

          <div className="form-group-bug">
            <label htmlFor="steps">
              Koraci za reprodukciju{" "}
              {formData.type === "bug" && (
                <span className="recommended-badge">preporučeno</span>
              )}
            </label>
            <textarea
              id="steps"
              name="steps"
              value={formData.steps}
              onChange={handleChange}
              placeholder="1. Kliknuo sam 'Pronađi partiju' za Briskulu 1v1&#10;2. Pričekao matchmaking&#10;3. Igra je počela, odigrao sam prvu kartu&#10;4. Problem: protivnik ne igra, piše 'Čeka...' već 5 minuta"
              rows="4"
            />
            <p className="form-hint">
              📝 Koraci pomažu nam reproducirati i riješiti problem brže
            </p>
          </div>

          <div className="form-group-bug">
            <label htmlFor="contact">Vaš email (opcionalno)</label>
            <input
              type="email"
              id="contact"
              name="contact"
              value={formData.contact}
              onChange={handleChange}
              placeholder="email@example.com"
            />
            <p className="form-hint">
              Za povratnu informaciju o statusu prijave.
            </p>
          </div>

          <div className="bug-form-actions">
            <button
              type="button"
              className="bug-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Odustani
            </button>
            <button
              type="submit"
              className="bug-submit-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? "⏳ Šaljem..." : "📤 Pošalji"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BugReportModal;
