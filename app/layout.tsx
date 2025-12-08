export const metadata = {
  title: "Kaun Karega",
  description: "Local needs exchange platform",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
