// SPDX-License-Identifier: Apache-2.0
import { Fragment } from 'react';

const CODE_SPAN = /`([^`\n]+)`/gu;

/** A server message with each `name` in backticks shown as code, without the ticks. */
export function MessageText({ text }: { text: string }) {
  const parts = text.split(CODE_SPAN);
  return (
    <>
      {parts.map((part, index) =>
        // Splitting on a group alternates plain text and the captured name.
        index % 2 === 1 ? (
          <code key={index}>{part}</code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
