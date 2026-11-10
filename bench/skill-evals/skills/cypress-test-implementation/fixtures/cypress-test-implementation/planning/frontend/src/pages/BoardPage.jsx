export function BoardPage({ tasks, onNew }) {
  return (
    <main>
      <h1>Board</h1>
      <button className="btn-new" onClick={onNew}>New task</button>
      <section className="column todo">{tasks.filter(t => !t.done).map(t => <div className="card" key={t.id}>{t.title}</div>)}</section>
      <section className="column done">{tasks.filter(t => t.done).map(t => <div className="card" key={t.id}>{t.title}</div>)}</section>
    </main>
  );
}
