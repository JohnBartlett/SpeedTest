export default function HomePage() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <a
        href="/speedtest"
        style={{
          fontFamily: "system-ui, sans-serif",
          fontSize: 20,
          color: "#0f172a",
          textDecoration: "none",
          border: "1px solid #cbd5e1",
          borderRadius: 12,
          padding: "12px 16px",
        }}
      >
        Open Internet Speed Test
      </a>
    </main>
  );
}
