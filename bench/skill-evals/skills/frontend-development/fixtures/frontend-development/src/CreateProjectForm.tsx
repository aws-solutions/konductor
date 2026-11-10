import React, { useState } from 'react';
import { Button, FormField, Input, Select, Checkbox } from '@cloudscape-design/components';

interface Props {
  onSubmit: (data: any) => void;
}

export function CreateProjectForm({ onSubmit }: Props) {
  const [name, setName] = useState('');
  const [region, setRegion] = useState<any>(null);
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name) e.name = 'Name is required';
    else if (name.length < 3 || name.length > 64) e.name = 'Name must be 3-64 chars';
    if (!region) e.region = 'Pick a region';
    if (!terms) e.terms = 'Accept the terms';
    setErrors(e);
    if (Object.keys(e).length === 0) onSubmit({ name, region: region.value, terms });
  };

  return (
    <div style={{ marginTop: 8 }}>
      <FormField label="Project name" errorText={errors.name}>
        <Input value={name} onChange={({ detail }) => setName(detail.value)} />
      </FormField>
      <FormField label="Region" errorText={errors.region}>
        <Select
          selectedOption={region}
          onChange={({ detail }) => setRegion(detail.selectedOption)}
          options={[
            { label: 'US East (N. Virginia)', value: 'us-east-1' },
            { label: 'EU (Frankfurt)', value: 'eu-central-1' },
          ]}
        />
      </FormField>
      <FormField errorText={errors.terms}>
        <Checkbox checked={terms} onChange={({ detail }) => setTerms(detail.checked)}>
          I accept the terms
        </Checkbox>
      </FormField>
      <span className="hint">Projects can be renamed later.</span>
      <button onClick={submit}>Create project</button>
    </div>
  );
}
