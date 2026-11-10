import React from 'react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, DatePicker, Form, FormField, SpaceBetween } from '@cloudscape-design/components';

const bookingSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

export type BookingFormValues = z.infer<typeof bookingSchema>;

export function BookingForm({ onSubmit }: { onSubmit: (v: BookingFormValues) => void }) {
  const methods = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { startDate: '', endDate: '' },
  });
  const { control, handleSubmit, formState } = methods;

  return (
    <FormProvider {...methods}>
      <Form actions={<Button variant="primary" onClick={handleSubmit(onSubmit)}>Book</Button>}>
        <SpaceBetween size="m">
          <FormField label="Start date" errorText={formState.errors.startDate?.message}>
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => <DatePicker value={field.value} onChange={({ detail }) => field.onChange(detail.value)} />}
            />
          </FormField>
          <FormField label="End date" errorText={formState.errors.endDate?.message}>
            <Controller
              control={control}
              name="endDate"
              render={({ field }) => <DatePicker value={field.value} onChange={({ detail }) => field.onChange(detail.value)} />}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </FormProvider>
  );
}
