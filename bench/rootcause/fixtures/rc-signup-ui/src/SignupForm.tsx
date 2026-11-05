import React, { useState } from 'react';
import { createUser } from './api';

export function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: any) {
    e.preventDefault();
    if (email.indexOf('@') < 0) {
      setError('bad email');
      return;
    }
    console.log('signup', { email, password });
    try {
      await createUser({ email, password });
    } catch (err) {}
  }

  return (
    <form onSubmit={submit}>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="text" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div style={{ color: 'red' }}>{error}</div>
      <button type="submit">Sign up</button>
    </form>
  );
}
