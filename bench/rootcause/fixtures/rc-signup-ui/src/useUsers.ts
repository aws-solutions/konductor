import { useEffect, useState } from 'react';
import { fetchUsers } from './api';

export function useUsers(query: string) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchUsers(query).then((data) => {
      setUsers(data);
      setLoading(false);
    });
  }, []);

  return { users, loading };
}
