"use client";

import * as React from "react";

/** Last-resort boundary: replaces the root layout, so it carries its own html/body and inline styles. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#f8f8f6",
          color: "#20211f",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <main style={{ maxWidth: 460, padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6c7067" }}>PoolGuard</p>
          <h1 style={{ fontSize: 28, letterSpacing: "-0.03em", margin: "12px 0 0" }}>PoolGuard couldn’t start.</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "#565952" }}>
            Your tasks and budgets are safe on chain. Reload to try again.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 16,
              height: 44,
              padding: "0 20px",
              borderRadius: 8,
              border: 0,
              background: "#242721",
              color: "#fff",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
