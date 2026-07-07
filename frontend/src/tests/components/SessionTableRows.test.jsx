import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SessionTableRows from "../../components/SessionTableRows";

const styles = {
  empty: {},
  td: {},
  name: {},
  email: {},
  badge: {},
  terminateBtn: {},
};

describe("SessionTableRows", () => {
  test("renders loading row as an array-compatible fragment", () => {
    render(
      <table><tbody><SessionTableRows loading filtered={[]} now={0} onTerminate={vi.fn()} styles={styles} /></tbody></table>
    );
    expect(screen.getByText("Loading sessions…")).toBeInTheDocument();
  });

  test("renders empty state when no sessions match", () => {
    render(
      <table><tbody><SessionTableRows loading={false} filtered={[]} now={0} onTerminate={vi.fn()} styles={styles} /></tbody></table>
    );
    expect(screen.getByText("No active sessions.")).toBeInTheDocument();
  });

  test("renders session rows and terminate action", () => {
    const onTerminate = vi.fn();
    const sess = {
      id: 7,
      name: "Alice",
      email: "alice@example.com",
      role: "worker",
      source_ip: "127.0.0.1",
      user_agent: "TestAgent",
      created_at: "2026-01-01T10:00:00Z",
      last_activity: "2026-01-01T11:00:00Z",
      expires_at: "2026-01-01T14:00:00Z",
    };

    render(
      <table><tbody><SessionTableRows loading={false} filtered={[sess]} now={Date.now()} onTerminate={onTerminate} styles={styles} /></tbody></table>
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Terminate" }));
    expect(onTerminate).toHaveBeenCalledWith(sess);
  });
});
