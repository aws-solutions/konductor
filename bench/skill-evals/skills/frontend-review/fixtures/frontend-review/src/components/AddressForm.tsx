import React from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ColumnLayout, Form, SpaceBetween, Button } from '@cloudscape-design/components';
import { AddressFields } from './AddressFields';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  street: z.string().min(1, 'Street is required'),
  city: z.string().min(1),
});

type AddressFormValues = z.infer<typeof schema>;

export function AddressForm({ extras, onSave }: { extras: string[]; onSave: (v: AddressFormValues) => void }) {
  const methods = useForm({ resolver: zodResolver(schema) });

  const handleCancel = () => methods.reset();

  return (
    <FormProvider {...methods}>
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={handleCancel}>Cancel</Button>
            <Button variant="primary" onClick={methods.handleSubmit(onSave)}>Save</Button>
          </SpaceBetween>
        }
      >
        <ColumnLayout columns={extras.length}>
          <AddressFields />
        </ColumnLayout>
      </Form>
    </FormProvider>
  );
}
