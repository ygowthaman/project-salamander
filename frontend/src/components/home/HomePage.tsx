import { useAuth } from "../../auth/useAuth";
import "./HomePage.css";

/**
 * The signed-in shell.
 *
 * Deliberately empty of product surface: the chat window that used to live here
 * is gone, and inventory (roadmap Phase 1b) has not landed. It exists so the
 * authenticated half of the app is still reachable and sign-out still works —
 * the inventory table and its natural-language input replace this body.
 */
export function HomePage() {
  const { user, signOut } = useAuth();

  return (
    <div className="home">
      <header className="home__header">
        <h1 className="home__title">Salamander</h1>
        <div className="home__account">
          {user?.avatar_url && <img className="home__avatar" src={user.avatar_url} alt="" />}
          <span className="home__user">{user?.display_name ?? user?.email}</span>
          <button className="home__signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="home__body">
        <p className="home__empty">
          You're signed in. Inventory tracking is the next thing to land here.
        </p>
      </main>
    </div>
  );
}
