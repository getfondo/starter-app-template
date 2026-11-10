import { useEffect } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import { entityPages } from "./entities/index";
import { theme } from "./theme";
import { currentUser, signOut } from "./lib/auth";

export function App() {
  useEffect(() => {
    document.title = theme.productName;
    document.documentElement.style.setProperty("--brand", theme.color);
  }, []);
  const user = currentUser();
  const first = entityPages[0];
  return (
    <div className="shell">
      <aside>
        <div className="brand">{theme.productName}</div>
        <nav>
          {entityPages.map((p) => (
            <NavLink key={p.spec.path} to={`/${p.spec.path}`}>{p.spec.labelPlural}</NavLink>
          ))}
        </nav>
        <div className="user">
          <span>{user.name}</span>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main>
        <Routes>
          {first ? <Route path="/" element={<Navigate to={`/${first.spec.path}`} replace />} /> : null}
          {entityPages.map((p) => (
            <Route key={p.spec.path} path={`/${p.spec.path}`}>
              <Route index element={<p.List />} />
              <Route path=":id" element={<p.Detail />} />
            </Route>
          ))}
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
