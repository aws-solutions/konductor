// SPDX-License-Identifier: Apache-2.0
// Which folders of a list are open, kept in localStorage per list. A folder
// the user never toggled uses the default: open when its name starts with
// "_k-" or "fuse-", closed otherwise. Only toggled folders are stored, so a
// browser with no stored state shows the default for every folder.

import { useState } from "react";

const openByDefault = (name: string) => name.startsWith("_k-") || name.startsWith("fuse-");

function load(storageKey: string): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

// `key` names one folder of the list, such as "fuse-flow:examples/superpowers";
// `name` is the folder's own name, which decides its default. A location
// section passes `defaultOpen` instead, since it is not a folder.
export function useFolderState(storageKey: string) {
  const [stored, setStored] = useState<Record<string, boolean>>(() => load(storageKey));
  const isOpen = (key: string, name: string, defaultOpen = openByDefault(name)) => stored[key] ?? defaultOpen;
  const toggle = (key: string, name: string, defaultOpen = openByDefault(name)) => {
    const next = { ...stored, [key]: !isOpen(key, name, defaultOpen) };
    setStored(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage full or disabled: the state lasts until the page reloads.
    }
  };
  return { isOpen, toggle };
}

// Every folder prefix of a path: "a/b/c" gives "a", "a/b", "a/b/c".
export function folderPrefixes(dir: string): { prefix: string; name: string }[] {
  const parts = dir.split("/").filter(Boolean);
  return parts.map((name, i) => ({ prefix: parts.slice(0, i + 1).join("/"), name }));
}
