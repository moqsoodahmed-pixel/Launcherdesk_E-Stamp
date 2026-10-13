import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal, { ConfirmDialog } from "./Modal";
import { useConfirm } from "./useConfirm";
import Toast from "./Toast";

function Harness({ onClose }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open && (
        <Modal
          title="Example dialog"
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
          footer={<button type="button">Save</button>}
        >
          <input aria-label="Name" />
        </Modal>
      )}
    </>
  );
}

describe("Modal", () => {
  it("is a labelled modal dialog that moves focus inside on open", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = screen.getByRole("dialog", { name: "Example dialog" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement);
  });

  it("traps Tab and Shift+Tab inside the dialog", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByRole("button", { name: "Open dialog" }));
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(close).toHaveFocus();
    await u.tab();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await u.tab();
    expect(save).toHaveFocus();
    await u.tab();
    expect(close).toHaveFocus();
    await u.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it("closes on Escape and restores focus to the element that opened it", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await u.click(opener);
    await u.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes on the close button and on a backdrop click", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await u.click(screen.getByRole("button", { name: "Open dialog" }));
    await u.click(screen.getByRole("button", { name: "Close" }));
    await u.click(screen.getByRole("button", { name: "Open dialog" }));
    await u.click(document.querySelector("[aria-hidden='true'].absolute.inset-0"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close on Escape while it has no onClose (busy)", async () => {
    const u = userEvent.setup();
    render(
      <Modal title="Busy">
        <button type="button">Only</button>
      </Modal>
    );
    await u.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Busy" })).toBeInTheDocument();
  });
});

describe("ConfirmDialog and useConfirm", () => {
  it("ConfirmDialog calls onConfirm and onCancel from its buttons", async () => {
    const u = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete it?" confirmLabel="Delete" tone="danger" onConfirm={onConfirm} onCancel={onCancel} />);
    await u.click(screen.getByRole("button", { name: "Delete" }));
    await u.click(screen.getByRole("button", { name: "Go back" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  function ConfirmHarness({ onResult }) {
    const [confirm, dialog] = useConfirm();
    return (
      <>
        <button type="button" onClick={async () => onResult(await confirm({ title: "Proceed?", confirmLabel: "Proceed" }))}>
          Ask
        </button>
        {dialog}
      </>
    );
  }

  it("resolves true on confirm, false on Go back and false on Escape, restoring focus each time", async () => {
    const u = userEvent.setup();
    const onResult = vi.fn();
    render(<ConfirmHarness onResult={onResult} />);
    const ask = screen.getByRole("button", { name: "Ask" });

    await u.click(ask);
    await u.click(screen.getByRole("button", { name: "Proceed" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));

    await u.click(ask);
    await u.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));

    await u.click(ask);
    await u.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ask).toHaveFocus();
    expect(onResult).toHaveBeenCalledTimes(3);
  });
});

describe("Toast", () => {
  it("announces errors as alerts and other notices as status", () => {
    render(
      <>
        <Toast tone="error">Could not save.</Toast>
        <Toast tone="success">Saved.</Toast>
      </>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save.");
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });
});
