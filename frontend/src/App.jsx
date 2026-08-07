import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import useAuthFetch from "./useAuthFetch";
import { onDesktopCommand, postDesktopState, isDesktop } from "./desktopBridge";
import LoginPage from "./LoginPage";
import AdminPage from "./AdminPage";
import ChatComponent from "./ChatComponent";
import WelcomePage from "./WelcomePage";
import SessionsPage from "./SessionsPage";
import ListsPage from "./ListsPage";
import IntroScreen from "./IntroScreen";

const HEADER_H = 56;

function LoadingSpinner() {
  return (
    <div
      style={{
        height: "100vh",
        background: "#1e1e2e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#cdd6f4",
          animation: "blink 1s step-end infinite",
        }}
      />
    </div>
  );
}

export default function App() {
  const { loading, isAuthenticated, user, logout } = useAuth();
  const authFetch = useAuthFetch();
  const [page, setPage] = useState("home");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  // Desktop toolbar bridge state (only used when hosted in the Electron shell).
  const [dtModels, setDtModels] = useState([]);
  const [dtModel, setDtModel] = useState(null);

  // Keep the current-model in sync with the saved default when the profile loads.
  useEffect(() => {
    if (user?.default_model) setDtModel(user.default_model);
  }, [user?.default_model]);

  // Fetch the model list once so the toolbar's dropdown is populated on every page.
  useEffect(() => {
    if (!isAuthenticated || !isDesktop()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/models");
        const data = await res.json();
        if (!cancelled) setDtModels(data);
      } catch {
        /* toolbar dropdown just stays hidden until a model list is available */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, authFetch]);

  // Handle commands from the native toolbar.
  useEffect(() => {
    if (!isAuthenticated) return;
    return onDesktopCommand((cmd) => {
      switch (cmd?.type) {
        case "navigate":
          if (cmd.page) setPage(cmd.page);
          break;
        case "new-chat":
          // Only handle here when NOT already on the chat page — ChatComponent owns
          // new-chat when mounted, so this guard avoids creating two sessions.
          if (page !== "chat") {
            setSelectedSessionId("new");
            setPage("chat");
          }
          break;
        case "set-model":
          if (cmd.model) {
            setDtModel(cmd.model);
            authFetch("/users/me", {
              method: "PATCH",
              body: JSON.stringify({ default_model: cmd.model }),
            }).catch(() => {});
          }
          break;
        case "sign-out":
          logout();
          break;
        default:
          break;
      }
    });
  }, [isAuthenticated, page, authFetch, logout]);

  // Post navigation / admin / model-list state to the toolbar.
  useEffect(() => {
    if (!isAuthenticated) return;
    postDesktopState({
      page,
      isAdmin: !!user?.is_admin,
      models: dtModels,
      themeMode: user?.theme_mode || "light",
    });
  }, [isAuthenticated, page, user, dtModels]);

  // Post the current model separately so page changes never clobber it with a stale
  // value (in-chat model changes are posted by ChatComponent).
  useEffect(() => {
    if (!isAuthenticated || !dtModel) return;
    postDesktopState({ currentModel: dtModel });
  }, [isAuthenticated, dtModel]);

  if (loading) return <LoadingSpinner />;
  if (!isAuthenticated) return <LoginPage />;

  let content;
  if (page === "admin") {
    content = <AdminPage onBack={() => setPage("chat")} />;
  } else if (page === "home") {
    content = (
      <WelcomePage
        onNavigateChat={() => setPage("sessions")}
        onNavigateAdmin={() => setPage("admin")}
        onNavigateLists={() => setPage("lists")}
      />
    );
  } else if (page === "lists") {
    content = (
      <ListsPage
        onNavigateAdmin={() => setPage("admin")}
        onNavigateHome={() => setPage("home")}
      />
    );
  } else if (page === "sessions") {
    content = (
      <SessionsPage
        onNavigateAdmin={() => setPage("admin")}
        onNavigateHome={() => setPage("home")}
        onOpenSession={(id) => {
          setSelectedSessionId(id);
          setPage("chat");
        }}
        onNewChat={() => {
          setSelectedSessionId("new");
          setPage("chat");
        }}
      />
    );
  } else {
    content = (
      <ChatComponent
        onNavigateAdmin={() => setPage("admin")}
        onNavigateHome={() => setPage("home")}
        initialSessionId={selectedSessionId}
      />
    );
  }

  return (
    <>
      <IntroScreen />
      {content}
    </>
  );
}
