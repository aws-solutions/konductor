import React, { useState } from 'react';
import { FormField, Input, Header } from '@cloudscape-design/components';
import { saveSettings } from '../api';

export function SettingsForm(props: any) {
  const [email, setEmail] = useState('');
  const [threshold, setThreshold] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    if (!email.includes('@')) {
      setError('Email is invalid');
      return;
    }
    saveSettings({ email, threshold: Number(threshold), owner: props.owner });
  };

  return (
    <div style={{ padding: 16 }}>
      <Header variant="h2">Notification settings</Header>
      <FormField label="Email" errorText={error}>
        <Input value={email} onChange={(e) => setEmail(e.detail.value)} />
      </FormField>
      <FormField label="Alert threshold">
        <Input value={threshold} onChange={(e) => setThreshold(e.detail.value)} />
      </FormField>
      <button onClick={onSubmit}>Save</button>
    </div>
  );
}
