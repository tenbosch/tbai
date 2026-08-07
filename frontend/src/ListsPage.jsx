import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  X,
  Check,
  ShoppingCart,
  CheckCircle2,
  Utensils,
  ClipboardList,
} from "lucide-react";
import { useTheme } from "./ThemeContext";
import TbaiLogo from "./TbaiLogo";
import ProfileMenu from "./ProfileMenu";
import NotificationsBell from "./NotificationsBell";
import ThemeToggle from "./ThemeToggle";
import useAuthFetch from "./useAuthFetch";

const HEADER_H = 64;
const KIND_ICONS = { shopping: ShoppingCart, todo: CheckCircle2, meal: Utensils };

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
          <TbaiLogo variant={theme.mode} />
        </button>
        <div style={styles.headerRight}>
          <ThemeToggle />
          <NotificationsBell />
          <ProfileMenu onNavigateAdmin={onNavigateAdmin} />
        </div>
      </div>

      <div style={styles.body}>
        <h1 style={styles.heading}>Family lists</h1>
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
            <Plus size={17} strokeWidth={2} />
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
          {lists.map((l) => {
            const KindIcon = KIND_ICONS[l.kind] || ClipboardList;
            return (
            <div key={l.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>
                  <KindIcon size={18} strokeWidth={1.75} style={styles.kindIcon} />
                  {l.name}
                </span>
                <button
                  style={styles.cardDelete}
                  onClick={() => handleDeleteList(l.id)}
                  title="Delete list"
                  aria-label={`Delete list "${l.name}"`}
                >
                  <Trash2 size={16} strokeWidth={1.75} />
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
                      style={styles.checkboxInput}
                    />
                    <span style={{ ...styles.checkbox, ...(item.done ? styles.checkboxDone : {}) }}>
                      {item.done && <Check size={14} strokeWidth={3} color="var(--tbai-on-accent)" />}
                    </span>
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
                    <X size={15} strokeWidth={2} />
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
                  <Plus size={17} strokeWidth={2} />
                </button>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getStyles(theme) {
  return {
    root: {
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      background: theme.bg,
      color: theme.text,
      fontFamily: theme.fontBody,
    },
    header: {
      height: HEADER_H,
      background: theme.surface,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 clamp(14px, 4vw, 24px)",
      flexShrink: 0,
      borderBottom: `1px solid ${theme.border}`,
    },
    headerRight: { display: "flex", alignItems: "center", gap: 4 },
    logoBtn: { background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 1 },
    body: {
      flex: 1,
      overflowY: "auto",
      padding: "clamp(24px, 6vw, 48px) clamp(14px, 4vw, 24px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    },
    heading: {
      margin: 0,
      fontFamily: theme.fontDisplay,
      fontSize: 28,
      fontWeight: 700,
      letterSpacing: "-0.01em",
      color: theme.text,
    },
    tagline: { margin: "10px 0 24px", fontSize: 16, color: theme.subtext, textAlign: "center" },
    newListRow: { display: "flex", gap: 8, width: "100%", maxWidth: 640, marginBottom: 28 },
    input: {
      flex: 1,
      padding: "12px 14px",
      borderRadius: 10,
      border: `1px solid ${theme.border}`,
      background: theme.surface,
      color: theme.text,
      fontSize: 14,
      fontFamily: theme.fontBody,
    },
    primaryBtn: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "0 20px",
      height: 44,
      borderRadius: 10,
      border: "1px solid transparent",
      background: theme.accent,
      color: theme.userBubbleText,
      fontFamily: theme.fontBody,
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
    },
    errorBanner: {
      background: theme.errorSoft,
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
      background: theme.surfaceWarm,
      border: `1px solid ${theme.border}`,
      borderRadius: 16,
      padding: 18,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      boxShadow: "0 2px 6px rgba(var(--shadow-color), 0.09)",
    },
    cardHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    cardTitle: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontFamily: theme.fontDisplay,
      fontWeight: 600,
      fontSize: 18,
      color: theme.text,
    },
    kindIcon: { color: theme.accent, flexShrink: 0 },
    cardDelete: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "none",
      border: "none",
      color: theme.muted,
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
    checkboxInput: { position: "absolute", opacity: 0, width: 0, height: 0 },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      border: `1.5px solid ${theme.borderStrong}`,
      background: theme.surface,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      transition: "all 200ms cubic-bezier(0.4,0,0.2,1)",
    },
    checkboxDone: {
      background: theme.accent,
      border: `1.5px solid ${theme.accent}`,
    },
    itemText: { fontSize: 14, color: theme.text, lineHeight: 1.4 },
    itemTextDone: {
      fontSize: 14,
      color: theme.muted,
      lineHeight: 1.4,
      textDecoration: "line-through",
    },
    itemDelete: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "none",
      border: "none",
      color: theme.muted,
      lineHeight: 1,
      cursor: "pointer",
      padding: "2px 6px",
      flexShrink: 0,
    },
    addItemRow: { display: "flex", gap: 6, marginTop: 10 },
    addItemBtn: {
      width: 44,
      minHeight: 40,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      border: `1px solid ${theme.border}`,
      background: theme.surface,
      color: theme.text,
      cursor: "pointer",
      flexShrink: 0,
    },
  };
}
