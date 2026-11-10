export function LoginPage({ onLogin }) {
  return (
    <form onSubmit={onLogin}>
      <input id="email" type="email" />
      <input id="password" type="password" />
      <button className="btn-primary" type="submit">Sign in</button>
    </form>
  );
}
