export default function PrivacyPolicy() {
  return (
    <main
      style={{
        backgroundColor: "#ffffff",
        minHeight: "100vh",
        width: "100%",
        padding: "clamp(20px, 4vw, 40px) clamp(16px, 4vw, 32px)",
        color: "#111827",
        fontFamily:
          "var(--font-geist-sans), Arial, Helvetica, sans-serif",
        lineHeight: 1.7,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{`
        .kk-privacy * {
          color: inherit;
        }
        .kk-privacy h1 {
          font-size: clamp(26px, 4vw, 34px);
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 8px;
          line-height: 1.25;
        }
        .kk-privacy h2 {
          font-size: clamp(18px, 2.6vw, 22px);
          font-weight: 600;
          color: #0f172a;
          margin: 28px 0 10px;
          line-height: 1.3;
        }
        .kk-privacy p {
          color: #1f2937;
          margin: 0 0 12px;
          font-size: clamp(15px, 1.8vw, 16px);
        }
        .kk-privacy ul {
          color: #1f2937;
          padding-left: 22px;
          margin: 0 0 12px;
          font-size: clamp(15px, 1.8vw, 16px);
        }
        .kk-privacy li {
          margin: 4px 0;
        }
        .kk-privacy strong {
          color: #0f172a;
        }
        .kk-privacy .kk-meta {
          color: #4b5563;
          font-size: 14px;
          margin-bottom: 20px;
        }
        @media (prefers-color-scheme: dark) {
          .kk-privacy-shell {
            background-color: #ffffff !important;
            color: #111827 !important;
          }
        }
      `}</style>

      <article
        className="kk-privacy kk-privacy-shell"
        style={{
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
        <h1>Privacy Policy</h1>
        <p className="kk-meta">Last updated: DD/MM/YYYY</p>

        <p>
          Welcome to <strong>Kaun Karega</strong> ("Platform", "we", "our", "us"). This Privacy Policy explains how we
          collect, use, and protect your personal information when you use our platform.
        </p>

        <h2>1. Information We Collect</h2>
        <p><strong>a) Personal Information:</strong> Name, phone number, location/area, service category, provider details.</p>
        <p><strong>b) Auto-collected Data:</strong> Device info, IP address, browser info, usage logs.</p>
        <p><strong>c) Communication Data:</strong> OTP logs, WhatsApp messages (delivery reports), support messages.</p>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>To verify your identity and send OTP</li>
          <li>To connect customers with service providers</li>
          <li>To improve platform experience</li>
          <li>To communicate job notifications and updates</li>
          <li>To prevent fraud and unauthorized use</li>
        </ul>

        <h2>3. Sharing of Information</h2>
        <p>Your information may be shared with:</p>
        <ul>
          <li>Service providers you choose</li>
          <li>WhatsApp Cloud API (Meta) for OTP & notifications</li>
          <li>Google APIs for backend operations</li>
          <li>Government authorities if legally required</li>
        </ul>

        <h2>4. Cookies</h2>
        <p>We may use cookies to maintain login sessions and enhance user experience.</p>

        <h2>5. Data Security</h2>
        <p>
          We use industry-standard practices such as HTTPS, encrypted storage where applicable, and restricted access to
          secure your data.
        </p>

        <h2>6. Data Retention</h2>
        <ul>
          <li>OTP logs: up to 30 days</li>
          <li>Service request history: up to 1 year</li>
          <li>Legal compliance data: as required</li>
        </ul>

        <h2>7. Your Rights</h2>
        <p>You have the right to request:</p>
        <ul>
          <li>Data correction</li>
          <li>Data deletion</li>
          <li>Data access</li>
          <li>Clarification on how your data is used</li>
        </ul>
        <p>To exercise your rights, email us at: <strong>rishabh22rathi@gmail.com</strong></p>

        <h2>8. Third-Party Services</h2>
        <p>We use:</p>
        <ul>
          <li>WhatsApp Cloud API (Meta)</li>
          <li>Google Sheets & Google APIs</li>
          <li>Hostinger for website hosting</li>
        </ul>

        <h2>9. Children's Privacy</h2>
        <p>Kaun Karega is not intended for children under the age of 13.</p>

        <h2>10. Updates to This Policy</h2>
        <p>We may update this Privacy Policy occasionally. Updates will be posted on this page.</p>

        <h2>Contact Us</h2>
        <p>If you have any questions, contact us at: <strong>rishabh22rathi@gmail.com</strong></p>
      </article>
    </main>
  );
}
