export function Button({ onClick, children, variant = 'primary' }) {
  return <button className={`btn btn-${variant}`} onClick={onClick}>{children}</button>;
}
