import React from 'react';

type Props = { users: any[]; onSelect: (u: any) => void };

export function UserTable({ users, onSelect }: Props) {
  return (
    <table style={{ width: '100%', borderColor: '#0972d3' }}>
      <tbody>
        {users.map((u, i) => (
          <tr key={i} onClick={() => onSelect(u)}>
            <td dangerouslySetInnerHTML={{ __html: u.displayName }} />
            <td>{u.email}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
