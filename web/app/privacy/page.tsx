import React from "react";

export default function PrivacyPage() {
  return (
    <main style={{ backgroundColor: "#f3f4f6", minHeight: "100vh", padding: "24px" }}>
      <section
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          backgroundColor: "#ffffff",
          padding: "32px",
          borderRadius: "8px",
        }}
      >
        <style>{`
      * {
        color: #111111 !important;
        opacity: 1 !important;
        filter: none !important;
      }
      h1, h2, h3 {
        color: #0f172a !important;
      }
      p, li {
        color: #1f2937 !important;
      }
    `}</style>

        <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "12px" }}>
          Privacy Policy - Kaun Karega (Updated)
        </h1>
        <p>We collect phone numbers only to send OTPs and provide service updates.</p>
        <p>We do not sell or share your data with third parties.</p>
        <p>WhatsApp messages sent by us are purely transactional.</p>
        <p>If you have any questions, contact us at <a href="mailto:kaunkarega.in@gmail.com">kaunkarega.in@gmail.com</a>.</p>
      </section>
    </main>
  );
}
