import React from 'react';
import { useFormContext, Controller } from 'react-hook-form';
import { FormField, Input } from '@cloudscape-design/components';

export function AddressFields() {
  const { control, formState } = useFormContext();
  return (
    <>
      <FormField label="Name" errorText={formState.errors.name?.message as string}>
        <Controller name="name" control={control} render={({ field }) => (
          <Input value={field.value ?? ''} onChange={(e) => field.onChange(e.detail.value)} />
        )} />
      </FormField>
      <FormField label="Street" errorText={formState.errors.street?.message as string}>
        <Controller name="street" control={control} render={({ field }) => (
          <Input value={field.value ?? ''} onChange={(e) => field.onChange(e.detail.value)} />
        )} />
      </FormField>
    </>
  );
}
