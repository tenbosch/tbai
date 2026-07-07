import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "./ThemeContext";
import TbaiLogo from "./TbaiLogo";
import ProfileMenu from "./ProfileMenu";
import NotificationsBell from "./NotificationsBell";
import useAuthFetch from "./useAuthFetch";

const HEADER_H = 56;
const KIND_ICONS = { shopping: "🛒", todo: "✅", meal: "🍽️" };

export default function ListsPage({ onNavigateAdmin, onNavigateHome }) {
  const authFetch = useAuthFetch();
  const theme = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const [lists, setLists] = useState([]); // [{...list, items: [...]}]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newListName, setNewListName] = useState("");
  const [drafts, setDrafts] = useState({}); // listId -> new item text

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const res = await authFetch("/lists");
      const summaries = await res.json();
      const full = await Promise.all(
        summaries.map(async (l) => {
          const r = await authFetch(`/lists/${l.id}`);
          return r.json();
        })
      );
      setLists(full);
    } catch (err) {
      setError("Could not load lists. Is the backend running?");
      console.error("Failed to load lists:", err);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadAll();
  }, [loadAll]);

  const handleCreateList = async () => {
    const name = newListName.trim();
    if (!name) return;
    try {
      await authFetch("/lists", { method: "POST", body: JSON.stringify({ name }) });
      setNewListName("");
      await loadAll();
    } catch (err) {
      setError(err.status === 409 ? "A list with that name already exists." : "Could not create list.");
    }
  };

  const handleDeleteList = async (id) => {
    try {
      await authFetch(`/lists/${id}`, { method: "DELETE" });
      setLists((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      console.error("Failed to delete list:", err);
    }
  };

  const handleAddItem = async (listId) => {
    const text = (drafts[listId] || "").trim();
    if (!text) return;
    try {
      await authFetch(`/lists/${listId}/items`, { method: "POST", body: JSON.stringify({ text }) });
      setDrafts((d) => ({ ...d, [listId]: "" }));
      const r = await authFetch(`/lists/${listId}`);
      const fresh = await r.json();
      setLists((prev) => prev.map((l) => (l.id === listId ? fresh : l)));
    } catch (err) {
      console.error("Failed to add item:", err);
    }
  };

  const handleToggleItem = async (listId, item) => {
    // optimistic toggle; reconcile on failure
    setLists((prev) =>
      prev.map((l) =>
        l.id === listId
          ? { ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) }
          : l
      )
    );
    try {
      await authFetch(`/lists/${listId}/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !item.done }),
      });
    } catch (err) {
      console.error("Failed to toggle item:", err);
      await loadAll();
    }
  };

  const handleDeleteItem = async (listId, itemId) => {
    try {
      await authFetch(`/lists/${listId}/items/${itemId}`, { method: "DELETE" });
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l
        )
      );
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  return (
    <div style={styles.root} className="tbai-vh">
      <div style={styles.header}>
        <button style={styles.logoBtn} onClick={onNavigateHome} title="Home">
          <TbaiLogo style={{ padding: "4px 2px" }} variant={theme.mode === "dark" ? "dark" : "light"} />
        </button>
        <div style={styles.headerRight}>
          <NotificationsBell />
          <ProfileMenu onNavigateAdmin={onNavigateAdmin} />
        </div>
      </div>

      <div style={styles.body}>
        <h1 style={styles.heading}>Family Lists</h1>
        <p style={styles.tagline}>
          Shared with the whole family — add items here or just ask tBai in chat.
        </p>

        <div style={styles.newListRow}>
          <input
            style={styles.input}
            placeholder="New list name (e.g. Shopping, Weekend todos)…"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateList()}
            maxLength={60}
          />
          <button style={styles.primaryBtn} onClick={handleCreateList} disabled={!newListName.trim()}>
            Create
          </button>
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}
        {!loading && !error && lists.length === 0 && (
          <p style={styles.empty}>
            No lists yet — create one above, or tell tBai "add milk to the shopping list".
          </p>
        )}

        <div style={styles.grid}>
          {lists.map((l) => (
            <div key={l.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>
                  {KIND_ICONS[l.kind] || "📝"} {l.name}
                </span>
                <button
                  style={styles.cardDelete}
                  onClick={() => handleDeleteList(l.id)}
                  title="Delete list"
                  aria-label={`Delete list "${l.name}"`}
                >
                  ×
                </button>
              </div>

              {l.items.length === 0 && <div style={styles.cardEmpty}>Empty</div>}
              {l.items.map((item) => (
                <div key={item.id} style={styles.itemRow}>
                  <label style={styles.itemLabel}>
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => handleToggleItem(l.id, item)}
                      style={styles.checkbox}
                    />
                    <span style={item.done ? styles.itemTextDone : styles.itemText}>
                      {item.text}
                    </span>
                  </label>
                  <button
                    style={styles.itemDelete}
                    onClick={() => handleDeleteItem(l.id, item.id)}
                    title="Remove item"
                    aria-label={`Remove "${item.text}"`}
                  >
                    ×
                  </button>
                </div>
              ))}

              <div style={styles.addItemRow}>
                <input
                  style={{ ...styles.input, fontSize: 13 }}
                  placeholder="Add item…"
                  value={drafts[l.id] || ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && handleAddItem(l.id)}
                  maxLength={200}
                />
                <button
                  style={styles.addItemBtn}
                  onClick={() => handleAddItem(l.id)}
                  disabled={!(drafts[l.id] || "").trim()}
                  aria-label={`Add item to "${l.name}"`}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getStyles(theme) {
  const errorBg = theme.mode === "dark" ? "rgba(243,139,168,0.15)" : "#fee2e2";
  return {
    root: {
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: theme.bg,
      color: theme.text,
      fontFamily: "sans-serif",
    },
    header: {
      height: HEADER_H,
      background: theme.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 16px",
      flexShrink: 0,
      borderBottom: `1px solid ${theme.border}`,
    },
    headerRight: { display: "flex", alignItems: "center", gap: 8 },
    logoBtn: { background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 1 },
    body: {
      flex: 1,
      overflowY: "auto",
      padding: "clamp(24px, 6vw, 40px) clamp(14px, 4vw, 24px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    },
    heading: { margin: 0, fontSize: 28, fontWeight: 700, color: theme.text },
    tagline: { margin: "8px 0 24px", fontSize: 15, color: theme.subtext, textAlign: "center" },
    newListRow: { display: "flex", gap: 8, width: "100%", maxWidth: 640, marginBottom: 24 },
    input: {
      flex: 1,
      padding: "10px 12px",
      borderRadius: 8,
      border: `1px solid ${theme.border}`,
      background: theme.surface,
      color: theme.text,
      fontSize: 14,
      fontFamily: "inherit",
    },
    primaryBtn: {
      padding: "10px 20px",
      borderRadius: 8,
      border: "none",
      background: theme.accent,
      color: theme.userBubbleText,
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
    },
    errorBanner: {
      background: errorBg,
      border: `1px solid ${theme.error}`,
      borderRadius: 8,
      padding: "10px 14px",
      color: theme.error,
      fontSize: 13,
      marginBottom: 24,
      width: "100%",
      maxWidth: 640,
    },
    empty: { color: theme.subtext, fontSize: 14 },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: 16,
      width: "100%",
      maxWidth: 960,
    },
    card: {
      background: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 6,
    },
    cardHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    cardTitle: { fontWeight: 700, fontSize: 15, color: theme.text },
    cardDelete: {
      background: "none",
      border: "none",
      color: theme.muted,
      fontSize: 20,
      lineHeight: 1,
      cursor: "pointer",
      padding: "4px 6px",
    },
    cardEmpty: { color: theme.muted, fontSize: 13, padding: "4px 0" },
    itemRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 },
    itemLabel: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      cursor: "pointer",
      flex: 1,
      minWidth: 0,
      padding: "4px 0",
    },
    checkbox: { width: 18, height: 18, accentColor: theme.accent, cursor: "pointer", flexShrink: 0 },
    itemText: { fontSize: 14, color: theme.text, lineHeight: 1.4 },
    itemTextDone: {
      fontSize: 14,
      color: theme.muted,
      lineHeight: 1.4,
      textDecoration: "line-through",
    },
    itemDelete: {
      background: "none",
      border: "none",
      color: theme.muted,
      fontSize: 16,
      lineHeight: 1,
      cursor: "pointer",
      padding: "2px 6px",
      flexShrink: 0,
    },
    addItemRow: { display: "flex", gap: 6, marginTop: 8 },
    addItemBtn: {
      width: 38,
      borderRadius: 8,
      border: "none",
      background: theme.overlay,
      color: theme.text,
      fontSize: 18,
      fontWeight: 700,
      cursor: "pointer",
    },
  };
}
