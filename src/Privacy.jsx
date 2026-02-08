import React from "react";
import "./Privacy.css";

function Privacy({ onBack }) {
  return (
    <div className="privacy-container">
      <div className="privacy-card">
        <div className="privacy-header">
          <button className="privacy-back-btn" onClick={onBack}>
            ←
          </button>
          <h1>Privatnost</h1>
        </div>

        <div className="privacy-content">
          <p>
            Vodimo brigu o vašoj privatnosti. Ova aplikacija prikuplja minimalne
            podatke potrebne za funkcionalnost (npr. korisničko ime, email za
            registrirane korisnike, statistika mečeva). Podaci se čuvaju u
            Supabase sustavu.
          </p>

          <h2>Koje podatke prikupljamo?</h2>
          <ul>
            <li>Korisnički račun: email, nadimak (za registrirane)</li>
            <li>Statistika: pobjede/porazi, ELO</li>
            <li>Tehnički podaci: session tokeni, ID soba</li>
          </ul>

          <h2>Kako koristimo podatke?</h2>
          <p>
            Podaci služe za autentikaciju, održavanje sesija, prikaz ljestvice i
            poboljšanje kvalitete igre. Ne dijelimo podatke s trećim stranama.
          </p>

          <h2>Vaša prava</h2>
          <ul>
            <li>Pravo na uvid i brisanje podataka</li>
            <li>Pravo na odjavu i deaktivaciju računa</li>
            <li>Pravo na prijavu problema putem "Prijavi bug" opcije</li>
          </ul>

          <p>
            Za upite vezane uz privatnost i podršku koristite in-app opciju
            "Prijavi bug".
          </p>
        </div>
      </div>
    </div>
  );
}

export default Privacy;
