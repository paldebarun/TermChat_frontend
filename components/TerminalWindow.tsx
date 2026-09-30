"use client";

import React from "react";

export function TerminalWindow({
  title,
  children,
  width = 460,
}: {
  title: string;
  children: React.ReactNode;
  width?: number | string;
}) {
  return (
    <div className="term-window" style={{ width, maxWidth: "92vw" }}>
      <div className="term-titlebar">
        <div className="term-dots">
          <span />
          <span />
          <span />
        </div>
        <div>{title}</div>
        <div style={{ width: 30 }} />
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

export function CenteredScreen({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}
