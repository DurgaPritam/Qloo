"use client";

import { Button, useCopy } from "./ui";

/** Copies the current page's address. */
export function CopyLinkButton({ label = "Copy link" }: { label?: string }) {
  const { copied, copy } = useCopy();
  return <Button onClick={() => copy("link", window.location.href)}>{copied ? "Copied" : label}</Button>;
}
