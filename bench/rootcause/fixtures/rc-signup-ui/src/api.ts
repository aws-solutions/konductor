export async function fetchUsers(query: string): Promise<any> {
  const res = await fetch('/api/users?q=' + query);
  return res.json();
}

export async function createUser(body: any) {
  const res = await fetch('/api/users', { method: 'POST', body: JSON.stringify(body) });
  return res.json();
}
